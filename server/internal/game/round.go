package game

import (
	"errors"
	"strings"
	"time"
)

// State is where a round is in its lifecycle.
type State string

const (
	StatePlaying State = "playing"
	StateWon     State = "won"
	StateLost    State = "lost"
)

// Errors a caller can reasonably act on. Handlers map these to status codes.
var (
	ErrRoundOver     = errors.New("round is already over")
	ErrWrongLength   = errors.New("guess is the wrong length")
	ErrNotAWord      = errors.New("guess is not a word")
	ErrWrongSeat     = errors.New("not this seat's turn")
	ErrNoHintsLeft   = errors.New("no hints left")
	ErrRoundNotFound = errors.New("round not found")
)

// Row is one submitted guess and how it scored.
type Row struct {
	Seat  int    `json:"seat"`
	Guess string `json:"guess"`
	Marks []Mark `json:"marks"`
}

// Round is a single word being played. The answer is unexported and never
// serialized — the client learns it only through Reveal, after the round ends.
type Round struct {
	ID        string
	Mode      Mode
	FirstSeat int
	Rows      []Row
	HintsUsed [2]int
	SolvedRow int
	State     State
	CreatedAt time.Time
	UpdatedAt time.Time

	answer string
}

// NewRound starts a round on the given answer.
func NewRound(id string, mode Mode, firstSeat int, answer string) *Round {
	now := time.Now().UTC()
	return &Round{
		ID:        id,
		Mode:      mode,
		FirstSeat: firstSeat,
		Rows:      make([]Row, 0, MaxRows),
		SolvedRow: -1,
		State:     StatePlaying,
		CreatedAt: now,
		UpdatedAt: now,
		answer:    strings.ToLower(answer),
	}
}

// Answer returns the hidden word. Callers are responsible for only exposing it
// once the round is over; Reveal does that check for them.
func (r *Round) Answer() string { return r.answer }

// TurnSeat is whose turn it is now, or -1 once the round is over.
func (r *Round) TurnSeat() int {
	if r.State != StatePlaying {
		return -1
	}
	return SeatForRow(r.Mode, r.FirstSeat, len(r.Rows))
}

// Seats is how many players this round has.
func (r *Round) Seats() int {
	if r.Mode == ModeSolo {
		return 1
	}
	return 2
}

// Guess validates and applies a guess from seat, advancing the round.
//
// isWord is injected rather than imported so this package stays free of the
// word list and remains trivially testable.
func (r *Round) Guess(seat int, guess string, isWord func(string) bool) error {
	if r.State != StatePlaying {
		return ErrRoundOver
	}
	if seat != r.TurnSeat() {
		return ErrWrongSeat
	}

	guess = strings.ToLower(strings.TrimSpace(guess))
	if len([]rune(guess)) != WordLength {
		return ErrWrongLength
	}
	if !isWord(guess) {
		return ErrNotAWord
	}

	marks := MarkGuess(guess, r.answer)
	row := len(r.Rows)
	r.Rows = append(r.Rows, Row{Seat: seat, Guess: guess, Marks: marks})
	r.UpdatedAt = time.Now().UTC()

	switch {
	case Solved(marks):
		r.State = StateWon
		r.SolvedRow = row
	case len(r.Rows) >= MaxRows:
		r.State = StateLost
	}

	return nil
}

// UseHint records that seat revealed another hint tier and returns which tier
// it is (0-indexed). Each seat gets at most maxTiers across the round.
func (r *Round) UseHint(seat, maxTiers int) (int, error) {
	if r.State != StatePlaying {
		return 0, ErrRoundOver
	}
	if seat < 0 || seat >= len(r.HintsUsed) {
		return 0, ErrWrongSeat
	}
	if r.HintsUsed[seat] >= maxTiers {
		return 0, ErrNoHintsLeft
	}

	tier := r.HintsUsed[seat]
	r.HintsUsed[seat]++
	r.UpdatedAt = time.Now().UTC()
	return tier, nil
}

// Scores is what each seat has earned. Only the seat that actually landed the
// winning guess scores for solving; both pay for their own hints.
func (r *Round) Scores() []int {
	scores := make([]int, r.Seats())

	solverSeat := -1
	if r.State == StateWon && r.SolvedRow >= 0 && r.SolvedRow < len(r.Rows) {
		solverSeat = r.Rows[r.SolvedRow].Seat
	}

	for seat := range scores {
		solvedRow := -1
		if seat == solverSeat {
			solvedRow = r.SolvedRow
		}
		scores[seat] = Score(solvedRow, r.HintsUsed[seat])
	}

	return scores
}

// Reveal returns the answer once the round is over, and "" while it is still in
// play. This is the only path by which the answer should reach a client.
func (r *Round) Reveal() string {
	if r.State == StatePlaying {
		return ""
	}
	return r.answer
}
