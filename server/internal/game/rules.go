package game

// WordLength is the number of letters in every answer.
const WordLength = 5

// MaxRows is how many guesses a round allows. With two players alternating this
// gives each of them exactly three turns.
const MaxRows = 6

// Mode is how a round is played.
type Mode string

const (
	// ModeSolo is one player taking every row.
	ModeSolo Mode = "solo"
	// ModeShared is two players on one board alternating rows: the first player
	// takes rows 0, 2, 4 and the second takes rows 1, 3, 5.
	ModeShared Mode = "shared"
)

// SeatForRow returns which seat (0 or 1) plays the given row index.
//
// In solo mode there is only ever seat 0. In shared mode seats alternate, and
// firstSeat decides who opens — matches flip it every round so that the
// information disadvantage of going first evens out over a match.
func SeatForRow(mode Mode, firstSeat, row int) int {
	if mode == ModeSolo {
		return 0
	}
	return (firstSeat + row) % 2
}

// Points is what solving on the given row index is worth.
//
// Solving early is the skill being rewarded: by row 5 the board has told you
// almost everything, so it is worth a single point, while a row-1 read is worth
// five. A round nobody solves is worth nothing to either player.
func Points(row int) int {
	p := MaxRows - row
	if p < 0 {
		return 0
	}
	return p
}

// HintPenalty is deducted from a player's score for each hint tier they reveal.
const HintPenalty = 1

// Score is the final value of a round for one player.
//
// solvedRow is the row they solved on, or -1 if they did not solve. A score is
// never negative: burning hints on a round you lose costs you nothing extra.
func Score(solvedRow, hintsUsed int) int {
	var pts int
	if solvedRow >= 0 {
		pts = Points(solvedRow)
	}
	pts -= hintsUsed * HintPenalty
	if pts < 0 {
		return 0
	}
	return pts
}
