package game

import "testing"

// marksToString renders marks compactly so failures are readable: . absent,
// ? present, # hit.
func marksToString(marks []Mark) string {
	out := make([]byte, len(marks))
	for i, m := range marks {
		switch m {
		case MarkHit:
			out[i] = '#'
		case MarkPresent:
			out[i] = '?'
		default:
			out[i] = '.'
		}
	}
	return string(out)
}

func TestMarkGuess(t *testing.T) {
	cases := []struct {
		name   string
		guess  string
		answer string
		want   string
	}{
		{"all absent", "chunk", "spoil", "....."},
		{"all hit", "spoil", "spoil", "#####"},
		{
			// The second O has no budget left: the answer's only O was claimed
			// by the hit at index 2.
			name: "present and hit together", guess: "loops", answer: "spoil",
			want: "?.#??",
		},

		// The repeated-letter cases below are where most Wordle clones break.
		{
			// An exact match spends the letter budget first. Both of the
			// answer's Es are claimed by hits at indexes 2 and 4, so the E at
			// index 1 must go dark even though the answer clearly contains Es.
			name: "hits consume the budget before presents", guess: "geese", answer: "these",
			want: "..###",
		},
		{
			// Guess has three Es, answer has one. One present, the rest dark.
			name: "guess repeats more than answer has", guess: "eerie", answer: "crest",
			want: "?.?..",
		},
		{
			// Guess has two As and two Rs; the answer has one of each, so
			// exactly one of each pair lights up and the later copy goes dark.
			name: "each repeat gets one claim", guess: "array", answer: "ratio",
			want: "??...",
		},
		{
			// Every letter of ALLOY appears in LOYAL and none are positioned
			// right, so the whole row is present. The answer's two Ls cover
			// both of the guess's Ls.
			name: "full anagram with a repeat", guess: "alloy", answer: "loyal",
			want: "?????",
		},
		{
			// A hit in the middle of a repeated pair: index 1 is a hit, leaving
			// one L for the guess's other L at index 2.
			name: "repeat around a hit", guess: "allot", answer: "llama",
			want: "?#?..",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := marksToString(MarkGuess(tc.guess, tc.answer))
			if got != tc.want {
				t.Errorf("MarkGuess(%q, %q) = %q, want %q", tc.guess, tc.answer, got, tc.want)
			}
		})
	}
}

func TestMarkGuessIsCaseInsensitive(t *testing.T) {
	if got := marksToString(MarkGuess("SPOIL", "spoil")); got != "#####" {
		t.Errorf("uppercase guess = %q, want #####", got)
	}
}

func TestSolved(t *testing.T) {
	if !Solved(MarkGuess("spoil", "spoil")) {
		t.Error("exact guess should be solved")
	}
	if Solved(MarkGuess("spoil", "loops")) {
		t.Error("anagram should not be solved")
	}
	if Solved(nil) {
		t.Error("empty marks should not be solved")
	}
}

func TestPoints(t *testing.T) {
	want := []int{6, 5, 4, 3, 2, 1}
	for row, w := range want {
		if got := Points(row); got != w {
			t.Errorf("Points(%d) = %d, want %d", row, got, w)
		}
	}
}

func TestScore(t *testing.T) {
	cases := []struct {
		name      string
		solvedRow int
		hints     int
		want      int
	}{
		{"row 1 clean", 1, 0, 5},
		{"row 5 clean", 5, 0, 1},
		{"row 1 with one hint", 1, 1, 4},
		{"row 5 with two hints", 5, 2, 0},
		{"unsolved", -1, 0, 0},
		{"unsolved after hints never goes negative", -1, 3, 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Score(tc.solvedRow, tc.hints); got != tc.want {
				t.Errorf("Score(%d, %d) = %d, want %d", tc.solvedRow, tc.hints, got, tc.want)
			}
		})
	}
}
