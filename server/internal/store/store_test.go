package store

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jerkeyray/wordle/server/internal/game"
)

func TestSnapshotIsolationDuringHintRetries(t *testing.T) {
	ctx := context.Background()
	store := NewMemory(time.Hour)
	round := game.NewRound("round", "salve")
	for i := 0; i < game.HintUnlocksAfter(1); i++ {
		_ = round.Guess("crane", func(string) bool { return true })
	}
	_ = store.Create(ctx, round)
	before, _ := store.Get(ctx, round.ID)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			snapshot, err := store.Update(ctx, round.ID, func(r *game.Round) error {
				_, err := r.UseHint(1, []string{"A broad context.", "A closer association."})
				return err
			})
			if err != nil || snapshot.HintsUsed != 1 {
				t.Errorf("retry: %v", err)
			}
			_, _ = store.Get(ctx, round.ID)
		}()
	}
	wg.Wait()
	if before.HintsUsed != 0 || len(before.Hints) != 0 {
		t.Fatal("an earlier response changed after another request")
	}
	after, _ := store.Get(ctx, round.ID)
	if after.HintsUsed != 1 {
		t.Fatal("concurrent retries consumed multiple hints")
	}
}

func TestExpiryAndCompletedRunSnapshot(t *testing.T) {
	ctx := context.Background()
	store := NewMemory(time.Hour)
	round := game.NewRound("round", "salve")
	round.UpdatedAt = time.Now().Add(-2 * time.Hour)
	_ = store.Create(ctx, round)
	if _, err := store.Get(ctx, "round"); err != game.ErrRoundNotFound {
		t.Fatal("expired round survived")
	}
	run, _ := game.NewRun("run", []string{"salve"})
	_, _ = run.StartRound("round")
	_ = round.Guess("salve", func(string) bool { return true })
	run.RecordRound(round)
	_ = store.CreateRun(ctx, run)
	snapshot, _ := store.GetRun(ctx, "run")
	snapshot.Results[0].HintsUsed = 10
	snapshot.RoundIDs[0] = "changed"
	restored, _ := store.GetRun(ctx, "run")
	if restored.Results[0].HintsUsed != 0 || restored.RoundIDs[0] != "round" {
		t.Fatal("caller mutated stored run")
	}
	if restored.Results[0].Reveal() != "salve" {
		t.Fatal("completed answer not retained")
	}
}

func TestMemoryUpdateFailureRollsBack(t *testing.T) {
	ctx := context.Background()
	s := NewMemory(0)
	r := game.NewRound("round", "adieu")
	if err := s.Create(ctx, r); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(ctx, r.ID, func(staged *game.Round) error {
		staged.Rows = append(staged.Rows, game.Row{Guess: "crane"})
		return game.ErrNotAWord
	}); err == nil {
		t.Fatal("expected update failure")
	}
	got, err := s.Get(ctx, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Rows) != 0 {
		t.Fatalf("failed update published rows: %#v", got.Rows)
	}
}

func TestMemoryRunAndRoundDealIsAtomicAndOnlyAdvancesOnce(t *testing.T) {
	ctx := context.Background()
	s := NewMemory(time.Hour)
	run, err := game.NewRun("run", []string{"adieu", "crane"})
	if err != nil {
		t.Fatal(err)
	}
	first, board, err := s.CreateRunWithFirstRound(ctx, run, "first")
	if err != nil {
		t.Fatal(err)
	}
	if first.Started() != 1 || board.Answer() != "adieu" {
		t.Fatalf("unexpected first deal: %#v %#v", first, board)
	}
	if _, _, err := s.UpdateRoundAndRunMemory(ctx, board.ID, func(round *game.Round, run *game.Run) error {
		if err := round.Guess("adieu", func(string) bool { return true }); err != nil {
			return err
		}
		run.RecordRound(round)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	a, _, err := s.StartRunRound(ctx, run.ID, "second")
	if err != nil {
		t.Fatal(err)
	}
	if a.Started() != 2 {
		t.Fatalf("started count = %d, want 2", a.Started())
	}
	if _, _, err := s.StartRunRound(ctx, run.ID, "third"); err == nil {
		t.Fatal("second current board should prevent another deal")
	}
	current, err := s.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.Started() != 2 || current.RoundIDs[1] != "second" {
		t.Fatalf("unexpected run after rejected deal: %#v", current)
	}
}

func TestMemorySoloRunReceiptsReplayAndBindPayload(t *testing.T) {
	ctx := context.Background()
	s := NewMemory(time.Hour)
	run, err := game.NewRun("first-id", []string{"crane", "salve"})
	if err != nil {
		t.Fatal(err)
	}
	created, board, err := s.CreateRunWithFirstRoundRequest(ctx, run, "board-one", "create-request", "create-payload")
	if err != nil {
		t.Fatal(err)
	}
	replayed, replayedBoard, err := s.CreateRunWithFirstRoundRequest(ctx, run, "board-other", "create-request", "create-payload")
	if err != nil {
		t.Fatal(err)
	}
	if replayed.ID != created.ID || replayedBoard.ID != board.ID || replayed.Started() != 1 {
		t.Fatalf("creation retry changed the deal: %+v %+v", replayed, replayedBoard)
	}
	if _, _, err := s.CreateRunWithFirstRoundRequest(ctx, run, "board-third", "create-request", "different-payload"); err != game.ErrRequestReused {
		t.Fatalf("reused create ID error = %v", err)
	}
	if _, _, err := s.UpdateRoundAndRunMemory(ctx, board.ID, func(round *game.Round, run *game.Run) error {
		if err := round.Guess("crane", func(string) bool { return true }); err != nil {
			return err
		}
		run.RecordRound(round)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	first, next, err := s.StartRunRoundRequest(ctx, run.ID, "board-two", board.ID, "next-request", "next-payload")
	if err != nil {
		t.Fatal(err)
	}
	retryRun, retryBoard, err := s.StartRunRoundRequest(ctx, run.ID, "board-three", board.ID, "next-request", "next-payload")
	if err != nil {
		t.Fatal(err)
	}
	if retryRun.Started() != first.Started() || retryBoard.ID != next.ID {
		t.Fatalf("next-round retry changed the deal: %+v %+v", retryRun, retryBoard)
	}
	if _, _, err := s.StartRunRoundRequest(ctx, run.ID, "board-four", board.ID, "stale-request", "stale-payload"); err != game.ErrStaleRun {
		t.Fatalf("stale expected round error = %v", err)
	}
}
