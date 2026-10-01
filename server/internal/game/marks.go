// Package game holds the pure rules of Wordle: how a guess is scored against an
// answer, whose turn it is, and what a round is worth. Nothing here touches I/O
// or storage, so it is all directly testable.
package game

import "strings"

// Mark is the result for a single letter position in a guess.
type Mark uint8

const (
	// MarkAbsent means the letter is not in the answer, or every copy of it has
	// already been accounted for by an earlier Hit or Present.
	MarkAbsent Mark = iota
	// MarkPresent means the letter is in the answer, but not at this position.
	MarkPresent
	// MarkHit means the letter is at this exact position.
	MarkHit
)

func (m Mark) String() string {
	switch m {
	case MarkHit:
		return "hit"
	case MarkPresent:
		return "present"
	default:
		return "absent"
	}
}

// MarkGuess scores guess against answer using the standard two-pass rule.
//
// The two passes matter for repeated letters. Exact positions are claimed first,
// then the remaining letters are matched against whatever is left over. Without
// that ordering, guessing ALLOY against LOYAL would light up both Ls as present
// even though the answer only has two, and the second L is already a hit.
//
// Both arguments are expected to be the same length; callers validate that
// before getting here.
func MarkGuess(guess, answer string) []Mark {
	g := []rune(strings.ToLower(guess))
	a := []rune(strings.ToLower(answer))

	marks := make([]Mark, len(g))

	// Count how many of each letter the answer has available to give out.
	remaining := make(map[rune]int, len(a))
	for _, r := range a {
		remaining[r]++
	}

	// Pass one: exact positions. These get first claim on the letter budget.
	for i := range g {
		if i < len(a) && g[i] == a[i] {
			marks[i] = MarkHit
			remaining[g[i]]--
		}
	}

	// Pass two: everything else, spending whatever budget pass one left behind.
	for i := range g {
		if marks[i] == MarkHit {
			continue
		}
		if remaining[g[i]] > 0 {
			marks[i] = MarkPresent
			remaining[g[i]]--
		}
	}

	return marks
}

// Solved reports whether every position is a hit.
func Solved(marks []Mark) bool {
	for _, m := range marks {
		if m != MarkHit {
			return false
		}
	}
	return len(marks) > 0
}
