package duos

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jerkeyray/wordle/server/internal/game"
	"github.com/jerkeyray/wordle/server/internal/testdb"
	"github.com/jerkeyray/wordle/server/internal/words"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func fixture(t *testing.T) (*Store, *Duo, *time.Time) {
	t.Helper()
	s := New(testdb.Open(t), words.NewPool())
	now := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	s.Now = func() time.Time { return now }
	ctx := context.Background()
	d, err := s.Mutate(ctx, testdb.A, "", "", "invite", Mutation{RequestID: testdb.ID(), FriendshipID: testdb.Friendship, Timezone: "Asia/Kolkata"})
	if err != nil {
		t.Fatal(err)
	}
	d, err = s.Mutate(ctx, testdb.B, d.ID, "", "accept", Mutation{RequestID: testdb.ID(), Version: d.Version})
	if err != nil {
		t.Fatal(err)
	}
	return s, d, &now
}
func requireCode(t *testing.T, err error, code string) {
	t.Helper()
	var e *Error
	if !errors.As(err, &e) || e.Code != code {
		t.Fatalf("want %s got %v", code, err)
	}
}
func TestPostgresMovesAndRestoration(t *testing.T) {
	s, d, now := fixture(t)
	ctx := context.Background()
	day := d.Today.Date
	if d.Today.CurrentPlayer != testdb.A || d.Today.Answer != "" || d.Today.Entry != nil {
		t.Fatal("unsafe initial state")
	}
	_, err := s.Get(ctx, d.ID, testdb.C)
	requireCode(t, err, "not_found")
	_, err = s.Mutate(ctx, testdb.B, d.ID, day, "guess", Mutation{RequestID: testdb.ID(), Guess: "adieu"})
	requireCode(t, err, "not_your_turn")
	_, err = s.Mutate(ctx, testdb.A, d.ID, day, "guess", Mutation{RequestID: testdb.ID(), Guess: "zzzzz"})
	requireCode(t, err, "not_a_word")
	m := Mutation{RequestID: testdb.ID(), Guess: "adieu"}
	d, err = s.Mutate(ctx, testdb.A, d.ID, day, "guess", m)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Today.Rows) != 1 || d.Today.CurrentPlayer != testdb.B {
		t.Fatal("turn did not move")
	}
	retry, err := s.Mutate(ctx, testdb.A, d.ID, day, "guess", m)
	if err != nil || retry.Today.Version != d.Today.Version || len(retry.Today.Rows) != 1 {
		t.Fatal("retry spent another row")
	}
	m.Guess = "stone"
	_, err = s.Mutate(ctx, testdb.A, d.ID, day, "guess", m)
	requireCode(t, err, "request_reused")
	_, err = s.Mutate(ctx, testdb.B, d.ID, day, "pass", Mutation{RequestID: testdb.ID(), Version: 0})
	requireCode(t, err, "stale")
	d, err = s.Mutate(ctx, testdb.B, d.ID, day, "pass", Mutation{RequestID: testdb.ID(), Version: d.Today.Version})
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Today.Rows) != 1 || d.Today.CurrentPlayer != testdb.A {
		t.Fatal("pass consumed a row")
	}
	d, err = s.Mutate(ctx, testdb.A, d.ID, day, "pass", Mutation{RequestID: testdb.ID(), Version: d.Today.Version})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Mutate(ctx, testdb.B, d.ID, day, "pass", Mutation{RequestID: testdb.ID(), Version: d.Today.Version})
	requireCode(t, err, "pass_used")
	restarted := New(s.db, words.NewPool())
	restarted.Now = s.Now
	restored, err := restarted.Get(ctx, d.ID, testdb.A)
	if err != nil || len(restored.Today.Rows) != 1 || len(restored.Today.Passed) != 2 {
		t.Fatal("restart lost state", err)
	}
	answer := restored.Today.hiddenAnswer
	d, err = s.Mutate(ctx, testdb.B, d.ID, day, "guess", Mutation{RequestID: testdb.ID(), Version: d.Today.Version, Guess: answer})
	if err != nil || d.Today.State != "won" || d.Today.Streak != 1 || d.Today.Answer != answer {
		t.Fatal("win failed", err)
	}
	_, err = s.Mutate(ctx, testdb.A, d.ID, day, "guess", Mutation{RequestID: testdb.ID(), Version: d.Today.Version, Guess: "stone"})
	requireCode(t, err, "round_over")
	*now = now.Add(24 * time.Hour)
	d, err = s.Get(ctx, d.ID, testdb.A)
	if err != nil {
		t.Fatal(err)
	}
	if d.Today.Streak != 1 || d.Today.CurrentPlayer != testdb.B || d.Today.hiddenAnswer == answer {
		t.Fatal("daily rollover or unseen selection failed")
	}
	bytes, _ := json.Marshal(d)
	if strings.Contains(string(bytes), d.Today.hiddenAnswer) {
		t.Fatal("today's answer leaked")
	}
	*now = now.Add(48 * time.Hour)
	d, err = s.Get(ctx, d.ID, testdb.A)
	if err != nil || d.Today.Streak != 0 {
		t.Fatal("missed day did not break streak", err)
	}
	var count int
	s.db.QueryRow(ctx, `select count(*) from duo_days where duo_id=$1`, d.ID).Scan(&count)
	if count != 3 {
		t.Fatal("created a playable missed date")
	}
}

func TestPostgresSharedHintUnlocksAndDoesNotUseTurn(t *testing.T) {
	s, d, _ := fixture(t)
	ctx := context.Background()
	day := d.Today.Board
	_, err := s.Mutate(ctx, testdb.A, d.ID, day, "guess", Mutation{RequestID: testdb.ID(), Version: d.Today.Version, Guess: "zzzzz"})
	requireCode(t, err, "not_a_word")
	d, err = s.Mutate(ctx, testdb.A, d.ID, day, "pass", Mutation{RequestID: testdb.ID(), Version: d.Today.Version})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Mutate(ctx, testdb.B, d.ID, day, "hint", Mutation{RequestID: testdb.ID(), Version: d.Today.Version})
	requireCode(t, err, "hint_locked")

	for i := 0; i < 3; i++ {
		player := d.Today.CurrentPlayer
		guess := "adieu"
		if guess == d.Today.hiddenAnswer {
			guess = "stone"
		}
		d, err = s.Mutate(ctx, player, d.ID, day, "guess", Mutation{RequestID: testdb.ID(), Version: d.Today.Version, Guess: guess})
		if err != nil {
			t.Fatal(err)
		}
	}
	turnBefore := d.Today.CurrentPlayer
	rowsBefore := len(d.Today.Rows)
	info, ok := s.words.WordInfo(d.Today.hiddenAnswer)
	if !ok || len(info.Hints) == 0 {
		t.Fatal("answer has no authored hint")
	}
	mutation := Mutation{RequestID: testdb.ID(), Version: d.Today.Version}
	// The player who is not up can reveal the clue for the pair.
	notCurrent := testdb.A
	if notCurrent == turnBefore {
		notCurrent = testdb.B
	}
	d, err = s.Mutate(ctx, notCurrent, d.ID, day, "hint", mutation)
	if err != nil {
		t.Fatal(err)
	}
	if d.Today.Hint == nil || d.Today.Hint.Tier != 1 || d.Today.Hint.Text != info.Hints[0] || d.Today.CurrentPlayer != turnBefore || len(d.Today.Rows) != rowsBefore {
		t.Fatal("hint was not shared without consuming a turn or guess")
	}
	if d.Today.Answer != "" || d.Today.Entry != nil {
		t.Fatal("revealing a hint exposed the answer")
	}
	dayJSON, _ := json.Marshal(d.Today)
	var publicDay map[string]json.RawMessage
	if err := json.Unmarshal(dayJSON, &publicDay); err != nil || publicDay["answer"] != nil || publicDay["entry"] != nil {
		t.Fatal("active board response leaked the answer or entry")
	}
	retry, err := s.Mutate(ctx, notCurrent, d.ID, day, "hint", mutation)
	if err != nil || retry.Today.Hint == nil || retry.Today.Hint.Text != info.Hints[0] || len(retry.Today.Rows) != rowsBefore {
		t.Fatal("hint retry was not idempotent", err)
	}
	restarted := New(s.db, words.NewPool())
	restarted.Now = s.Now
	restored, err := restarted.Get(ctx, d.ID, testdb.B)
	if err != nil || restored.Today.Hint == nil || restored.Today.Hint.Text != info.Hints[0] || restored.Today.Answer != "" {
		t.Fatal("hint did not persist safely", err)
	}
	_, err = s.Mutate(ctx, testdb.A, d.ID, day, "hint", Mutation{RequestID: testdb.ID(), Version: restored.Today.Version})
	if err != nil {
		t.Fatal("a repeated hint request should return the shared clue", err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, player := range []string{testdb.A, testdb.B} {
		wg.Add(1)
		go func(player string) {
			defer wg.Done()
			result, e := s.Mutate(ctx, player, d.ID, day, "hint", Mutation{RequestID: testdb.ID(), Version: d.Today.Version})
			if e == nil && (result.Today.Hint == nil || result.Today.Hint.Text != info.Hints[0]) {
				e = errors.New("concurrent hint request returned a different clue")
			}
			errs <- e
		}(player)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal("concurrent hint retry failed", e)
		}
	}
	answer := d.Today.hiddenAnswer
	d, err = s.Mutate(ctx, d.Today.CurrentPlayer, d.ID, day, "guess", Mutation{RequestID: testdb.ID(), Version: d.Today.Version, Guess: answer})
	if err != nil || d.Today.State != "won" {
		t.Fatal("could not close hinted board", err)
	}
	_, err = s.Mutate(ctx, testdb.A, d.ID, day, "hint", Mutation{RequestID: testdb.ID(), Version: d.Today.Version})
	requireCode(t, err, "round_over")
}
func TestPostgresRaces(t *testing.T) {
	s, d, _ := fixture(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Mutate(ctx, testdb.A, d.ID, d.Today.Date, "guess", Mutation{RequestID: testdb.ID(), Version: 0, Guess: "adieu"})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	wins := 0
	for err := range errs {
		if err == nil {
			wins++
		} else {
			requireCode(t, err, "stale")
		}
	}
	if wins != 1 {
		t.Fatal("both guesses claimed a row")
	}
	restored, err := s.Get(ctx, d.ID, testdb.B)
	if err != nil || len(restored.Today.Rows) != 1 {
		t.Fatal("bad race result", err)
	}
	// The same guarantee holds when a guess races a pass.
	errs = make(chan error, 2)
	for _, action := range []string{"guess", "pass"} {
		wg.Add(1)
		go func(action string) {
			defer wg.Done()
			_, err := s.Mutate(ctx, testdb.B, d.ID, d.Today.Date, action, Mutation{RequestID: testdb.ID(), Version: 1, Guess: "stone"})
			errs <- err
		}(action)
	}
	wg.Wait()
	close(errs)
	wins = 0
	for err := range errs {
		if err == nil {
			wins++
		} else {
			requireCode(t, err, "stale")
		}
	}
	if wins != 1 {
		t.Fatal("guess and pass both claimed a turn")
	}
}

func TestPostgresFirstGuessLossAndCrossedInvites(t *testing.T) {
	s, d, _ := fixture(t)
	ctx := context.Background()
	answer := d.Today.hiddenAnswer
	won, err := s.Mutate(ctx, testdb.A, d.ID, d.Today.Date, "guess", Mutation{RequestID: testdb.ID(), Guess: answer})
	if err != nil || won.Today.State != "won" || won.Today.Streak != 1 || len(won.Today.Rows) != 1 {
		t.Fatal("first guess must count for the pair", err)
	}
	for _, mark := range won.Today.Rows[0].Marks {
		if mark != "hit" {
			t.Fatal("wire marks must use string labels")
		}
	}
	s, d, _ = fixture(t)
	for i := 0; i < 6; i++ {
		wrong := "adieu"
		if d.Today.hiddenAnswer == wrong {
			wrong = "stone"
		}
		d, err = s.Mutate(ctx, d.Today.CurrentPlayer, d.ID, d.Today.Date, "guess", Mutation{RequestID: testdb.ID(), Version: d.Today.Version, Guess: wrong})
		if err != nil {
			t.Fatal(err)
		}
	}
	if d.Today.State != "lost" || d.Today.Streak != 0 || d.Today.Answer == "" {
		t.Fatal("six guesses did not finish the board")
	}
	ctx = context.Background()
	s = New(testdb.Open(t), words.NewPool())
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, p := range []string{testdb.A, testdb.B} {
		wg.Add(1)
		go func(p string) {
			defer wg.Done()
			_, e := s.Mutate(ctx, p, "", "", "invite", Mutation{RequestID: testdb.ID(), FriendshipID: testdb.Friendship, Timezone: "UTC"})
			errs <- e
		}(p)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	list, e := s.List(ctx, testdb.A)
	if e != nil || len(list) != 1 || list[0].Status != "active" {
		t.Fatal("crossed invites did not make one active partnership", e)
	}
}
func TestPostgresInvitationsAndEnd(t *testing.T) {
	ctx := context.Background()
	s := New(testdb.Open(t), words.NewPool())
	m := Mutation{RequestID: testdb.ID(), FriendshipID: testdb.Friendship, Timezone: "Asia/Kolkata"}
	d, err := s.Mutate(ctx, testdb.A, "", "", "invite", m)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Mutate(ctx, testdb.A, d.ID, "", "accept", Mutation{RequestID: testdb.ID()})
	requireCode(t, err, "invalid_action")
	crossed, err := s.Mutate(ctx, testdb.B, "", "", "invite", Mutation{RequestID: testdb.ID(), FriendshipID: testdb.Friendship, Timezone: "UTC"})
	if err != nil || crossed.ID != d.ID || crossed.Status != "active" || crossed.Timezone != "Asia/Kolkata" {
		t.Fatal("crossed invitation failed", err)
	}
	d, err = s.Mutate(ctx, testdb.A, d.ID, "", "end", Mutation{RequestID: testdb.ID(), Version: crossed.Version})
	if err != nil || d.Status != "ended" || len(d.Recent) != 1 || d.Recent[0].State != "closed" {
		t.Fatal("end lost history", err)
	}
	fresh, err := s.Mutate(ctx, testdb.A, "", "", "invite", Mutation{RequestID: testdb.ID(), FriendshipID: testdb.Friendship, Timezone: "UTC"})
	if err != nil || fresh.ID == d.ID {
		t.Fatal("restart reused streak", err)
	}
	_, err = s.Mutate(ctx, testdb.A, fresh.ID, "", "cancel", Mutation{RequestID: testdb.ID(), Version: fresh.Version})
	if err != nil {
		t.Fatal(err)
	}
	fresh, err = s.Mutate(ctx, testdb.A, "", "", "invite", Mutation{RequestID: testdb.ID(), FriendshipID: testdb.Friendship, Timezone: "UTC"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Mutate(ctx, testdb.B, fresh.ID, "", "decline", Mutation{RequestID: testdb.ID(), Version: fresh.Version})
	if err != nil {
		t.Fatal(err)
	}
}
func TestPostgresExpiryAndExhaustion(t *testing.T) {
	s, d, now := fixture(t)
	ctx := context.Background()
	old := d.Today.Date
	firstAnswer := d.Today.hiddenAnswer
	deadline := d.Today.Deadline
	*now = deadline
	_, err := s.Mutate(ctx, testdb.A, d.ID, old, "guess", Mutation{RequestID: testdb.ID(), Guess: "stone"})
	requireCode(t, err, "round_over")
	d, err = s.Get(ctx, d.ID, testdb.A)
	if err != nil || d.Recent[0].State != "expired" {
		t.Fatal("deadline not enforced", err)
	}
	seen := map[string]bool{d.Today.hiddenAnswer: true, firstAnswer: true}
	poolSize := len(s.words.DuoCandidates(game.WordLength))
	for i := 0; i < poolSize-2; i++ {
		*now = now.Add(24 * time.Hour)
		d, err = s.Get(ctx, d.ID, testdb.A)
		if err != nil {
			t.Fatal(err)
		}
		if seen[d.Today.hiddenAnswer] {
			t.Fatal("repeated before exhausting pool")
		}
		seen[d.Today.hiddenAnswer] = true
	}
	*now = now.Add(24 * time.Hour)
	d, err = s.Get(ctx, d.ID, testdb.A)
	if err != nil {
		t.Fatal(err)
	}
	var cycle int
	s.db.QueryRow(ctx, `select cycle from duo_days where duo_id=$1 and day=$2`, d.ID, d.Today.Date).Scan(&cycle)
	if cycle != 1 {
		t.Fatalf("cycle %d", cycle)
	}
	if len(d.Recent) != 7 {
		t.Fatal("recent limit not enforced")
	}
	if err := s.Heartbeat(ctx, testdb.A); err != nil {
		t.Fatal(err)
	}
	online, err := s.OnlinePlayers(ctx, []string{testdb.A})
	if err != nil {
		t.Fatal(err)
	}
	if !online[testdb.A] {
		t.Fatal("heartbeat missing")
	}
	*now = now.Add(90 * time.Second)
	online, err = s.OnlinePlayers(ctx, []string{testdb.A})
	if err != nil {
		t.Fatal(err)
	}
	if online[testdb.A] {
		t.Fatal("presence did not expire")
	}
}

func TestPostgresBoardAndListReadWithoutWriteLock(t *testing.T) {
	s, d, _ := fixture(t)
	ctx := context.Background()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `select id from duos where id=$1 for update`, d.ID); err != nil {
		t.Fatal(err)
	}
	// A normal board poll and friends summary must finish while another
	// transaction owns the mutation lock. This also guards against hidden writes.
	readCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	board, err := s.Board(readCtx, d.ID, "today", testdb.A)
	if err != nil {
		t.Fatal("board read waited for the write lock", err)
	}
	if board.Today.Answer != "" || board.Today.Entry != nil || len(board.Recent) != 0 {
		t.Fatal("unsafe or oversized board snapshot")
	}
	list, err := s.List(readCtx, testdb.A)
	if err != nil || len(list) != 1 || len(list[0].Recent) != 0 {
		t.Fatal("summary read waited for the write lock or loaded history", err)
	}
}

func TestPostgresPresenceSharedBetweenInstances(t *testing.T) {
	s, _, now := fixture(t)
	ctx := context.Background()
	other := New(s.db, words.NewPool())
	other.Now = s.Now
	if err := s.Heartbeat(ctx, testdb.A); err != nil {
		t.Fatal(err)
	}
	online, err := other.OnlinePlayers(ctx, []string{testdb.A, testdb.B})
	if err != nil || !online[testdb.A] || online[testdb.B] {
		t.Fatal("presence not shared", online, err)
	}
	*now = now.Add(10 * time.Second)
	if err = s.Heartbeat(ctx, testdb.A); err != nil {
		t.Fatal(err)
	}
	var last time.Time
	if err = s.db.QueryRow(ctx, `select last_seen from player_presence where player_id=$1`, testdb.A).Scan(&last); err != nil {
		t.Fatal(err)
	}
	if !last.Equal(now.Add(-10 * time.Second)) {
		t.Fatal("heartbeat was not throttled")
	}
	*now = now.Add(80 * time.Second)
	online, err = other.OnlinePlayers(ctx, []string{testdb.A})
	if err != nil || online[testdb.A] {
		t.Fatal("presence failed to expire", err)
	}
	if err = s.Heartbeat(ctx, testdb.A); err != nil {
		t.Fatal(err)
	}
	online, err = other.OnlinePlayers(ctx, []string{testdb.A})
	if err != nil || !online[testdb.A] {
		t.Fatal("presence failed to reconnect", err)
	}
}

type queryCount struct{ count atomic.Int64 }

func (q *queryCount) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	q.count.Add(1)
	return ctx
}
func (q *queryCount) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func TestPostgresPollingCostIndependentOfHistory(t *testing.T) {
	s, d, now := fixture(t)
	ctx := context.Background()
	counter := &queryCount{}
	cfg := s.db.Config().Copy()
	cfg.ConnConfig.Tracer = counter
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	reader := New(pool, s.words)
	reader.Now = s.Now
	for history := 0; history <= 10; history++ {
		if history > 0 {
			*now = now.Add(24 * time.Hour)
			if _, err = s.Get(ctx, d.ID, testdb.A); err != nil {
				t.Fatal(err)
			}
		}
		counter.count.Store(0)
		snapshot, err := reader.Board(ctx, d.ID, "today", testdb.A)
		if err != nil {
			t.Fatal(err)
		}
		// Four application queries plus BEGIN/COMMIT. History must not increase
		// network trips, and an active poll must not include past answers.
		if n := counter.count.Load(); n != 6 {
			t.Fatalf("%d historical days: got %d statements, want 6", history, n)
		}
		if len(snapshot.Recent) != 0 || snapshot.Today.Answer != "" || snapshot.Today.Entry != nil {
			t.Fatal("poll exposed history or answer")
		}
	}
	// A bookmarked result stays readable after it drops out of Recent's seven.
	past, err := reader.Board(ctx, d.ID, d.Today.Board, testdb.A)
	if err != nil || past.Today.State != "expired" || past.Today.Answer == "" {
		t.Fatal("older history is unreadable", err)
	}
}

func TestPostgresReadUsesOneCalendarDate(t *testing.T) {
	s, d, _ := fixture(t)
	before := d.Today.Deadline.Add(-time.Nanosecond)
	after := d.Today.Deadline.Add(time.Second)
	calls := 0
	s.Now = func() time.Time {
		calls++
		if calls <= 2 {
			return before
		}
		return after
	}
	got, err := s.Board(context.Background(), d.ID, "today", testdb.A)
	if err != nil {
		t.Fatal("read crossing midnight failed", err)
	}
	if got.Today.Date != d.Today.Date || got.Today.State != "playing" || calls != 1 {
		t.Fatalf("read mixed calendar dates: %+v, clock reads %d", got.Today, calls)
	}
	s.Now = func() time.Time { return after }
	got, err = s.Board(context.Background(), d.ID, "today", testdb.A)
	if err != nil || got.Today.Date == d.Today.Date {
		t.Fatal("next read failed to roll over", err)
	}
}

func TestGetRejectsMalformedID(t *testing.T) {
	// Validation must happen before opening a database transaction.
	s := New(nil, nil)
	_, err := s.Get(context.Background(), "invalid-id", testdb.A)
	requireCode(t, err, "not_found")
}
