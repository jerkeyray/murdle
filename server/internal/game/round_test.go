package game

import "testing"

// alwaysWord accepts anything, for tests that are not about validation.
func alwaysWord(string) bool { return true }

// onlyWords accepts a fixed set.
func onlyWords(ws ...string) func(string) bool {
	set := make(map[string]struct{}, len(ws))
	for _, w := range ws {
		set[w] = struct{}{}
	}
	return func(g string) bool {
		_, ok := set[g]
		return ok
	}
}

func TestRoundHappyPath(t *testing.T) {
	r := NewRound("r1", ModeSolo, 0, "salve")

	if r.State != StatePlaying {
		t.Fatalf("new round state = %q, want playing", r.State)
	}
	if r.Reveal() != "" {
		t.Fatal("answer leaked while the round was still in play")
	}

	if err := r.Guess(0, "crane", alwaysWord); err != nil {
		t.Fatalf("first guess: %v", err)
	}
	if r.State != StatePlaying {
		t.Fatalf("state after a wrong guess = %q, want playing", r.State)
	}

	if err := r.Guess(0, "salve", alwaysWord); err != nil {
		t.Fatalf("winning guess: %v", err)
	}
	if r.State != StateWon {
		t.Fatalf("state after the answer = %q, want won", r.State)
	}
	if r.SolvedRow != 1 {
		t.Errorf("SolvedRow = %d, want 1", r.SolvedRow)
	}
	if r.Reveal() != "salve" {
		t.Errorf("Reveal() = %q, want salve once the round is over", r.Reveal())
	}
	if got := r.Scores()[0]; got != 5 {
		t.Errorf("score for solving on row 1 = %d, want 5", got)
	}
}

func TestRoundRunsOutOfRows(t *testing.T) {
	r := NewRound("r1", ModeSolo, 0, "salve")
	for i := 0; i < MaxRows; i++ {
		if err := r.Guess(0, "crane", alwaysWord); err != nil {
			t.Fatalf("guess %d: %v", i, err)
		}
	}
	if r.State != StateLost {
		t.Fatalf("state after %d wrong guesses = %q, want lost", MaxRows, r.State)
	}
	if err := r.Guess(0, "crane", alwaysWord); err != ErrRoundOver {
		t.Errorf("guessing past the end = %v, want ErrRoundOver", err)
	}
	if got := r.Scores()[0]; got != 0 {
		t.Errorf("score for an unsolved round = %d, want 0", got)
	}
}

func TestRoundValidatesGuesses(t *testing.T) {
	r := NewRound("r1", ModeSolo, 0, "salve")
	isWord := onlyWords("crane")

	if err := r.Guess(0, "four", isWord); err != ErrWrongLength {
		t.Errorf("short guess = %v, want ErrWrongLength", err)
	}
	if err := r.Guess(0, "zzzzz", isWord); err != ErrNotAWord {
		t.Errorf("non-word = %v, want ErrNotAWord", err)
	}
	if len(r.Rows) != 0 {
		t.Errorf("rejected guesses consumed %d rows, want 0", len(r.Rows))
	}
}

func TestSharedRoundAlternatesSeats(t *testing.T) {
	r := NewRound("r1", ModeShared, 0, "salve")

	if got := r.TurnSeat(); got != 0 {
		t.Fatalf("opening turn = seat %d, want 0", got)
	}
	if err := r.Guess(1, "crane", alwaysWord); err != ErrWrongSeat {
		t.Fatalf("out-of-turn guess = %v, want ErrWrongSeat", err)
	}

	if err := r.Guess(0, "crane", alwaysWord); err != nil {
		t.Fatalf("seat 0 guess: %v", err)
	}
	if got := r.TurnSeat(); got != 1 {
		t.Fatalf("turn after seat 0 = seat %d, want 1", got)
	}
	if err := r.Guess(1, "moist", alwaysWord); err != nil {
		t.Fatalf("seat 1 guess: %v", err)
	}
	if got := r.TurnSeat(); got != 0 {
		t.Errorf("turn after seat 1 = seat %d, want 0", got)
	}
}

func TestSharedRoundHonoursFirstSeat(t *testing.T) {
	r := NewRound("r1", ModeShared, 1, "salve")
	if got := r.TurnSeat(); got != 1 {
		t.Errorf("opening turn with firstSeat=1 = seat %d, want 1", got)
	}
}

// Only the seat that lands the winning guess scores for the solve — the other
// seat gets nothing for that round even though they helped narrow it down.
func TestSharedRoundScoresOnlyTheSolver(t *testing.T) {
	r := NewRound("r1", ModeShared, 0, "salve")
	if err := r.Guess(0, "crane", alwaysWord); err != nil {
		t.Fatal(err)
	}
	if err := r.Guess(1, "salve", alwaysWord); err != nil {
		t.Fatal(err)
	}

	scores := r.Scores()
	if scores[1] != 5 {
		t.Errorf("solver (seat 1, row 1) scored %d, want 5", scores[1])
	}
	if scores[0] != 0 {
		t.Errorf("non-solver scored %d, want 0", scores[0])
	}
}

func TestTurnSeatIsClosedOnceTheRoundEnds(t *testing.T) {
	r := NewRound("r1", ModeShared, 0, "salve")
	if err := r.Guess(0, "salve", alwaysWord); err != nil {
		t.Fatal(err)
	}
	if got := r.TurnSeat(); got != -1 {
		t.Errorf("TurnSeat() after the round ended = %d, want -1", got)
	}
}

func TestHints(t *testing.T) {
	r := NewRound("r1", ModeShared, 0, "salve")

	for tier := 0; tier < 3; tier++ {
		got, err := r.UseHint(0, 3)
		if err != nil {
			t.Fatalf("hint %d: %v", tier, err)
		}
		if got != tier {
			t.Errorf("hint returned tier %d, want %d", got, tier)
		}
	}
	if _, err := r.UseHint(0, 3); err != ErrNoHintsLeft {
		t.Errorf("fourth hint = %v, want ErrNoHintsLeft", err)
	}

	// Hints are per seat, so the other player still has their full ladder.
	if _, err := r.UseHint(1, 3); err != nil {
		t.Errorf("other seat's first hint: %v", err)
	}
}

func TestHintsCostTheSeatThatUsedThem(t *testing.T) {
	r := NewRound("r1", ModeShared, 0, "salve")
	if _, err := r.UseHint(0, 3); err != nil {
		t.Fatal(err)
	}
	if err := r.Guess(0, "salve", alwaysWord); err != nil {
		t.Fatal(err)
	}

	scores := r.Scores()
	if scores[0] != 5 {
		t.Errorf("solved row 0 (6 pts) minus one hint = %d, want 5", scores[0])
	}
	if scores[1] != 0 {
		t.Errorf("seat that used no hints scored %d, want 0", scores[1])
	}
}
