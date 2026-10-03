package game

import "strconv"

// WordLength is the number of letters in every answer.
const WordLength = 5

// MaxRows is how many guesses each word allows.
const MaxRows = 6

// LengthWord spells WordLength for player-facing prose, so a message telling
// someone how many letters to enter cannot disagree with the rule itself.
func LengthWord() string {
	switch WordLength {
	case 4:
		return "four"
	case 5:
		return "five"
	case 6:
		return "six"
	case 7:
		return "seven"
	case 8:
		return "eight"
	}
	return strconv.Itoa(WordLength)
}

// Points is what solving on the given row index is worth.
//
// Solving early is the skill being rewarded: by row 5 the board has told you
// almost everything, so it is worth a single point. Solving on the first guess
// earns six points; an unsolved round earns none.
func Points(row int) int {
	p := MaxRows - row
	if p < 0 {
		return 0
	}
	return p
}

// Score records assistance separately, without subtracting points.
// The second argument is retained for callers; stored historical scores are unchanged.
func Score(solvedRow, hintsUsed int) int {
	if solvedRow < 0 {
		return 0
	}
	return Points(solvedRow)
}
