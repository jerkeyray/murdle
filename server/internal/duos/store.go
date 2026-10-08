package duos

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jerkeyray/wordle/server/internal/game"
	"github.com/jerkeyray/wordle/server/internal/words"
)

type Store struct {
	db    *pgxpool.Pool
	words *words.Pool
	Now   func() time.Time
}

func New(db *pgxpool.Pool, pool *words.Pool) *Store {
	return &Store{db: db, words: pool, Now: time.Now}
}

// Presence is shared across API instances. Throttle writes while keeping the
// timestamp recent enough for the 90-second online window.
func (s *Store) Heartbeat(ctx context.Context, player string) error {
	_, err := s.db.Exec(ctx, `insert into player_presence(player_id,last_seen) values($1,$2)
 on conflict(player_id) do update set last_seen=excluded.last_seen
 where player_presence.last_seen <= excluded.last_seen - interval '20 seconds'`, player, s.Now())
	return err
}
func (s *Store) OnlinePlayers(ctx context.Context, players []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(players) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(ctx, `select player_id::text from player_presence where player_id=any($1::uuid[]) and last_seen > $2`, players, s.Now().Add(-90*time.Second))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

func (s *Store) load(ctx context.Context, tx pgx.Tx, id, player string, locked bool) (*Duo, error) {
	d := &Duo{ViewerID: player, Members: []Member{}, Recent: []Day{}}
	var low, high, ln, hn string
	query := `select d.id,d.friendship_id,d.inviter_id,d.low_id,d.high_id,d.timezone,d.status,d.version,coalesce(d.started_on::text,''),l.display_name,h.display_name from duos d join players l on l.id=d.low_id join players h on h.id=d.high_id where d.id=$1 and $2 in (d.low_id,d.high_id)`
	if locked {
		query += " for update of d"
	}
	err := tx.QueryRow(ctx, query, id, player).Scan(&d.ID, &d.FriendshipID, &d.InviterID, &low, &high, &d.Timezone, &d.Status, &d.Version, &d.StartedOn, &ln, &hn)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fail("not_found", "Daily game not found")
	}
	if err != nil {
		return nil, err
	}
	d.Members = []Member{{low, ln}, {high, hn}}
	return d, nil
}

// Aggregate each board in one statement. Correlated aggregates use the board
// primary keys and avoid multiplying guesses by passes in a joined result.
const boardColumns = `b.duo_id::text,b.day::text,b.seq,b.deadline,b.state,b.current_player::text,b.version,b.answer,b.entry,b.hint,
 coalesce((select jsonb_agg(jsonb_build_object('guess',g.guess,'marks',g.marks,'playerId',g.player_id) order by g.row_index) from duo_guesses g where (g.duo_id,g.day,g.seq)=(b.duo_id,b.day,b.seq)), '[]'::jsonb),
 coalesce((select jsonb_agg(p.player_id order by p.player_id) from duo_passes p where (p.duo_id,p.day,p.seq)=(b.duo_id,b.day,b.seq)), '[]'::jsonb)`

func scanDay(row pgx.Row) (*Day, error) {
	d := &Day{WordLength: game.WordLength, MaxRows: game.MaxRows}
	var entry, guesses, passes []byte
	var hint *string
	err := row.Scan(&d.DuoID, &d.Date, &d.Seq, &d.Deadline, &d.State, &d.CurrentPlayer, &d.Version, &d.hiddenAnswer, &entry, &hint, &guesses, &passes)
	if err != nil {
		return nil, err
	}
	for _, part := range []struct {
		data []byte
		dest any
	}{{entry, &d.hiddenEntry}, {guesses, &d.Rows}, {passes, &d.Passed}} {
		if err = json.Unmarshal(part.data, part.dest); err != nil {
			return nil, err
		}
	}
	d.Board = boardKey(d.Date, d.Seq)
	if hint != nil {
		d.Hint = &HintReveal{Tier: 1, Text: *hint}
	}
	d.reveal()
	return d, nil
}
func (s *Store) day(ctx context.Context, tx pgx.Tx, id, date string, seq int) (*Day, error) {
	return scanDay(tx.QueryRow(ctx, `select `+boardColumns+` from duo_days b where b.duo_id=$1 and b.day=$2 and b.seq=$3`, id, date, seq))
}

// addBoard creates one board for a day: it picks a word the pair has not had
// this cycle (starting a new cycle once every word has been used) and deals
// the opening turn. Used for a day's first board and for each "next word".
func (s *Store) addBoard(ctx context.Context, tx pgx.Tx, d *Duo, day string, deadline time.Time, seq int) error {
	cycle := 0
	err := tx.QueryRow(ctx, `select coalesce(max(cycle),0) from duo_days where duo_id=$1`, d.ID).Scan(&cycle)
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
	candidates := []words.Answer{}
	all := []words.Answer{}
	// Shared boards take five-letter guesses only, so a six-letter answer
	// could never be solved.
	for _, w := range s.words.DuoCandidates(game.WordLength) {
		all = append(all, w)
		if !seen[w.Word] {
			candidates = append(candidates, w)
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
	entry, _ := json.Marshal(Entry{Word: w.Word, Register: string(w.Register), Definition: w.Definition, Note: w.Note, Pronunciation: w.Pronunciation, PartOfSpeech: w.PartOfSpeech, Origin: w.Origin, Example: w.Example, ExampleSource: w.ExampleSource})
	_, err = tx.Exec(ctx, `insert into duo_days (duo_id,day,seq,deadline,answer,entry,cycle,state,current_player) values($1,$2,$3,$4,$5,$6,$7,'playing',$8)`, d.ID, day, seq, deadline, w.Word, entry, cycle, openingPlayer(d.StartedOn, day, seq, d.Members))
	return err
}
func (s *Store) ensureBoard(ctx context.Context, tx pgx.Tx, d *Duo) error {
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
			if err = s.addBoard(ctx, tx, d, today, deadline, 0); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) populate(ctx context.Context, tx pgx.Tx, d *Duo, history bool) error {
	today, _, err := dateAt(s.Now(), d.Timezone)
	if err != nil {
		return err
	}
	return s.populateOn(ctx, tx, d, history, today)
}

func (s *Store) populateOn(ctx context.Context, tx pgx.Tx, d *Duo, history bool, today string) error {
	d.Today = nil
	d.Recent = []Day{}
	if d.Status == "active" {
		var err error
		d.Today, err = scanDay(tx.QueryRow(ctx, `select `+boardColumns+` from duo_days b where b.duo_id=$1 and b.day=$2 order by b.seq desc limit 1`, d.ID, today))
		if err != nil {
			return err
		}
		d.Today.Streak, err = s.currentStreak(ctx, tx, d.FriendshipID, today)
		if err != nil {
			return err
		}
	}
	if !history {
		return nil
	}
	// Scoped to the friendship, not this duo, because Recent is: ending a daily
	// game and starting a fresh one with the same friend used to leave a zeroed
	// streak sitting beside a history that plainly showed the run continuing.
	// Where two duos covered the same date the newer one wins, hence the guard.
	//
	// A day can hold several boards, and the streak counts days: a day is "won"
	// if any of its boards was, so an extra game that is lost never undoes a
	// win. Otherwise the day takes the state of its latest board.
	states := map[string]string{}
	owner := map[string]string{}
	rows, err := tx.Query(ctx, `select b.day::text,b.state,b.duo_id from duo_days b join duos p on p.id=b.duo_id where p.friendship_id=$1 order by b.day desc,p.created_at desc,b.seq desc`, d.FriendshipID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var date, state, duo string
		if err = rows.Scan(&date, &state, &duo); err != nil {
			rows.Close()
			return err
		}
		if _, seen := owner[date]; !seen {
			owner[date] = duo
		}
		if owner[date] != duo {
			continue
		}
		if _, seen := states[date]; !seen || state == "won" {
			states[date] = state
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	rows, err = tx.Query(ctx, `select `+boardColumns+` from duo_days b join duos p on p.id=b.duo_id where p.friendship_id=$1 and b.state <> 'playing' order by b.day desc,p.created_at desc,b.seq desc limit 7`, d.FriendshipID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		r, e := scanDay(rows)
		if e != nil {
			return e
		}
		r.Streak = streak(states, r.Date)
		d.Recent = append(d.Recent, *r)
	}
	return rows.Err()
}

// dayState reads only one calendar day, belonging to the latest partnership
// that played that day. A later loss on the same day cannot undo a win.
const dayState = `(select case when bool_or(b.state='won') then 'won' else (array_agg(b.state order by b.seq desc))[1] end
 from duo_days b where b.day=c.day and b.duo_id=(select p.id from duos p join duo_days x on x.duo_id=p.id and x.day=c.day where p.friendship_id=$1 order by p.created_at desc,p.id desc limit 1))`

func (s *Store) currentStreak(ctx context.Context, tx pgx.Tx, friendship, today string) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `with recursive chain(day,state) as (
 select c.day,`+dayState+` from (select $2::date as day) c
 union all
 select c.day,`+dayState+` from chain prev cross join lateral (select prev.day-1 as day) c
 where prev.state='won' or (prev.day=$2::date and (prev.state='playing' or prev.state is null))
 ) select count(*) filter(where state='won') from chain`, friendship, today).Scan(&n)
	return n, err
}

// Routine reads use a consistent, read-only snapshot. Only rollover or missing
// boards take a write lock, in a separate short transaction.
func (s *Store) read(ctx context.Context, id, player, date string, history bool) (*Duo, error) {
	for attempt := 0; attempt < 3; attempt++ {
		tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
		if err != nil {
			return nil, err
		}
		d, err := s.load(ctx, tx, id, player, false)
		if err != nil {
			_ = tx.Rollback(ctx)
			return nil, err
		}
		now := s.Now()
		today, _, err := dateAt(now, d.Timezone)
		if err != nil {
			_ = tx.Rollback(ctx)
			return nil, err
		}
		var stale bool
		err = tx.QueryRow(ctx, `select exists(select 1 from duo_days where duo_id=$1 and state='playing' and deadline <= $3) or ($4 and not exists(select 1 from duo_days where duo_id=$1 and day=$2))`, id, today, now, d.Status == "active").Scan(&stale)
		if err != nil {
			_ = tx.Rollback(ctx)
			return nil, err
		}
		if stale {
			_ = tx.Rollback(ctx)
			if err = s.refresh(ctx, id, player); err != nil {
				return nil, err
			}
			continue
		}
		err = s.populateOn(ctx, tx, d, history, today)
		if err == nil && date != "today" && (d.Today == nil || d.Today.Board != date) {
			day, seq, ok := parseBoard(date)
			if !ok {
				err = fail("not_found", "Board not found")
			} else {
				d.Today, err = s.day(ctx, tx, id, day, seq)
				if errors.Is(err, pgx.ErrNoRows) {
					err = fail("not_found", "Board not found")
				}
				if err == nil {
					d.Today.Streak, err = s.currentStreak(ctx, tx, d.FriendshipID, day)
				}
			}
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			return nil, err
		}
		return d, tx.Commit(ctx)
	}
	return nil, errors.New("board changed repeatedly during refresh")
}
func (s *Store) refresh(ctx context.Context, id, player string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	d, err := s.load(ctx, tx, id, player, true)
	if err != nil {
		return err
	}
	if err = s.ensureBoard(ctx, tx, d); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) Get(ctx context.Context, id, player string) (*Duo, error) {
	if !uuid(id) {
		return nil, fail("not_found", "Daily game not found")
	}
	return s.read(ctx, id, player, "today", true)
}
func (s *Store) List(ctx context.Context, player string) ([]*Duo, error) {
	rows, err := s.db.Query(ctx, `select distinct on(friendship_id) id::text from duos where $1 in(low_id,high_id) order by friendship_id,case when status in('active','pending') then 0 else 1 end,created_at desc`, player)
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
		d, e := s.read(ctx, id, player, "today", false)
		if e != nil {
			return nil, e
		}
		out = append(out, d)
	}
	return out, nil
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
		d, err = s.load(ctx, tx, id, player, true)
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
			d, err = s.load(ctx, tx, id, player, true)
		} else if err == nil {
			d, err = s.load(ctx, tx, id, player, true)
			if err == nil && d.Status == "pending" && d.InviterID != player {
				action = "accept"
				m.Version = d.Version
			}
		}
		if err != nil {
			return nil, err
		}
	}
	if err = s.ensureBoard(ctx, tx, d); err != nil {
		return nil, err
	}
	if err = s.populate(ctx, tx, d, false); err != nil {
		return nil, err
	}
	boardAction := action == "guess" || action == "pass" || action == "hint"
	includeHistory := !boardAction
	currentVersion := d.Version
	if boardAction && d.Today != nil {
		currentVersion = d.Today.Version
	}
	if action != "invite" && action != "next" && m.Version != currentVersion {
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
	case "next":
		// Starts another board today. Either friend may, once the latest board
		// is finished. If the other friend got there first the latest board is
		// already a fresh one, and this is a no-op that returns it, so two taps
		// at once land both players on the same game.
		b := d.Today
		if d.Status != "active" || b == nil {
			return nil, fail("invalid_action", "This daily game is not active")
		}
		if b.State == "won" || b.State == "lost" {
			today, deadline, derr := dateAt(s.Now(), d.Timezone)
			if derr != nil {
				return nil, derr
			}
			if err = s.addBoard(ctx, tx, d, today, deadline, b.Seq+1); err != nil {
				return nil, err
			}
		} else if b.State != "playing" {
			return nil, fail("invalid_action", "Today's board has closed")
		}
	case "guess", "pass", "hint":
		b := d.Today
		if d.Status != "active" || b == nil || date != b.Board || b.State != "playing" {
			if err = tx.Commit(ctx); err != nil {
				return nil, err
			}
			return nil, &Error{"round_over", "This board has closed.", d}
		}
		if action != "hint" && b.CurrentPlayer != player {
			return nil, fail("not_your_turn", "It is your friend's turn")
		}
		if action == "hint" {
			if b.Hint == nil {
				if len(b.Rows) < game.HintUnlocksAfter(1) {
					return nil, fail("hint_locked", "A clue unlocks after three accepted guesses")
				}
				info, ok := s.words.WordInfo(b.hiddenAnswer)
				if !ok || len(info.Hints) == 0 {
					return nil, fail("invalid_action", "A clue is unavailable for this word")
				}
				_, err = tx.Exec(ctx, `update duo_days set hint=$4,version=version+1 where duo_id=$1 and day=$2 and seq=$3 and hint is null`, d.ID, b.Date, b.Seq, info.Hints[0])
				if err != nil {
					return nil, err
				}
			}
		} else {
			other := d.Members[0].ID
			if other == player {
				other = d.Members[1].ID
			}
			state := b.State
			if action == "pass" {
				for _, p := range b.Passed {
					if p == player {
						return nil, fail("pass_used", "You already passed on this board")
					}
				}
				_, err = tx.Exec(ctx, `insert into duo_passes(duo_id,day,seq,player_id) values($1,$2,$3,$4)`, d.ID, b.Date, b.Seq, player)
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
				_, err = tx.Exec(ctx, `insert into duo_guesses(duo_id,day,seq,row_index,player_id,guess,marks) values($1,$2,$3,$4,$5,$6,$7)`, d.ID, b.Date, b.Seq, len(b.Rows), player, guess, markJSON)
				if game.Solved(marks) {
					state = "won"
				} else if len(b.Rows)+1 >= game.MaxRows {
					state = "lost"
				}
			}
			if err != nil {
				return nil, err
			}
			includeHistory = state != "playing"
			_, err = tx.Exec(ctx, `update duo_days set current_player=$4,state=$5,version=version+1 where duo_id=$1 and day=$2 and seq=$3`, d.ID, b.Date, b.Seq, other, state)
			if err != nil {
				return nil, err
			}
		}
	default:
		return nil, fail("invalid_action", "Unknown action")
	}
	d, err = s.load(ctx, tx, d.ID, player, true)
	if err != nil {
		return nil, err
	}
	if err = s.ensureBoard(ctx, tx, d); err != nil {
		return nil, err
	}
	if err = s.populate(ctx, tx, d, includeHistory); err != nil {
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
	return s.read(ctx, id, player, date, false)
}
