package game

import "testing"

func newTestRun(t *testing.T, mode Mode) *Run {
	t.Helper()
	run, err := NewRun("run1", "pack1", mode, []string{"clout", "viral", "troll"})
	if err != nil {
		t.Fatalf("NewRun: %v", err)
	}
	return run
}

func TestNewRunRejectsAnEmptyWordList(t *testing.T) {
	if _, err := NewRun("r", "p", ModeSolo, nil); err != ErrEmptyWordList {
		t.Errorf("NewRun with no words = %v, want ErrEmptyWordList", err)
	}
}

func TestRunDealsWordsInOrder(t *testing.T) {
	run := newTestRun(t, ModeSolo)

	for i, want := range []string{"clout", "viral", "troll"} {
		got, _, err := run.StartRound("round")
		if err != nil {
			t.Fatalf("round %d: %v", i, err)
		}
		if got != want {
			t.Errorf("round %d dealt %q, want %q", i, got, want)
		}
		run.RecordResult([]int{3})
	}

	if !run.Complete() {
		t.Error("run should be complete after every word is played")
	}
	if _, _, err := run.StartRound("extra"); err != ErrRunComplete {
		t.Errorf("starting past the end = %v, want ErrRunComplete", err)
	}
}

// Without this guard a double-tap burns a word from the run and leaves an
// orphaned round behind it.
func TestRunRefusesASecondRoundWhileOneIsInPlay(t *testing.T) {
	run := newTestRun(t, ModeSolo)

	if _, _, err := run.StartRound("round1"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := run.StartRound("round2"); err != ErrRoundInPlay {
		t.Fatalf("second round while one is in play = %v, want ErrRoundInPlay", err)
	}

	run.RecordResult([]int{4})
	if _, _, err := run.StartRound("round2"); err != nil {
		t.Errorf("round after the first finished: %v", err)
	}
}

func TestRunAlternatesTheOpener(t *testing.T) {
	run := newTestRun(t, ModeShared)

	for index, want := range []int{0, 1, 0} {
		if got := run.FirstSeatFor(index); got != want {
			t.Errorf("round %d opens with seat %d, want %d", index, got, want)
		}
	}

	// Solo has only one seat to open with.
	solo := newTestRun(t, ModeSolo)
	for index := 0; index < solo.Length(); index++ {
		if got := solo.FirstSeatFor(index); got != 0 {
			t.Errorf("solo round %d opens with seat %d, want 0", index, got)
		}
	}
}

func TestRunTotalsAndWinner(t *testing.T) {
	run := newTestRun(t, ModeShared)

	if got := run.Winner(); got != -1 {
		t.Errorf("winner of an unfinished run = %d, want -1", got)
	}

	run.RecordResult([]int{5, 0})
	run.RecordResult([]int{0, 3})
	run.RecordResult([]int{0, 4})

	if want := []int{5, 7}; run.Totals[0] != want[0] || run.Totals[1] != want[1] {
		t.Errorf("totals = %v, want %v", run.Totals, want)
	}
	if got := run.Winner(); got != 1 {
		t.Errorf("winner = %d, want 1", got)
	}
}

func TestRunDrawHasNoWinner(t *testing.T) {
	run := newTestRun(t, ModeShared)
	run.RecordResult([]int{4, 4})
	run.RecordResult([]int{2, 2})
	run.RecordResult([]int{0, 0})

	if got := run.Winner(); got != -1 {
		t.Errorf("winner of a drawn run = %d, want -1", got)
	}
}
