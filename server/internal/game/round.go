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
	ErrNoHintsLeft   = errors.New("no hints left")
	ErrHintLocked    = errors.New("hint is not unlocked")
	ErrInvalidHint   = errors.New("invalid hint tier")
	ErrRoundNotFound = errors.New("round not found")
)

// Row is one submitted guess and how it scored.
type Row struct {
	Guess string `json:"guess"`
	Marks []Mark `json:"marks"`
}

// HintReveal contains only a clue explicitly requested by the player.
type HintReveal struct {
	Tier int    `json:"tier"`
	Text string `json:"text"`
}

// Round is a single word being played. The answer is unexported and never
// serialized — the client learns it only through Reveal, after the round ends.
type Round struct {
	ID string
	// RunID is the themed run this round belongs to, or "" for a one-off.
	RunID      string
	Mode       string
	WordLength int
	Rows       []Row
	// HintsUsed counts the tiers this player has spent on their own board.
	HintsUsed int
	SolvedRow int
	State     State
	CreatedAt time.Time
	UpdatedAt time.Time

	answer string
	// Hints contains only the clues already requested.
	Hints []HintReveal
	// RequestIDs makes a lost response safe to retry without consuming another
	// row. It is persisted with the round because mobile networks routinely
	// drop a response after the server has already accepted the guess.
	RequestIDs map[string]bool
}

// NewRound starts a round on the given answer.
func NewRound(id, answer string) *Round {
	now := time.Now().UTC()
	return &Round{
		ID:         id,
		WordLength: len([]rune(answer)),
		Rows:       make([]Row, 0, MaxRows),
		SolvedRow:  -1,
		State:      StatePlaying,
		CreatedAt:  now,
		UpdatedAt:  now,
		answer:     strings.ToLower(answer),
		Hints:      make([]HintReveal, 0, 2),
		RequestIDs: make(map[string]bool),
	}
}

// Answer returns the hidden word. Callers are responsible for only exposing it
// once the round is over; Reveal does that check for them.
func (r *Round) Answer() string { return r.answer }

// Guess validates and applies a guess, advancing the round.
//
// isWord is injected rather than imported so this package stays free of the
// word list and remains trivially testable.
func (r *Round) Guess(guess string, isWord func(string) bool) error {
	if r.State != StatePlaying {
		return ErrRoundOver
	}

	guess = strings.ToLower(strings.TrimSpace(guess))
	if len([]rune(guess)) != r.WordLength {
		return ErrWrongLength
	}
	if !isWord(guess) {
		return ErrNotAWord
	}

	marks := MarkGuess(guess, r.answer)
	row := len(r.Rows)
	r.Rows = append(r.Rows, Row{Guess: guess, Marks: marks})
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

// HintUnlocksAfter is how many accepted guesses a tier waits for.
//
// A clue holds back until three attempts: by then the board has told you
// something on its own, so it reads as a nudge rather than a way to skip the
// puzzle.
func HintUnlocksAfter(tier int) int { return 2*tier + 1 }

// UseHint reveals an authored clue. Tiers are one-based and retry-safe.
func (r *Round) UseHint(tier int, clues []string) (HintReveal, error) {
	if r.State != StatePlaying {
		return HintReveal{}, ErrRoundOver
	}
	if tier != 1 || len(clues) < 1 {
		return HintReveal{}, ErrInvalidHint
	}
	for _, hint := range r.Hints {
		if hint.Tier == tier {
			return hint, nil
		}
	}
	if len(r.Rows) < HintUnlocksAfter(tier) || tier != r.HintsUsed+1 {
		return HintReveal{}, ErrHintLocked
	}
	hint := HintReveal{Tier: tier, Text: clues[tier-1]}
	r.Hints = append(r.Hints, hint)
	r.HintsUsed = len(r.Hints)
	r.UpdatedAt = time.Now().UTC()
	return hint, nil
}

// Points rewards the solve row. Assistance is recorded separately.
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
