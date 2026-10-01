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

func TestSoloDealsOneBoardPerWord(t *testing.T) {
	run := newTestRun(t, ModeSolo)

	if run.Length() != 3 {
		t.Fatalf("Length() = %d, want 3", run.Length())
	}

	for i, want := range []string{"clout", "viral", "troll"} {
		word, seat, err := run.StartRound("round")
		if err != nil {
			t.Fatalf("board %d: %v", i, err)
		}
		if word != want {
			t.Errorf("board %d dealt %q, want %q", i, word, want)
		}
		if seat != 0 {
			t.Errorf("solo board %d went to seat %d, want 0", i, seat)
		}
		run.RecordResult(seat, 3)
	}

	if !run.Complete() {
		t.Error("run should be complete")
	}
}

// The heart of a duel: the same word is dealt twice, once to each player.
func TestDuelDealsEachWordToBothSeats(t *testing.T) {
	run := newTestRun(t, ModeDuel)

	if run.Length() != 6 {
		t.Fatalf("Length() = %d, want 6 (three words, two boards each)", run.Length())
	}

	type deal struct {
		word string
		seat int
	}
	want := []deal{
		{"clout", 0}, {"clout", 1},
		{"viral", 0}, {"viral", 1},
		{"troll", 0}, {"troll", 1},
	}

	for i, w := range want {
		word, seat, err := run.StartRound("round")
		if err != nil {
			t.Fatalf("board %d: %v", i, err)
		}
		if word != w.word || seat != w.seat {
			t.Errorf("board %d dealt %q to seat %d, want %q to seat %d",
				i, word, seat, w.word, w.seat)
		}
		run.RecordResult(seat, 0)
	}
}

// The property the whole format depends on: the first player must not be shown
// the word while the second still has to guess it blind.
func TestDuelHidesTheWordUntilBothHavePlayedIt(t *testing.T) {
	run := newTestRun(t, ModeDuel)

	if run.WordRevealed(0) {
		t.Fatal("word revealed before anyone played it")
	}

	// Seat 0 plays the first word.
	_, seat, err := run.StartRound("a")
	if err != nil {
		t.Fatal(err)
	}
	run.RecordResult(seat, 5)

	if run.WordRevealed(0) {
		t.Fatal("word revealed after only the first player finished — " +
			"the second would see the answer before guessing")
	}

	// Seat 1 plays the same word.
	_, seat, err = run.StartRound("b")
	if err != nil {
		t.Fatal(err)
	}
	run.RecordResult(seat, 3)

	if !run.WordRevealed(0) {
		t.Error("word still hidden after both players finished it")
	}
	if run.WordRevealed(1) {
		t.Error("a later word was revealed before it was played")
	}
}

func TestRunRefusesASecondBoardWhileOneIsInPlay(t *testing.T) {
	run := newTestRun(t, ModeDuel)

	if _, _, err := run.StartRound("round1"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := run.StartRound("round2"); err != ErrRoundInPlay {
		t.Fatalf("second board while one is in play = %v, want ErrRoundInPlay", err)
	}

	run.RecordResult(0, 4)
	if _, _, err := run.StartRound("round2"); err != nil {
		t.Errorf("board after the first finished: %v", err)
	}
}

func TestRunRefusesPastTheEnd(t *testing.T) {
	run := newTestRun(t, ModeSolo)
	for i := 0; i < run.Length(); i++ {
		if _, seat, err := run.StartRound("r"); err != nil {
			t.Fatal(err)
		} else {
			run.RecordResult(seat, 1)
		}
	}
	if _, _, err := run.StartRound("extra"); err != ErrRunComplete {
		t.Errorf("starting past the end = %v, want ErrRunComplete", err)
	}
}

func TestRunTotalsAndWinner(t *testing.T) {
	run := newTestRun(t, ModeDuel)

	if got := run.Winner(); got != -1 {
		t.Errorf("winner of an unfinished run = %d, want -1", got)
	}

	// Three words, each played by both seats.
	for _, r := range []struct{ seat, points int }{
		{0, 5}, {1, 0},
		{0, 0}, {1, 3},
		{0, 0}, {1, 4},
	} {
		run.RecordResult(r.seat, r.points)
	}

	if want := []int{5, 7}; run.Totals[0] != want[0] || run.Totals[1] != want[1] {
		t.Errorf("totals = %v, want %v", run.Totals, want)
	}
	if got := run.Winner(); got != 1 {
		t.Errorf("winner = %d, want 1", got)
	}
}

func TestRunDrawHasNoWinner(t *testing.T) {
	run := newTestRun(t, ModeDuel)
	for _, r := range []struct{ seat, points int }{
		{0, 4}, {1, 4}, {0, 2}, {1, 2}, {0, 0}, {1, 0},
	} {
		run.RecordResult(r.seat, r.points)
	}
	if got := run.Winner(); got != -1 {
		t.Errorf("winner of a drawn run = %d, want -1", got)
	}
}
