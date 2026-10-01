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

// HintReveal is what spending a hint tells the player.
//
// Phase 3 adds the written tiers from the word pipeline — a semantic nudge,
// then a category. This structural reveal is the last rung of that ladder and
// the one computable without any generated content, so it ships first.
type HintReveal struct {
	Tier int
	// Position is the 0-indexed slot in the word being revealed.
	Position int
	Letter   string
}

// Round is a single word being played. The answer is unexported and never
// serialized — the client learns it only through Reveal, after the round ends.
type Round struct {
	ID string
	// RunID is the themed run this round belongs to, or "" for a one-off.
	RunID string
	Mode  Mode
	// Seat is whose board this is. In a duel each player gets their own round
	// on the same word, so a round always belongs to exactly one person.
	Seat int
	Rows []Row
	// HintsUsed counts the tiers this player has spent on their own board.
	HintsUsed int
	SolvedRow int
	State     State
	CreatedAt time.Time
	UpdatedAt time.Time

	answer string
	// hinted are positions already given away, so a second hint reveals
	// something new rather than repeating itself.
	hinted map[int]bool
}

// NewRound starts a round on the given answer, owned by seat.
func NewRound(id string, mode Mode, seat int, answer string) *Round {
	now := time.Now().UTC()
	return &Round{
		ID:        id,
		Mode:      mode,
		Seat:      seat,
		Rows:      make([]Row, 0, MaxRows),
		SolvedRow: -1,
		State:     StatePlaying,
		CreatedAt: now,
		UpdatedAt: now,
		answer:    strings.ToLower(answer),
		hinted:    make(map[int]bool),
	}
}

// Answer returns the hidden word. Callers are responsible for only exposing it
// once the round is over; Reveal does that check for them.
func (r *Round) Answer() string { return r.answer }

// TurnSeat is whose turn it is, or -1 once the round is over. A board has one
// owner, so this is their seat for as long as the round is live.
func (r *Round) TurnSeat() int {
	if r.State != StatePlaying {
		return -1
	}
	return r.Seat
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

// UseHint spends one of seat's hints and reveals a letter position.
//
// Each seat gets at most maxTiers across the round, and each costs them a
// point. A hint never repeats a position the player already knows, either from
// a correct guess or from an earlier hint.
func (r *Round) UseHint(seat, maxTiers int) (HintReveal, error) {
	if r.State != StatePlaying {
		return HintReveal{}, ErrRoundOver
	}
	if seat != r.Seat {
		return HintReveal{}, ErrWrongSeat
	}
	if r.HintsUsed >= maxTiers {
		return HintReveal{}, ErrNoHintsLeft
	}

	pos, letter, ok := r.unrevealedPosition()
	if !ok {
		// Every position is already known, so there is nothing left to sell
		// them. Charging a point for that would be robbery.
		return HintReveal{}, ErrNoHintsLeft
	}

	tier := r.HintsUsed
	r.HintsUsed++
	r.hinted[pos] = true
	r.UpdatedAt = time.Now().UTC()

	return HintReveal{Tier: tier, Position: pos, Letter: letter}, nil
}

// unrevealedPosition returns the leftmost position the player has not yet
// pinned down — not guessed correctly, and not already handed over by a hint.
func (r *Round) unrevealedPosition() (int, string, bool) {
	known := make(map[int]bool, len(r.hinted))
	for pos := range r.hinted {
		known[pos] = true
	}
	for _, row := range r.Rows {
		for i, mark := range row.Marks {
			if mark == MarkHit {
				known[i] = true
			}
		}
	}

	letters := []rune(r.answer)
	for i := range letters {
		if !known[i] {
			return i, string(letters[i]), true
		}
	}
	return 0, "", false
}

// Points is what this board earned: the early-solve curve, less any hints.
func (r *Round) Points() int {
	solvedRow := -1
	if r.State == StateWon {
		solvedRow = r.SolvedRow
	}
	return Score(solvedRow, r.HintsUsed)
}

// Reveal returns the answer once the round is over, and "" while it is still in
// play. This is the only path by which the answer should reach a client.
func (r *Round) Reveal() string {
	if r.State == StatePlaying {
		return ""
	}
	return r.answer
}
