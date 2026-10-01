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

// Run is a themed sequence of words played back to back.
//
// The words secretly share a theme, withheld until the run ends, so the player
// is working out the connection as well as the words.
type Run struct {
	ID string
	// PackID identifies the theme. Never serialize this before the run ends.
	PackID string
	Words  []string

	// RoundIDs in play order. Its length is how many words have been dealt.
	RoundIDs []string
	// Points earned across the run.
	Points   int
	Results  []Round
	NewCycle bool
	// Finished counts rounds played to an end.
	Finished int

	CreatedAt time.Time
	UpdatedAt time.Time
}

// NewRun starts a run over the given words, in order.
func NewRun(id, packID string, words []string) (*Run, error) {
	if len(words) == 0 {
		return nil, ErrEmptyWordList
	}

	now := time.Now().UTC()
	return &Run{
		ID:        id,
		PackID:    packID,
		Words:     words,
		RoundIDs:  make([]string, 0, len(words)),
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

// Length is how many words the run contains.
func (r *Run) Length() int { return len(r.Words) }

// Started is how many words have been dealt out so far.
func (r *Run) Started() int { return len(r.RoundIDs) }

// Complete reports whether every word has been played to an end.
func (r *Run) Complete() bool { return r.Finished >= r.Length() }

// InPlay reports whether a word has been started but not finished.
func (r *Run) InPlay() bool { return r.Started() > r.Finished }

// StartRound claims the next word and records the round that will play it.
//
// It refuses while a round is still in play: without that, a client that
// double-taps burns a word and leaves an orphaned round.
func (r *Run) StartRound(roundID string) (string, error) {
	if r.Complete() {
		return "", ErrRunComplete
	}
	if r.InPlay() {
		return "", ErrRoundInPlay
	}

	index := r.Started()
	r.RoundIDs = append(r.RoundIDs, roundID)
	r.UpdatedAt = time.Now().UTC()

	return r.Words[index], nil
}

// RecordResult folds a finished round's score into the run total.
func (r *Run) RecordResult(points int) {
	r.Points += points
	r.Finished++
	r.UpdatedAt = time.Now().UTC()
}

// RecordRound keeps completed boards with the run for safe restoration.
func (r *Run) RecordRound(round *Round) {
	for _, result := range r.Results {
		if result.ID == round.ID {
			return
		}
	}
	r.Results = append(r.Results, *round)
	r.RecordResult(round.Points())
}
