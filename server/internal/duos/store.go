package duos

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jerkeyray/wordle/server/internal/game"
	"github.com/jerkeyray/wordle/server/internal/words"
)

type Store struct {
	db       *pgxpool.Pool
	words    *words.Pool
	Now      func() time.Time
	presence sync.Map
}

func New(db *pgxpool.Pool, pool *words.Pool) *Store {
	return &Store{db: db, words: pool, Now: time.Now}
}
func (s *Store) Heartbeat(player string) {
	now := s.Now()
	s.presence.Store(player, now)
	s.presence.Range(func(k, v any) bool {
		if now.Sub(v.(time.Time)) >= 90*time.Second {
			s.presence.Delete(k)
		}
		return true
	})
}
func (s *Store) Online(player string) bool {
	t, ok := s.presence.Load(player)
	return ok && s.Now().Sub(t.(time.Time)) < 90*time.Second
}

func (s *Store) load(ctx context.Context, tx pgx.Tx, id, player string) (*Duo, error) {
	d := &Duo{ViewerID: player, Members: []Member{}, Recent: []Day{}}
	var low, high, ln, hn string
	err := tx.QueryRow(ctx, `select d.id,d.friendship_id,d.inviter_id,d.low_id,d.high_id,d.timezone,d.status,d.version,coalesce(d.started_on::text,''),l.display_name,h.display_name from duos d join players l on l.id=d.low_id join players h on h.id=d.high_id where d.id=$1 and $2 in (d.low_id,d.high_id) for update of d`, id, player).Scan(&d.ID, &d.FriendshipID, &d.InviterID, &low, &high, &d.Timezone, &d.Status, &d.Version, &d.StartedOn, &ln, &hn)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fail("not_found", "Daily game not found")
	}
	if err != nil {
		return nil, err
	}
	d.Members = []Member{{low, ln}, {high, hn}}
	return d, nil
}
func (s *Store) day(ctx context.Context, tx pgx.Tx, id, date string) (*Day, error) {
	d := &Day{DuoID: id, WordLength: game.WordLength, MaxRows: game.MaxRows, Rows: []Guess{}, Passed: []string{}}
	var entry []byte
	err := tx.QueryRow(ctx, `select day::text,deadline,state,current_player,version,answer,entry from duo_days where duo_id=$1 and day=$2`, id, date).Scan(&d.Date, &d.Deadline, &d.State, &d.CurrentPlayer, &d.Version, &d.hiddenAnswer, &entry)
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(entry, &d.hiddenEntry); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `select guess,marks,player_id from duo_guesses where duo_id=$1 and day=$2 order by row_index`, id, date)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var g Guess
		var marks []byte
		if err = rows.Scan(&g.Guess, &marks, &g.PlayerID); err != nil {
			rows.Close()
			return nil, err
		}
		if err = json.Unmarshal(marks, &g.Marks); err != nil {
			rows.Close()
			return nil, err
		}
		d.Rows = append(d.Rows, g)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	rows, err = tx.Query(ctx, `select player_id from duo_passes where duo_id=$1 and day=$2 order by player_id`, id, date)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p string
		if err = rows.Scan(&p); err != nil {
			rows.Close()
			return nil, err
		}
		d.Passed = append(d.Passed, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	d.reveal()
	return d, nil
}
func (s *Store) populate(ctx context.Context, tx pgx.Tx, d *Duo) error {
	now := s.Now()
	today, deadline, err := dateAt(now, d.Timezone)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `update duo_days set state='expired',version=version+1 where duo_id=$1 and state='playing' and deadline <= $2`, d.ID, now)
	if err != nil {
		return err
	}
	if d.Status == "active" {
		var exists bool
		err = tx.QueryRow(ctx, `select exists(select 1 from duo_days where duo_id=$1 and day=$2)`, d.ID, today).Scan(&exists)
		if err != nil {
			return err
		}
		if !exists {
			cycle := 0
			err = tx.QueryRow(ctx, `select coalesce(max(cycle),0) from duo_days where duo_id=$1`, d.ID).Scan(&cycle)
			if err != nil {
				return err
			}
			seen := map[string]bool{}
			rows, e := tx.Query(ctx, `select answer from duo_days where duo_id=$1 and cycle=$2`, d.ID, cycle)
			if e != nil {
				return e
			}
			for rows.Next() {
				var w string
				if e = rows.Scan(&w); e != nil {
					rows.Close()
					return e
				}
				seen[w] = true
			}
			e = rows.Err()
			rows.Close()
			if e != nil {
				return e
			}
			candidates := []words.PackWord{}
			all := []words.PackWord{}
			for _, p := range s.words.Packs() {
				for _, w := range p.Words {
					all = append(all, w)
					if !seen[w.Word] {
						candidates = append(candidates, w)
					}
				}
			}
			if len(candidates) == 0 {
				cycle++
				candidates = all
			}
			if len(candidates) == 0 {
				return fail("unavailable", "No daily words available")
			}
			w := candidates[rand.IntN(len(candidates))]
			entry, _ := json.Marshal(Entry{w.Word, string(w.Register), w.Definition, w.Note})
			_, err = tx.Exec(ctx, `insert into duo_days (duo_id,day,deadline,answer,entry,cycle,state,current_player) values($1,$2,$3,$4,$5,$6,'playing',$7)`, d.ID, today, deadline, w.Word, entry, cycle, starter(d.StartedOn, today, d.Members))
			if err != nil {
				return err
			}
		}
	}
	// Scoped to the friendship, not this duo, because Recent is: ending a daily
	// game and starting a fresh one with the same friend used to leave a zeroed
	// streak sitting beside a history that plainly showed the run continuing.
	// Where two duos covered the same date the newer one wins, hence the guard.
	states := map[string]string{}
	rows, err := tx.Query(ctx, `select b.day::text,b.state from duo_days b join duos p on p.id=b.duo_id where p.friendship_id=$1 order by b.day desc,p.created_at desc`, d.FriendshipID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var date, state string
		if err = rows.Scan(&date, &state); err != nil {
			rows.Close()
			return err
		}
		if _, seen := states[date]; !seen {
			states[date] = state
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if d.Status == "active" {
		d.Today, err = s.day(ctx, tx, d.ID, today)
		if err != nil {
			return err
		}
		d.Today.Streak = streak(states, today)
	}
	type historical struct{ id, date string }
	dates := []historical{}
	rows, err = tx.Query(ctx, `select b.duo_id,b.day::text from duo_days b join duos p on p.id=b.duo_id where p.friendship_id=$1 and b.state <> 'playing' order by b.day desc,p.created_at desc limit 7`, d.FriendshipID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var h historical
		if err = rows.Scan(&h.id, &h.date); err != nil {
			rows.Close()
			return err
		}
		dates = append(dates, h)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, h := range dates {
		r, e := s.day(ctx, tx, h.id, h.date)
		if e != nil {
			return e
		}
		r.Streak = streak(states, h.date)
		d.Recent = append(d.Recent, *r)
	}
	return nil
}

// get reads and freshens one duo inside a transaction the caller owns. Both
// Get and List go through it so a listing does not open — and lock — one
// transaction per duo.
func (s *Store) get(ctx context.Context, tx pgx.Tx, id, player string) (*Duo, error) {
	d, err := s.load(ctx, tx, id, player)
	if err != nil {
		return nil, err
	}
	if err = s.populate(ctx, tx, d); err != nil {
		return nil, err
	}
	return d, nil
}
func (s *Store) Get(ctx context.Context, id, player string) (*Duo, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	d, err := s.get(ctx, tx, id, player)
	if err != nil {
		return nil, err
	}
	return d, tx.Commit(ctx)
}
func (s *Store) List(ctx context.Context, player string) ([]*Duo, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `select distinct on (friendship_id) id from duos where $1 in (low_id,high_id) order by friendship_id,case when status in ('active','pending') then 0 else 1 end,created_at desc`, player)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	out := []*Duo{}
	for _, id := range ids {
		d, e := s.get(ctx, tx, id, player)
		if e != nil {
			return nil, e
		}
		out = append(out, d)
	}
	return out, tx.Commit(ctx)
}

type Mutation struct {
	RequestID    string `json:"requestId"`
	Version      int    `json:"version"`
	FriendshipID string `json:"friendshipId,omitempty"`
	Timezone     string `json:"timezone,omitempty"`
	Guess        string `json:"guess,omitempty"`
}

// Mutate locks a friendship or partnership before checking the receipt and version.
// A receipt stores the original safe response, including for retries after midnight.
func (s *Store) Mutate(ctx context.Context, player, id, date, action string, m Mutation) (*Duo, error) {
	if !uuid(m.RequestID) || m.Version < 0 {
		return nil, fail("invalid_body", "A request ID and version are required")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var d *Duo
	if action == "invite" {
		if !uuid(m.FriendshipID) {
			return nil, fail("invalid_body", "Choose a friend")
		}
		if _, err = time.LoadLocation(m.Timezone); err != nil || strings.TrimSpace(m.Timezone) == "" || m.Timezone == "Local" {
			return nil, fail("invalid_timezone", "Choose a valid timezone")
		}
		var low, high, status string
		err = tx.QueryRow(ctx, `select low_id,high_id,status from friendships where id=$1 and $2 in (low_id,high_id) for update`, m.FriendshipID, player).Scan(&low, &high, &status)
		if errors.Is(err, pgx.ErrNoRows) || status != "accepted" {
			return nil, fail("not_found", "Choose an accepted friend")
		}
		if err != nil {
			return nil, err
		}
	} else {
		if !uuid(id) {
			return nil, fail("not_found", "Daily game not found")
		}
		d, err = s.load(ctx, tx, id, player)
		if err != nil {
			return nil, err
		}
	}
	// Serialize request IDs too, even when two requests target different partnerships.
	_, err = tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, player+":"+m.RequestID)
	if err != nil {
		return nil, err
	}
	bytes, _ := json.Marshal(m)
	hash := sha256.Sum256(append([]byte(id+":"+date+":"+action+":"), bytes...))
	fingerprint := hex.EncodeToString(hash[:])
	var oldFingerprint string
	var old []byte
	err = tx.QueryRow(ctx, `select fingerprint,response from duo_requests where player_id=$1 and request_id=$2`, player, m.RequestID).Scan(&oldFingerprint, &old)
	if err == nil {
		if oldFingerprint != fingerprint {
			return nil, fail("request_reused", "This request ID was already used")
		}
		var result Duo
		if err = json.Unmarshal(old, &result); err != nil {
			return nil, err
		}
		return &result, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if action == "invite" {
		err = tx.QueryRow(ctx, `select id from duos where friendship_id=$1 and status in ('pending','active')`, m.FriendshipID).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			err = tx.QueryRow(ctx, `insert into duos (friendship_id,inviter_id,low_id,high_id,timezone,status) select id,$2,low_id,high_id,$3,'pending' from friendships where id=$1 returning id`, m.FriendshipID, player, m.Timezone).Scan(&id)
			if err != nil {
				return nil, err
			}
			d, err = s.load(ctx, tx, id, player)
		} else if err == nil {
			d, err = s.load(ctx, tx, id, player)
			if err == nil && d.Status == "pending" && d.InviterID != player {
				action = "accept"
				m.Version = d.Version
			}
		}
		if err != nil {
			return nil, err
		}
	}
	if err = s.populate(ctx, tx, d); err != nil {
		return nil, err
	}
	boardAction := action == "guess" || action == "pass"
	currentVersion := d.Version
	if boardAction && d.Today != nil {
		currentVersion = d.Today.Version
	}
	if action != "invite" && m.Version != currentVersion {
		if err = tx.Commit(ctx); err != nil {
			return nil, err
		}
		return nil, &Error{"stale", "The game changed. Review the board and try again.", d}
	}
	switch action {
	case "invite":
	case "accept", "decline", "cancel", "end":
		next := ""
		switch action {
		case "accept":
			if d.Status != "pending" || d.InviterID == player {
				return nil, fail("invalid_action", "Only the invited friend can accept")
			}
			next = "active"
		case "decline":
			if d.Status != "pending" || d.InviterID == player {
				return nil, fail("invalid_action", "Only the invited friend can decline")
			}
			next = "declined"
		case "cancel":
			if d.Status != "pending" || d.InviterID != player {
				return nil, fail("invalid_action", "Only the inviter can cancel")
			}
			next = "cancelled"
		case "end":
			if d.Status != "active" {
				return nil, fail("invalid_action", "This daily game is not active")
			}
			next = "ended"
		}
		start, _, _ := dateAt(s.Now(), d.Timezone)
		_, err = tx.Exec(ctx, `update duos set status=$2,version=version+1,started_on=case when $2='active' then $3::date else started_on end,ended_at=case when $2 in ('ended','declined','cancelled') then $4 else ended_at end where id=$1`, d.ID, next, start, s.Now())
		if err != nil {
			return nil, err
		}
		if next == "ended" {
			_, err = tx.Exec(ctx, `update duo_days set state='closed',version=version+1 where duo_id=$1 and state='playing'`, d.ID)
			if err != nil {
				return nil, err
			}
		}
	case "guess", "pass":
		b := d.Today
		if d.Status != "active" || b == nil || date != b.Date || b.State != "playing" {
			if err = tx.Commit(ctx); err != nil {
				return nil, err
			}
			return nil, &Error{"round_over", "This board has closed.", d}
		}
		if b.CurrentPlayer != player {
			return nil, fail("not_your_turn", "It is your friend's turn")
		}
		other := d.Members[0].ID
		if other == player {
			other = d.Members[1].ID
		}
		state := b.State
		if action == "pass" {
			for _, p := range b.Passed {
				if p == player {
					return nil, fail("pass_used", "You already passed today")
				}
			}
			_, err = tx.Exec(ctx, `insert into duo_passes(duo_id,day,player_id) values($1,$2,$3)`, d.ID, date, player)
		} else {
			guess := strings.ToLower(strings.TrimSpace(m.Guess))
			if len(guess) != game.WordLength {
				return nil, fail("wrong_length", "Enter "+game.LengthWord()+" letters")
			}
			if !s.words.IsWord(guess) {
				return nil, fail("not_a_word", "Not in the word list")
			}
			marks := game.MarkGuess(guess, b.hiddenAnswer)
			wireMarks := make([]string, len(marks))
			for i, mark := range marks {
				wireMarks[i] = mark.String()
			}
			markJSON, _ := json.Marshal(wireMarks)
			_, err = tx.Exec(ctx, `insert into duo_guesses(duo_id,day,row_index,player_id,guess,marks) values($1,$2,$3,$4,$5,$6)`, d.ID, date, len(b.Rows), player, guess, markJSON)
			if game.Solved(marks) {
				state = "won"
			} else if len(b.Rows)+1 >= game.MaxRows {
				state = "lost"
			}
		}
		if err != nil {
			return nil, err
		}
		_, err = tx.Exec(ctx, `update duo_days set current_player=$3,state=$4,version=version+1 where duo_id=$1 and day=$2`, d.ID, date, other, state)
		if err != nil {
			return nil, err
		}
	default:
		return nil, fail("invalid_action", "Unknown action")
	}
	d, err = s.load(ctx, tx, d.ID, player)
	if err != nil {
		return nil, err
	}
	if err = s.populate(ctx, tx, d); err != nil {
		return nil, err
	}
	response, err := json.Marshal(d)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `insert into duo_requests(player_id,request_id,fingerprint,response) values($1,$2,$3,$4)`, player, m.RequestID, fingerprint, response)
	if err != nil {
		return nil, err
	}
	// A receipt only has to survive a reconnecting phone retrying its last move,
	// so sweep this player's older ones rather than storing a response per
	// mutation forever. Scoped to the player whose row we just wrote, inside the
	// transaction that wrote it, so it needs no separate job or lock.
	_, err = tx.Exec(ctx, `delete from duo_requests where player_id=$1 and created_at < $2`, player, s.Now().Add(-24*time.Hour))
	if err != nil {
		return nil, err
	}
	return d, tx.Commit(ctx)
}
func uuid(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			return false
		}
	}
	return true
}
func (s *Store) Board(ctx context.Context, id, date, player string) (*Duo, error) {
	if !uuid(id) {
		return nil, fail("not_found", "Daily game not found")
	}
	d, err := s.Get(ctx, id, player)
	if err != nil {
		return nil, err
	}
	if date == "today" || d.Today != nil && date == d.Today.Date {
		return d, nil
	}
	for _, day := range d.Recent {
		if day.Date == date && day.DuoID == id {
			d.Today = &day
			return d, nil
		}
	}
	return nil, fail("not_found", "Board not found")
}
