package game

import "testing"

func newTestRun(t *testing.T) *Run {
	t.Helper()
	run, err := NewRun("run1", "pack1", []string{"clout", "viral", "troll"})
	if err != nil {
		t.Fatalf("NewRun: %v", err)
	}
	return run
}

func TestNewRunRejectsAnEmptyWordList(t *testing.T) {
	if _, err := NewRun("r", "p", nil); err != ErrEmptyWordList {
		t.Errorf("NewRun with no words = %v, want ErrEmptyWordList", err)
	}
}

func TestRunDealsWordsInOrder(t *testing.T) {
	run := newTestRun(t)

	for i, want := range []string{"clout", "viral", "troll"} {
		word, err := run.StartRound("round")
		if err != nil {
			t.Fatalf("word %d: %v", i, err)
		}
		if word != want {
			t.Errorf("word %d dealt %q, want %q", i, word, want)
		}
		run.RecordResult(3)
	}

	if !run.Complete() {
		t.Error("run should be complete after every word is played")
	}
	if run.Points != 9 {
		t.Errorf("Points = %d, want 9", run.Points)
	}
	if _, err := run.StartRound("extra"); err != ErrRunComplete {
		t.Errorf("starting past the end = %v, want ErrRunComplete", err)
	}
}

// Without this guard a double tap burns a word and orphans a round.
func TestRunRefusesASecondWordWhileOneIsInPlay(t *testing.T) {
	run := newTestRun(t)

	if _, err := run.StartRound("round1"); err != nil {
		t.Fatal(err)
	}
	if _, err := run.StartRound("round2"); err != ErrRoundInPlay {
		t.Fatalf("second word while one is in play = %v, want ErrRoundInPlay", err)
	}

	run.RecordResult(4)
	if _, err := run.StartRound("round2"); err != nil {
		t.Errorf("word after the first finished: %v", err)
	}
}
