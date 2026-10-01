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
	if got := r.Points(); got != 5 {
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
	if got := r.Points(); got != 0 {
		t.Errorf("score for an unsolved round = %d, want 0", got)
	}
}
func TestTurnSeatIsClosedOnceTheRoundEnds(t *testing.T) {
	r := NewRound("r1", ModeDuel, 0, "salve")
	if err := r.Guess(0, "salve", alwaysWord); err != nil {
		t.Fatal(err)
	}
	if got := r.TurnSeat(); got != -1 {
		t.Errorf("TurnSeat() after the round ended = %d, want -1", got)
	}
}

func TestHints(t *testing.T) {
	r := NewRound("r1", ModeSolo, 0, "salve")

	// Each hint reveals the next position the player does not yet know, left
	// to right, and never repeats one.
	wantLetters := []string{"s", "a", "l"}
	for tier, wantLetter := range wantLetters {
		got, err := r.UseHint(0, 3)
		if err != nil {
			t.Fatalf("hint %d: %v", tier, err)
		}
		if got.Tier != tier {
			t.Errorf("hint returned tier %d, want %d", got.Tier, tier)
		}
		if got.Position != tier {
			t.Errorf("hint revealed position %d, want %d", got.Position, tier)
		}
		if got.Letter != wantLetter {
			t.Errorf("hint revealed %q, want %q", got.Letter, wantLetter)
		}
	}

	if _, err := r.UseHint(0, 3); err != ErrNoHintsLeft {
		t.Errorf("fourth hint = %v, want ErrNoHintsLeft", err)
	}

}

// A hint must not sell back a position the player already worked out.
func TestHintSkipsPositionsAlreadyGuessed(t *testing.T) {
	r := NewRound("r1", ModeSolo, 0, "salve")

	// "slate" shares S at position 0 with the answer, so that is a hit.
	if err := r.Guess(0, "slate", alwaysWord); err != nil {
		t.Fatal(err)
	}

	got, err := r.UseHint(0, 3)
	if err != nil {
		t.Fatalf("hint: %v", err)
	}
	if got.Position == 0 {
		t.Error("hint revealed position 0, which the player had already guessed")
	}
	if got.Position != 1 || got.Letter != "a" {
		t.Errorf("hint revealed position %d (%q), want position 1 (\"a\")", got.Position, got.Letter)
	}
}

// Nothing left to reveal means nothing left to charge for.
func TestHintRefusedWhenEveryPositionIsKnown(t *testing.T) {
	r := NewRound("r1", ModeSolo, 0, "salve")
	for i := 0; i < WordLength; i++ {
		if _, err := r.UseHint(0, WordLength); err != nil {
			t.Fatalf("hint %d: %v", i, err)
		}
	}
	if _, err := r.UseHint(0, WordLength); err != ErrNoHintsLeft {
		t.Errorf("hint with nothing left = %v, want ErrNoHintsLeft", err)
	}
}

func TestHintsCostTheBoardThatUsedThem(t *testing.T) {
	r := NewRound("r1", ModeDuel, 1, "salve")
	if _, err := r.UseHint(1, 3); err != nil {
		t.Fatal(err)
	}
	if err := r.Guess(1, "salve", alwaysWord); err != nil {
		t.Fatal(err)
	}

	if got := r.Points(); got != 5 {
		t.Errorf("solved row 0 (6 pts) minus one hint = %d, want 5", got)
	}
}

// A board has one owner, so the other player cannot touch it.
func TestRoundRejectsTheOtherSeat(t *testing.T) {
	r := NewRound("r1", ModeDuel, 1, "salve")

	if got := r.TurnSeat(); got != 1 {
		t.Fatalf("TurnSeat() = %d, want 1", got)
	}
	if err := r.Guess(0, "crane", alwaysWord); err != ErrWrongSeat {
		t.Errorf("guess from the other seat = %v, want ErrWrongSeat", err)
	}
	if _, err := r.UseHint(0, 3); err != ErrWrongSeat {
		t.Errorf("hint from the other seat = %v, want ErrWrongSeat", err)
	}
}
