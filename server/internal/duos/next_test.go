package duos

import (
	"context"
	"testing"
	"time"

	"github.com/jerkeyray/wordle/server/internal/game"
	"github.com/jerkeyray/wordle/server/internal/testdb"
)

// move plays one guess as whoever's turn it is on the latest board.
func move(t *testing.T, s *Store, d *Duo, guess string) *Duo {
	t.Helper()
	b := d.Today
	out, err := s.Mutate(context.Background(), b.CurrentPlayer, d.ID, b.Board, "guess", Mutation{RequestID: testdb.ID(), Version: b.Version, Guess: guess})
	if err != nil {
		t.Fatalf("guess %q on %s: %v", guess, b.Board, err)
	}
	return out
}

// win solves the latest board on the next turn.
func win(t *testing.T, s *Store, d *Duo) *Duo {
	t.Helper()
	out := move(t, s, d, d.Today.hiddenAnswer)
	if out.Today.State != "won" {
		t.Fatalf("board %s is %s, want won", out.Today.Board, out.Today.State)
	}
	return out
}

// lose spends every row on words that are not the answer.
func lose(t *testing.T, s *Store, d *Duo) *Duo {
	t.Helper()
	for _, g := range []string{"adieu", "stone", "crane", "slate", "house", "light", "money"} {
		if g == d.Today.hiddenAnswer || d.Today.State != "playing" {
			continue
		}
		d = move(t, s, d, g)
	}
	if d.Today.State != "lost" {
		t.Fatalf("board %s is %s, want lost", d.Today.Board, d.Today.State)
	}
	return d
}

func next(t *testing.T, s *Store, player string, d *Duo) (*Duo, error) {
	t.Helper()
	return s.Mutate(context.Background(), player, d.ID, "", "next", Mutation{RequestID: testdb.ID(), Version: d.Version})
}

func TestPostgresNextBoardSameDay(t *testing.T) {
	s, d, _ := fixture(t)
	ctx := context.Background()
	first := d.Today
	if first.Seq != 0 || first.Board != first.Date {
		t.Fatalf("first board is %q seq %d", first.Board, first.Seq)
	}

	// Nothing to start while the board is still being played.
	same, err := next(t, s, testdb.A, d)
	if err != nil || same.Today.Seq != 0 || same.Today.State != "playing" {
		t.Fatalf("next on a live board changed it: %v", err)
	}

	d = win(t, s, d)
	answer0 := d.Today.hiddenAnswer
	d, err = next(t, s, testdb.B, d)
	if err != nil {
		t.Fatal(err)
	}
	b := d.Today
	if b.Seq != 1 || b.Board != first.Date+".1" || b.Date != first.Date || b.State != "playing" {
		t.Fatalf("second board is %q seq %d state %s", b.Board, b.Seq, b.State)
	}
	if b.hiddenAnswer == answer0 {
		t.Fatal("next board repeated the word")
	}
	if len(b.Rows) != 0 || len(b.Passed) != 0 {
		t.Fatal("next board kept the last board's guesses or passes")
	}
	// A opened the first board, so B opens the second.
	if first.CurrentPlayer != testdb.A || b.CurrentPlayer != testdb.B {
		t.Fatalf("opener did not alternate: %s then %s", first.CurrentPlayer, b.CurrentPlayer)
	}

	// The other friend tapping at the same moment lands on the same board.
	again, err := next(t, s, testdb.A, d)
	if err != nil || again.Today.Seq != 1 || again.Today.hiddenAnswer != b.hiddenAnswer {
		t.Fatalf("a second tap made another board: %v", err)
	}
	var boards int
	s.db.QueryRow(ctx, `select count(*) from duo_days where duo_id=$1 and day=$2`, d.ID, first.Date).Scan(&boards)
	if boards != 2 {
		t.Fatalf("%d boards today, want 2", boards)
	}

	// The finished board no longer takes moves; the new one does.
	_, err = s.Mutate(ctx, testdb.B, d.ID, first.Board, "guess", Mutation{RequestID: testdb.ID(), Version: 0, Guess: "adieu"})
	requireCode(t, err, "round_over")
	d = move(t, s, d, "adieu")
	if len(d.Today.Rows) != 1 || d.Today.CurrentPlayer != testdb.A {
		t.Fatal("move on the second board did not count")
	}
	// A pass is per board: both friends may pass again here.
	d, err = s.Mutate(ctx, testdb.A, d.ID, d.Today.Board, "pass", Mutation{RequestID: testdb.ID(), Version: d.Today.Version})
	if err != nil || len(d.Today.Passed) != 1 {
		t.Fatalf("pass on the second board: %v", err)
	}

	// The finished board is still readable by its key.
	old, err := s.Board(ctx, d.ID, first.Board, testdb.A)
	if err != nil || old.Today.Seq != 0 || old.Today.Answer != answer0 || len(old.Today.Rows) != 1 {
		t.Fatalf("could not reopen the first board: %v", err)
	}
}

func TestPostgresNextBoardStreakCountsDays(t *testing.T) {
	s, d, now := fixture(t)
	d = win(t, s, d)
	if d.Today.Streak != 1 {
		t.Fatalf("streak after a win is %d", d.Today.Streak)
	}
	d, err := next(t, s, testdb.A, d)
	if err != nil {
		t.Fatal(err)
	}
	if d.Today.Streak != 1 {
		t.Fatalf("starting another game changed the streak to %d", d.Today.Streak)
	}
	d = lose(t, s, d)
	if d.Today.Streak != 1 {
		t.Fatalf("losing the extra game broke the day: streak %d", d.Today.Streak)
	}
	if len(d.Recent) < 2 {
		t.Fatalf("history has %d boards, want both of today's", len(d.Recent))
	}
	// And the streak carries into the next day.
	*now = now.Add(24 * time.Hour)
	d, err = s.Get(context.Background(), d.ID, testdb.A)
	if err != nil || d.Today.Seq != 0 || d.Today.Streak != 1 {
		t.Fatalf("next day: seq %d streak %d err %v", d.Today.Seq, d.Today.Streak, err)
	}
}

func TestPostgresNextBoardNeedsAnActiveGame(t *testing.T) {
	s, d, _ := fixture(t)
	ctx := context.Background()
	d = win(t, s, d)
	d, err := s.Mutate(ctx, testdb.A, d.ID, "", "end", Mutation{RequestID: testdb.ID(), Version: d.Version})
	if err != nil {
		t.Fatal(err)
	}
	_, err = next(t, s, testdb.A, d)
	requireCode(t, err, "invalid_action")
	_, err = s.Mutate(ctx, testdb.C, d.ID, "", "next", Mutation{RequestID: testdb.ID()})
	requireCode(t, err, "not_found")
}

func TestPostgresManyBoardsNeverRepeatAWord(t *testing.T) {
	s, d, _ := fixture(t)
	seen := map[string]bool{}
	for i := 0; i < 6; i++ {
		if seen[d.Today.hiddenAnswer] {
			t.Fatalf("board %d repeated %q", i, d.Today.hiddenAnswer)
		}
		seen[d.Today.hiddenAnswer] = true
		d = win(t, s, d)
		var err error
		if d, err = next(t, s, testdb.A, d); err != nil {
			t.Fatal(err)
		}
	}
}

func TestBoardKeys(t *testing.T) {
	for _, tc := range []struct {
		key  string
		date string
		seq  int
		ok   bool
	}{
		{"2026-10-05", "2026-10-05", 0, true},
		{"2026-10-05.1", "2026-10-05", 1, true},
		{"2026-10-05.12", "2026-10-05", 12, true},
		{"2026-10-05.0", "", 0, false},
		{"2026-10-05.01", "", 0, false},
		{"2026-10-05.x", "", 0, false},
		{"2026-13-05", "", 0, false},
		{"today", "", 0, false},
	} {
		date, seq, ok := parseBoard(tc.key)
		if date != tc.date || seq != tc.seq || ok != tc.ok {
			t.Errorf("parseBoard(%q) = %q, %d, %v", tc.key, date, seq, ok)
		}
	}
	if boardKey("2026-10-05", 0) != "2026-10-05" || boardKey("2026-10-05", 3) != "2026-10-05.3" {
		t.Error("boardKey does not round-trip")
	}
	members := []Member{{ID: "a"}, {ID: "b"}}
	if openingPlayer("2026-10-01", "2026-10-02", 0, members) != "b" || openingPlayer("2026-10-01", "2026-10-02", 1, members) != "a" {
		t.Error("opening turn does not alternate between boards")
	}
}

func TestPostgresBoardsOnlyUseFiveLetterWords(t *testing.T) {
	s, d, _ := fixture(t)
	for i := 0; i < 40; i++ {
		if len(d.Today.hiddenAnswer) != game.WordLength {
			t.Fatalf("board %d dealt %q, which no five-letter guess can solve", i, d.Today.hiddenAnswer)
		}
		d = win(t, s, d)
		var err error
		if d, err = next(t, s, testdb.A, d); err != nil {
			t.Fatal(err)
		}
	}
}
