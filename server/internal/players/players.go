// Package players owns everything that belongs to a person rather than to a
// game: their profile, the words they have solved, the ones they kept, their
// streak, and who they play against.
package players

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound      = errors.New("player not found")
	ErrSelfFriend    = errors.New("you cannot add yourself")
	ErrAlreadyLinked = errors.New("already linked")
)

// Player is a profile attached to a Better Auth user.
type Player struct {
	ID          string
	UserID      string
	DisplayName string
	SeatColor   string
	InviteCode  string
	CreatedAt   time.Time
}

// Solve is one finished round.
type Solve struct {
	Word      string
	PackID    string
	Solved    bool
	SolvedRow *int
	Guesses   int
	HintsUsed int
	Points    int
	PlayedOn  time.Time
}

// Streak is how many days in a row someone has played.
type Streak struct {
	Current int
	Longest int
	// PlayedToday says whether today is already counted — the difference
	// between "your streak is safe" and "your streak is about to break", which
	// is the only reason anyone looks at this number.
	PlayedToday bool
}

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// inviteAlphabet omits 0/O/1/I/L. Invite codes get read aloud across a table
// or typed from a screenshot, so the characters people confuse are left out.
const inviteAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

func newInviteCode() (string, error) {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = inviteAlphabet[int(b[i])%len(inviteAlphabet)]
	}
	return string(b), nil
}

// Ensure returns the player for a Better Auth user, creating the profile on
// first sight.
//
// A new player has no display name. The one Google supplies is a legal name —
// "Aditya Srivastava" — which is not what anyone wants written on a game they
// play with their girlfriend, and it does not fit on a bookplate. So the
// profile asks for a nickname instead, and until it has one the name is
// empty and the UI says so.
func (s *Store) Ensure(ctx context.Context, userID string) (Player, error) {
	var p Player
	err := s.pool.QueryRow(ctx, `
		select id, user_id, display_name, seat_color, invite_code, created_at
		from players where user_id = $1`, userID,
	).Scan(&p.ID, &p.UserID, &p.DisplayName, &p.SeatColor, &p.InviteCode, &p.CreatedAt)
	if err == nil {
		return p, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Player{}, fmt.Errorf("looking up player: %w", err)
	}

	// Confirm the user exists before building a profile for them, so a stale
	// token cannot create orphaned rows.
	var exists bool
	err = s.pool.QueryRow(ctx,
		`select exists (select 1 from "user" where id = $1)`, userID).Scan(&exists)
	if err != nil {
		return Player{}, fmt.Errorf("reading user: %w", err)
	}
	if !exists {
		return Player{}, ErrNotFound
	}

	// Retry on collision. Six characters from a 31-letter alphabet is roughly
	// 887 million codes, so this effectively never loops, but a unique index
	// deserves a real answer rather than a comment saying it cannot happen.
	for attempt := 0; attempt < 5; attempt++ {
		code, err := newInviteCode()
		if err != nil {
			return Player{}, err
		}

		err = s.pool.QueryRow(ctx, `
			insert into players (user_id, display_name, invite_code)
			values ($1, '', $2)
			returning id, user_id, display_name, seat_color, invite_code, created_at`,
			userID, code,
		).Scan(&p.ID, &p.UserID, &p.DisplayName, &p.SeatColor, &p.InviteCode, &p.CreatedAt)
		if err == nil {
			return p, nil
		}
		if !isUniqueViolation(err) {
			return Player{}, fmt.Errorf("creating player: %w", err)
		}
	}

	return Player{}, errors.New("could not allocate an invite code")
}

func isUniqueViolation(err error) bool {
	var pgErr interface{ SQLState() string }
	return errors.As(err, &pgErr) && pgErr.SQLState() == "23505"
}

// Name limits. Long enough for a real nickname, short enough to sit on one
// line of a bookplate and in a turn band on a phone.
const (
	MinNameLength = 1
	MaxNameLength = 16
)

// ErrBadName means the nickname was empty or too long.
var ErrBadName = errors.New("that name will not fit")

// SetDisplayName renames a player.
func (s *Store) SetDisplayName(ctx context.Context, playerID, name string) (string, error) {
	name = strings.TrimSpace(name)
	// Count runes, not bytes: a name in Devanagari or with an emoji should be
	// measured the way it is read.
	if n := len([]rune(name)); n < MinNameLength || n > MaxNameLength {
		return "", ErrBadName
	}
	if strings.ContainsAny(name, "\n\r\t") {
		return "", ErrBadName
	}

	tag, err := s.pool.Exec(ctx,
		`update players set display_name = $1 where id = $2`, name, playerID)
	if err != nil {
		return "", fmt.Errorf("renaming player: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return "", ErrNotFound
	}
	return name, nil
}

// RecordSolve stores a finished round.
//
// A word is listed once per player: replaying one that came round again keeps
// the better result rather than adding a duplicate to the collection.
func (s *Store) RecordSolve(ctx context.Context, playerID string, sv Solve) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("starting solve transaction: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := s.RecordSolveTx(ctx, tx, playerID, sv); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RecordSolveTx records activity and the best collection result in a caller's transaction.
func (s *Store) RecordSolveTx(ctx context.Context, tx pgx.Tx, playerID string, sv Solve) error {
	if _, err := tx.Exec(ctx, `insert into player_activity_days(player_id, played_on) values($1,$2) on conflict do nothing`, playerID, sv.PlayedOn); err != nil {
		return fmt.Errorf("recording activity day: %w", err)
	}
	_, err := tx.Exec(ctx, `
		insert into solves
			(player_id, word, pack_id, solved, solved_row, guesses, hints_used, points, played_on)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		on conflict (player_id, word) do update set
			solved     = solves.solved or excluded.solved,
			solved_row = case when (excluded.solved and not solves.solved) or (excluded.solved = solves.solved and (excluded.points > solves.points or (excluded.points = solves.points and excluded.hints_used < solves.hints_used))) then excluded.solved_row else solves.solved_row end,
			guesses    = case when (excluded.solved and not solves.solved) or (excluded.solved = solves.solved and (excluded.points > solves.points or (excluded.points = solves.points and excluded.hints_used < solves.hints_used))) then excluded.guesses else solves.guesses end,
			hints_used = case when (excluded.solved and not solves.solved) or (excluded.solved = solves.solved and (excluded.points > solves.points or (excluded.points = solves.points and excluded.hints_used < solves.hints_used))) then excluded.hints_used else solves.hints_used end,
			points     = case when (excluded.solved and not solves.solved) or (excluded.solved = solves.solved and (excluded.points > solves.points or (excluded.points = solves.points and excluded.hints_used < solves.hints_used))) then excluded.points else solves.points end,
			played_on  = greatest(solves.played_on, excluded.played_on)`,
		playerID, sv.Word, sv.PackID, sv.Solved, sv.SolvedRow,
		sv.Guesses, sv.HintsUsed, sv.Points, sv.PlayedOn)
	if err != nil {
		return fmt.Errorf("recording solve: %w", err)
	}
	return nil
}

// Solves returns the player's collection, most recent first.
func (s *Store) Solves(ctx context.Context, playerID string, limit int) ([]Solve, error) {
	rows, err := s.pool.Query(ctx, `
		select word, pack_id, solved, solved_row, guesses, hints_used, points, played_on
		from solves where player_id = $1
		order by played_on desc, word
		limit $2`, playerID, limit)
	if err != nil {
		return nil, fmt.Errorf("listing solves: %w", err)
	}
	defer rows.Close()

	var out []Solve
	for rows.Next() {
		var sv Solve
		if err := rows.Scan(&sv.Word, &sv.PackID, &sv.Solved, &sv.SolvedRow,
			&sv.Guesses, &sv.HintsUsed, &sv.Points, &sv.PlayedOn); err != nil {
			return nil, err
		}
		out = append(out, sv)
	}
	return out, rows.Err()
}

// SolvePage returns a stable page and the total matching collection size.
func (s *Store) SolvePage(ctx context.Context, playerID string, limit, offset, length int, words []string) ([]Solve, int, error) {
	var total int
	if err := s.pool.QueryRow(ctx, `select count(*) from solves where player_id=$1 and ($2=0 or char_length(word)=$2) and ($3::text[] is null or word=any($3))`, playerID, length, words).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting solves: %w", err)
	}
	rows, err := s.pool.Query(ctx, `select word,pack_id,solved,solved_row,guesses,hints_used,points,played_on from solves where player_id=$1 and ($2=0 or char_length(word)=$2) and ($3::text[] is null or word=any($3)) order by played_on desc,word limit $4 offset $5`, playerID, length, words, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("listing solve page: %w", err)
	}
	defer rows.Close()
	var out []Solve
	for rows.Next() {
		var sv Solve
		if err := rows.Scan(&sv.Word, &sv.PackID, &sv.Solved, &sv.SolvedRow, &sv.Guesses, &sv.HintsUsed, &sv.Points, &sv.PlayedOn); err != nil {
			return nil, 0, err
		}
		out = append(out, sv)
	}
	return out, total, rows.Err()
}

// SavedWordPage lists matching saved words in stable order.
func (s *Store) SavedWordPage(ctx context.Context, playerID string, limit, offset, length int, words []string) ([]string, int, error) {
	var total int
	q := `select count(*) from saved_words where player_id=$1 and ($2=0 or char_length(word)=$2) and ($3::text[] is null or word=any($3))`
	if err := s.pool.QueryRow(ctx, q, playerID, length, words).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting saved words: %w", err)
	}
	rows, err := s.pool.Query(ctx, `select word from saved_words where player_id=$1 and ($2=0 or char_length(word)=$2) and ($3::text[] is null or word=any($3)) order by saved_at desc,word limit $4 offset $5`, playerID, length, words, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("listing saved words: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var word string
		if err := rows.Scan(&word); err != nil {
			return nil, 0, err
		}
		out = append(out, word)
	}
	return out, total, rows.Err()
}

func (s *Store) SolveCount(ctx context.Context, playerID string) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx, `select count(*) from solves where player_id=$1`, playerID).Scan(&count)
	return count, err
}
func (s *Store) IsWordSaved(ctx context.Context, playerID, word string) (bool, error) {
	var saved bool
	err := s.pool.QueryRow(ctx, `select exists(select 1 from saved_words where player_id=$1 and word=$2)`, playerID, word).Scan(&saved)
	return saved, err
}

// PlayedWords is every word the player has finished, on any device.
//
// solves is unique on (player, word), so this is already one row per word.
func (s *Store) PlayedWords(ctx context.Context, playerID string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `select word from solves where player_id = $1`, playerID)
	if err != nil {
		return nil, fmt.Errorf("listing played words: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var w string
		if err := rows.Scan(&w); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// PackWordCounts is how many distinct words the player has recorded from each
// pack, keyed by pack ID.
//
// This is what lets a run skip themes you have already finished no matter which
// device you are on. The client keeps its own list in local storage for players
// who never sign in, but that list does not survive a new phone or a cleared
// browser, and it was the only thing selection consulted.
func (s *Store) PackWordCounts(ctx context.Context, playerID string) (map[string]int, error) {
	rows, err := s.pool.Query(ctx, `
		select pack_id, count(distinct word) from solves
		where player_id = $1 group by pack_id`, playerID)
	if err != nil {
		return nil, fmt.Errorf("counting played packs: %w", err)
	}
	defer rows.Close()

	out := map[string]int{}
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

// Streak counts consecutive days played.
//
// Walking the dates in Go rather than in SQL: the window function version is
// clever and unreadable, and the list of days someone has played a word game
// is never large enough for it to matter.
func (s *Store) Streak(ctx context.Context, playerID string, today time.Time) (Streak, error) {
	rows, err := s.pool.Query(ctx, `
		select played_on from player_activity_days
		where player_id = $1 order by played_on desc`, playerID)
	if err != nil {
		return Streak{}, fmt.Errorf("reading play days: %w", err)
	}
	defer rows.Close()

	var days []time.Time
	for rows.Next() {
		var d time.Time
		if err := rows.Scan(&d); err != nil {
			return Streak{}, err
		}
		days = append(days, day(d))
	}
	if err := rows.Err(); err != nil {
		return Streak{}, err
	}
	return computeStreak(days, today), nil
}

// computeStreak walks a descending list of distinct days played.
//
// Split out from the query because this is the part that gets the arithmetic
// wrong. It already did once: mixing the player's local date with the server's
// UTC date made a streak read as broken for several hours every night.
func computeStreak(days []time.Time, today time.Time) Streak {
	if len(days) == 0 {
		return Streak{}
	}

	today = day(today)
	yesterday := today.AddDate(0, 0, -1)

	var st Streak
	st.PlayedToday = days[0].Equal(today)

	// The current streak only counts if it reaches today or yesterday. One
	// day's gap is forgiven because the streak is still alive until midnight.
	if st.PlayedToday || days[0].Equal(yesterday) {
		st.Current = 1
		for i := 1; i < len(days); i++ {
			if !days[i].Equal(days[i-1].AddDate(0, 0, -1)) {
				break
			}
			st.Current++
		}
	}

	run := 1
	st.Longest = 1
	for i := 1; i < len(days); i++ {
		if days[i].Equal(days[i-1].AddDate(0, 0, -1)) {
			run++
		} else {
			run = 1
		}
		if run > st.Longest {
			st.Longest = run
		}
	}

	return st
}

// day strips a timestamp down to a bare calendar date.
//
// Not Truncate: that works from the Unix epoch, so it silently shifts any time
// carrying a non-UTC offset into the wrong day.
func day(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// SaveWord stars a word. Saving one twice is not an error.
func (s *Store) SaveWord(ctx context.Context, playerID, word string) error {
	_, err := s.pool.Exec(ctx, `
		insert into saved_words (player_id, word) values ($1, $2)
		on conflict (player_id, word) do nothing`, playerID, word)
	return err
}

// UnsaveWord removes a star.
func (s *Store) UnsaveWord(ctx context.Context, playerID, word string) error {
	_, err := s.pool.Exec(ctx,
		`delete from saved_words where player_id = $1 and word = $2`, playerID, word)
	return err
}

// SavedWords returns starred words, most recent first.
func (s *Store) SavedWords(ctx context.Context, playerID string) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`select word from saved_words where player_id = $1 order by saved_at desc`, playerID)
	if err != nil {
		return nil, fmt.Errorf("listing saved words: %w", err)
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var w string
		if err := rows.Scan(&w); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}
