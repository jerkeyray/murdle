package store

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jerkeyray/wordle/server/internal/game"
	"github.com/jerkeyray/wordle/server/internal/testdb"
)

// The bug this store exists to fix: a run created by one instance has to be
// readable by another. Two separate Postgres values stand in for two
// containers, which is exactly what the memory store could not do.
func TestPostgresRunsCrossInstances(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	first := NewPostgres(db, time.Hour)
	second := NewPostgres(db, time.Hour)

	run, err := game.NewRun(NewID(), "touch-grass", []string{"feral", "lurks", "grass"})
	if err != nil {
		t.Fatal(err)
	}
	if err = first.CreateRun(ctx, run); err != nil {
		t.Fatal(err)
	}

	got, err := second.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("a second instance could not see the run: %v", err)
	}
	if got.PackID != "touch-grass" || len(got.Words) != 3 {
		t.Fatalf("round-tripped wrong: %+v", got)
	}

	// And dealing the first word, which is what used to fail in production.
	word, err := second.UpdateRun(ctx, run.ID, func(r *game.Run) error {
		_, e := r.StartRound("round-1")
		return e
	})
	if err != nil {
		t.Fatal(err)
	}
	if word.Started() != 1 {
		t.Fatalf("start was not persisted: %+v", word)
	}
	if again, _ := first.GetRun(ctx, run.ID); again.Started() != 1 {
		t.Fatal("the other instance still sees an undealt run")
	}
}

// The answer is unexported on purpose, so the mapping that persists it is the
// one place it can be lost. Rows, marks and hints have to survive too.
func TestPostgresRoundRoundTrip(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	s := NewPostgres(db, time.Hour)

	round := game.NewRound(NewID(), "salve")
	round.RunID = "run-7"
	if err := round.Guess("crane", func(string) bool { return true }); err != nil {
		t.Fatal(err)
	}
	if err := s.Create(ctx, round); err != nil {
		t.Fatal(err)
	}

	got, err := s.Get(ctx, round.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Answer() != "salve" {
		t.Fatalf("the answer did not survive storage: %q", got.Answer())
	}
	if got.RunID != "run-7" || len(got.Rows) != 1 || len(got.Rows[0].Marks) != game.WordLength {
		t.Fatalf("board did not survive: %+v", got)
	}
	if got.State != game.StatePlaying || got.SolvedRow != -1 {
		t.Fatalf("state did not survive: %+v", got)
	}

	// Hints are gated on accepted guesses, so play up to the first tier.
	for len(got.Rows) < game.HintUnlocksAfter(1) {
		if _, err = s.Update(ctx, round.ID, func(r *game.Round) error {
			return r.Guess("crane", func(string) bool { return true })
		}); err != nil {
			t.Fatal(err)
		}
		if got, err = s.Get(ctx, round.ID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = s.Update(ctx, round.ID, func(r *game.Round) error {
		_, e := r.UseHint(1, []string{"A broad context.", "A closer association."})
		return e
	}); err != nil {
		t.Fatal(err)
	}
	got, err = s.Get(ctx, round.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.HintsUsed != 1 || len(got.Hints) != 1 || got.Hints[0].Text != "A broad context." {
		t.Fatalf("hints did not survive: %+v", got.Hints)
	}
}

// Update holds a row lock across the read-modify-write, so twenty simultaneous
// taps must not claim twenty rows of a six-row board.
func TestPostgresUpdateIsAtomic(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	s := NewPostgres(db, time.Hour)

	round := game.NewRound(NewID(), "salve")
	if err := s.Create(ctx, round); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = s.Update(ctx, round.ID, func(r *game.Round) error {
				return r.Guess("crane", func(string) bool { return true })
			})
		}()
	}
	wg.Wait()

	got, err := s.Get(ctx, round.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Rows) != game.MaxRows {
		t.Fatalf("lost or duplicated writes: %d rows", len(got.Rows))
	}
}

// Past the ttl a record is gone, which is what keeps abandoned runs from
// accumulating forever.
func TestPostgresExpiry(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()

	round := game.NewRound(NewID(), "salve")
	if err := NewPostgres(db, time.Hour).Create(ctx, round); err != nil {
		t.Fatal(err)
	}
	if _, err := NewPostgres(db, time.Nanosecond).Get(ctx, round.ID); err != game.ErrRoundNotFound {
		t.Fatalf("expired round was still served: %v", err)
	}
	// A zero ttl keeps everything.
	if _, err := NewPostgres(db, 0).Get(ctx, round.ID); err != nil {
		t.Fatalf("zero ttl should keep records: %v", err)
	}
}
