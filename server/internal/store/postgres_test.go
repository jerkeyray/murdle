package store

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
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

	run, err := game.NewRun(NewID(), []string{"feral", "lurks", "grass"})
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
	if got.Mode != "classic" || len(got.Words) != 3 {
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

func TestPostgresRunRoundChangeRollsBackTogether(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	s := NewPostgres(db, time.Hour)
	run, err := game.NewRun(NewID(), []string{"crane", "salve"})
	if err != nil {
		t.Fatal(err)
	}
	started, round, err := s.CreateRunWithFirstRound(ctx, run, NewID())
	if err != nil {
		t.Fatal(err)
	}
	if started.Started() != 1 || round.Answer() != "crane" {
		t.Fatalf("first board missing: %+v %+v", started, round)
	}
	boom := errors.New("injected failure")
	_, _, err = s.UpdateRoundAndRun(ctx, round.ID, func(r *game.Round, _ *game.Run, _ pgx.Tx) error {
		if err := r.Guess("crane", func(string) bool { return true }); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("error = %v, want injected failure", err)
	}
	unchanged, err := s.Get(ctx, round.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(unchanged.Rows) != 0 || unchanged.State != game.StatePlaying {
		t.Fatalf("round update escaped rollback: %+v", unchanged)
	}
	runNow, err := s.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if runNow.Finished != 0 {
		t.Fatalf("run update escaped rollback: %+v", runNow)
	}
	finished, finishedRun, err := s.UpdateRoundAndRun(ctx, round.ID, func(r *game.Round, _ *game.Run, _ pgx.Tx) error {
		return r.Guess("crane", func(string) bool { return true })
	})
	if err != nil {
		t.Fatal(err)
	}
	if finished.State != game.StateWon || finishedRun.Finished != 1 || len(finishedRun.Results) != 1 {
		t.Fatalf("atomic completion missing: %+v %+v", finished, finishedRun)
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

func TestPostgresConcurrentNextRoundDealsOneBoard(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	s := NewPostgres(db, time.Hour)
	run, err := game.NewRun(NewID(), []string{"crane", "salve"})
	if err != nil {
		t.Fatal(err)
	}
	_, first, err := s.CreateRunWithFirstRound(ctx, run, NewID())
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.UpdateRoundAndRun(ctx, first.ID, func(round *game.Round, _ *game.Run, _ pgx.Tx) error {
		return round.Guess("crane", func(string) bool { return true })
	}); err != nil {
		t.Fatal(err)
	}
	ids := []string{NewID(), NewID()}
	var wg sync.WaitGroup
	errs := make([]error, len(ids))
	for i := range ids {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _, errs[i] = s.StartRunRound(ctx, run.ID, ids[i])
		}(i)
	}
	wg.Wait()
	dealt, rejected := 0, 0
	for i, err := range errs {
		if err == nil {
			dealt++
			continue
		}
		if !errors.Is(err, game.ErrRoundInPlay) {
			t.Fatalf("unexpected deal error: %v", err)
		}
		rejected++
		if _, getErr := s.Get(ctx, ids[i]); !errors.Is(getErr, game.ErrRoundNotFound) {
			t.Fatalf("rejected deal left an orphan board: %v", getErr)
		}
	}
	if dealt != 1 || rejected != 1 {
		t.Fatalf("successful deals=%d, rejected=%d", dealt, rejected)
	}
	current, err := s.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.Started() != 2 || current.Finished != 1 {
		t.Fatalf("run advanced inconsistently: %+v", current)
	}
}

func TestPostgresDuplicateFinalGuessRecordsOneResult(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	s := NewPostgres(db, time.Hour)
	run, err := game.NewRun(NewID(), []string{"crane"})
	if err != nil {
		t.Fatal(err)
	}
	_, round, err := s.CreateRunWithFirstRound(ctx, run, NewID())
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		_, _, err = s.UpdateRoundAndRun(ctx, round.ID, func(board *game.Round, _ *game.Run, _ pgx.Tx) error {
			if board.RequestIDs["final-request"] {
				return nil
			}
			if err := board.Guess("crane", func(string) bool { return true }); err != nil {
				return err
			}
			board.RequestIDs["final-request"] = true
			board.RequestFingerprints["final-request"] = "same-guess"
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	final, err := s.Get(ctx, round.ID)
	if err != nil {
		t.Fatal(err)
	}
	storedRun, err := s.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(final.Rows) != 1 || storedRun.Finished != 1 || len(storedRun.Results) != 1 {
		t.Fatalf("duplicate final guess changed history: round=%+v run=%+v", final, storedRun)
	}
}

func TestPostgresSoloMutationReceiptsAreTransactional(t *testing.T) {
	db := testdb.Open(t)
	ctx := context.Background()
	s := NewPostgres(db, time.Hour)
	run, err := game.NewRun(NewID(), []string{"crane", "salve"})
	if err != nil {
		t.Fatal(err)
	}
	created, first, err := s.CreateRunWithFirstRoundRequest(ctx, run, NewID(), "create-receipt", "payload-a")
	if err != nil {
		t.Fatal(err)
	}
	other, _ := game.NewRun(NewID(), []string{"adieu", "stone"})
	replayed, replayedFirst, err := s.CreateRunWithFirstRoundRequest(ctx, other, NewID(), "create-receipt", "payload-a")
	if err != nil {
		t.Fatal(err)
	}
	if replayed.ID != created.ID || replayedFirst.ID != first.ID {
		t.Fatalf("create receipt returned another deal: %+v %+v", replayed, replayedFirst)
	}
	if _, _, err := s.CreateRunWithFirstRoundRequest(ctx, other, NewID(), "create-receipt", "payload-b"); !errors.Is(err, game.ErrRequestReused) {
		t.Fatalf("reused creation ID error = %v", err)
	}
	if _, _, err := s.UpdateRoundAndRun(ctx, first.ID, func(round *game.Round, _ *game.Run, _ pgx.Tx) error {
		return round.Guess("crane", func(string) bool { return true })
	}); err != nil {
		t.Fatal(err)
	}
	dealt, second, err := s.StartRunRoundRequest(ctx, created.ID, NewID(), first.ID, "next-receipt", "payload-next")
	if err != nil {
		t.Fatal(err)
	}
	retried, retriedSecond, err := s.StartRunRoundRequest(ctx, created.ID, NewID(), first.ID, "next-receipt", "payload-next")
	if err != nil {
		t.Fatal(err)
	}
	if retried.ID != dealt.ID || retriedSecond.ID != second.ID || retried.Started() != 2 {
		t.Fatalf("next-round receipt changed the deal: %+v %+v", retried, retriedSecond)
	}
}
