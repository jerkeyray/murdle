package duos

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jerkeyray/wordle/server/internal/game"
	"github.com/jerkeyray/wordle/server/internal/testdb"
	"github.com/jerkeyray/wordle/server/internal/words"
	"strings"
	"sync"
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
	poolSize := 0
	for _, pack := range s.words.Packs() {
		// Shared boards only deal five-letter words.
		if pack.WordLength() == game.WordLength {
			poolSize += len(pack.Words)
		}
	}
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
	s.Heartbeat(testdb.A)
	if !s.Online(testdb.A) {
		t.Fatal("heartbeat missing")
	}
	*now = now.Add(90 * time.Second)
	if s.Online(testdb.A) {
		t.Fatal("presence did not expire")
	}
}
