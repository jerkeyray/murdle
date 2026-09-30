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

	// Hints are per seat, so the other player still has their full ladder —
	// and picks up where the revealed positions left off.
	got, err := r.UseHint(1, 3)
	if err != nil {
		t.Fatalf("other seat's first hint: %v", err)
	}
	if got.Position != 3 {
		t.Errorf("other seat's hint revealed position %d, want 3", got.Position)
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
