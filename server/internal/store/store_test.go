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
	for i := 0; i < 2; i++ {
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
	run, _ := game.NewRun("run", "pack", []string{"salve"})
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
