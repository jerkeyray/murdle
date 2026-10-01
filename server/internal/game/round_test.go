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
	r := NewRound("r1", "salve")

	if r.State != StatePlaying {
		t.Fatalf("new round state = %q, want playing", r.State)
	}
	if r.Reveal() != "" {
		t.Fatal("answer leaked while the round was still in play")
	}

	if err := r.Guess("crane", alwaysWord); err != nil {
		t.Fatalf("first guess: %v", err)
	}
	if r.State != StatePlaying {
		t.Fatalf("state after a wrong guess = %q, want playing", r.State)
	}

	if err := r.Guess("salve", alwaysWord); err != nil {
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
	r := NewRound("r1", "salve")
	for i := 0; i < MaxRows; i++ {
		if err := r.Guess("crane", alwaysWord); err != nil {
			t.Fatalf("guess %d: %v", i, err)
		}
	}
	if r.State != StateLost {
		t.Fatalf("state after %d wrong guesses = %q, want lost", MaxRows, r.State)
	}
	if err := r.Guess("crane", alwaysWord); err != ErrRoundOver {
		t.Errorf("guessing past the end = %v, want ErrRoundOver", err)
	}
	if got := r.Points(); got != 0 {
		t.Errorf("score for an unsolved round = %d, want 0", got)
	}
}
func TestRoundClosesOnceSolved(t *testing.T) {
	r := NewRound("r1", "salve")
	if err := r.Guess("salve", alwaysWord); err != nil {
		t.Fatal(err)
	}
	if r.State != StateWon {
		t.Errorf("state after the answer = %q, want won", r.State)
	}
}

func TestAuthoredHints(t *testing.T) {
	clues := []string{"Often used after a minor injury.", "Think of something applied to soothe."}
	r := NewRound("r1", "salve")
	if _, err := r.UseHint(0, clues); err != ErrInvalidHint {
		t.Fatalf("invalid tier: %v", err)
	}
	if _, err := r.UseHint(1, clues); err != ErrHintLocked {
		t.Fatalf("early hint: %v", err)
	}
	for i := 0; i < 2; i++ {
		_ = r.Guess("crane", alwaysWord)
	}
	first, err := r.UseHint(1, clues)
	if err != nil || first.Text != clues[0] {
		t.Fatalf("first: %v %v", first, err)
	}
	again, err := r.UseHint(1, clues)
	if err != nil || first != again || r.HintsUsed != 1 {
		t.Fatalf("retry consumed a hint: %+v %v", r, err)
	}
	if _, err := r.UseHint(2, clues); err != ErrHintLocked {
		t.Fatalf("second unlocked early: %v", err)
	}
	for i := 0; i < 2; i++ {
		_ = r.Guess("crane", alwaysWord)
	}
	if _, err := r.UseHint(2, clues); err != nil {
		t.Fatal(err)
	}
	if _, err := r.UseHint(3, clues); err != ErrInvalidHint {
		t.Fatalf("extra tier: %v", err)
	}
	_ = r.Guess("salve", alwaysWord)
	if r.Points() != 2 {
		t.Fatalf("hints reduced points: %d", r.Points())
	}
	if _, err := r.UseHint(1, clues); err != ErrRoundOver {
		t.Fatalf("finished hint: %v", err)
	}
}

func TestHintsRequireFirstTierAndAcceptedGuesses(t *testing.T) {
	r := NewRound("r", "salve")
	clues := []string{"A context", "An association"}
	for i := 0; i < 4; i++ {
		_ = r.Guess("zzzzz", onlyWords("crane"))
	}
	if _, err := r.UseHint(1, clues); err != ErrHintLocked {
		t.Fatal("invalid guesses unlocked hints")
	}
	for i := 0; i < 4; i++ {
		_ = r.Guess("crane", alwaysWord)
	}
	if _, err := r.UseHint(2, clues); err != ErrHintLocked {
		t.Fatal("skipped the first hint")
	}
}
