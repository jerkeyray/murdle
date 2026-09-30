package game

import (
	"errors"
	"time"
)

// Errors a caller can act on.
var (
	ErrRunComplete   = errors.New("run is already complete")
	ErrRoundInPlay   = errors.New("the current round is not finished")
	ErrRunNotFound   = errors.New("run not found")
	ErrEmptyWordList = errors.New("a run needs at least one word")
)

// Run is a themed sequence of rounds played back to back.
//
// The words secretly share a theme, and the theme is withheld until the run
// ends — so the two of you are working out the connection as well as the word.
// That reveal is the whole point, which is why nothing about the pack reaches
// the client until Complete reports true.
type Run struct {
	ID string
	// PackID identifies the theme. Never serialize this before the run ends.
	PackID string
	Mode   Mode
	Words  []string

	// RoundIDs in play order. Its length is how many rounds have been started.
	RoundIDs []string
	// Totals is the running score per seat across finished rounds.
	Totals []int
	// Finished counts rounds that have ended, won or lost.
	Finished int

	CreatedAt time.Time
	UpdatedAt time.Time
}

// NewRun starts a run over the given words, in order.
func NewRun(id, packID string, mode Mode, words []string) (*Run, error) {
	if len(words) == 0 {
		return nil, ErrEmptyWordList
	}

	seats := 1
	if mode == ModeShared {
		seats = 2
	}

	now := time.Now().UTC()
	return &Run{
		ID:        id,
		PackID:    packID,
		Mode:      mode,
		Words:     words,
		RoundIDs:  make([]string, 0, len(words)),
		Totals:    make([]int, seats),
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

// Length is how many rounds the run contains.
func (r *Run) Length() int { return len(r.Words) }

// Started is how many rounds have been dealt out so far.
func (r *Run) Started() int { return len(r.RoundIDs) }

// Complete reports whether every round has been played to an end.
func (r *Run) Complete() bool { return r.Finished >= r.Length() }

// InPlay reports whether a round has been started but not finished.
func (r *Run) InPlay() bool { return r.Started() > r.Finished }

// FirstSeatFor returns which seat opens the round at the given index.
//
// The opener alternates every round, so over a run the disadvantage of going
// first — guessing with the least information — falls on each player equally.
func (r *Run) FirstSeatFor(index int) int {
	if r.Mode == ModeSolo {
		return 0
	}
	return index % 2
}

// StartRound claims the next word and records the round that will play it.
//
// It refuses while a round is still in play: without that, a client that
// double-taps burns a word from the run and leaves an orphaned round.
func (r *Run) StartRound(roundID string) (word string, firstSeat int, err error) {
	if r.Complete() {
		return "", 0, ErrRunComplete
	}
	if r.InPlay() {
		return "", 0, ErrRoundInPlay
	}

	index := r.Started()
	r.RoundIDs = append(r.RoundIDs, roundID)
	r.UpdatedAt = time.Now().UTC()

	return r.Words[index], r.FirstSeatFor(index), nil
}

// RecordResult folds a finished round's scores into the run totals.
func (r *Run) RecordResult(scores []int) {
	for seat, points := range scores {
		if seat < len(r.Totals) {
			r.Totals[seat] += points
		}
	}
	r.Finished++
	r.UpdatedAt = time.Now().UTC()
}

// Winner returns the seat leading a completed run, or -1 for a draw or a run
// still in progress.
func (r *Run) Winner() int {
	if !r.Complete() || len(r.Totals) < 2 {
		return -1
	}
	switch {
	case r.Totals[0] > r.Totals[1]:
		return 0
	case r.Totals[1] > r.Totals[0]:
		return 1
	default:
		return -1
	}
}
