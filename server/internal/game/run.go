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
// The words secretly share a theme, withheld until the run ends, so the
// players are working out the connection as well as the words.
//
// In a duel each word is played twice — once per seat, on separate boards —
// and the second player must not see the word before their turn. That is why
// WordRevealed exists and why the HTTP layer asks it before putting an answer
// in a response.
type Run struct {
	ID string
	// PackID identifies the theme. Never serialize this before the run ends.
	PackID string
	Mode   Mode
	Words  []string

	// RoundIDs in play order. Its length is how many boards have been dealt.
	RoundIDs []string
	// Totals is the running score per seat.
	Totals []int
	// Finished counts boards played to an end.
	Finished int

	CreatedAt time.Time
	UpdatedAt time.Time
}

// NewRun starts a run over the given words, in order.
func NewRun(id, packID string, mode Mode, words []string) (*Run, error) {
	if len(words) == 0 {
		return nil, ErrEmptyWordList
	}

	now := time.Now().UTC()
	return &Run{
		ID:        id,
		PackID:    packID,
		Mode:      mode,
		Words:     words,
		RoundIDs:  make([]string, 0, len(words)*SeatsFor(mode)),
		Totals:    make([]int, SeatsFor(mode)),
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

// Seats is how many players this run has.
func (r *Run) Seats() int { return SeatsFor(r.Mode) }

// Length is how many boards the run contains: one per word in solo, two in a
// duel.
func (r *Run) Length() int { return len(r.Words) * r.Seats() }

// Words played, as opposed to boards dealt.
func (r *Run) WordCount() int { return len(r.Words) }

// Started is how many boards have been dealt out so far.
func (r *Run) Started() int { return len(r.RoundIDs) }

// Complete reports whether every board has been played to an end.
func (r *Run) Complete() bool { return r.Finished >= r.Length() }

// InPlay reports whether a board has been started but not finished.
func (r *Run) InPlay() bool { return r.Started() > r.Finished }

// WordIndex is which word the board at the given deal position plays.
//
// In a duel the deals run A,B,A,B… over the same word list, so two consecutive
// boards share a word.
func (r *Run) WordIndex(dealt int) int { return dealt / r.Seats() }

// SeatFor is which player owns the board at the given deal position.
func (r *Run) SeatFor(dealt int) int { return dealt % r.Seats() }

// WordRevealed reports whether a word may now be shown.
//
// In a duel that means both players have finished their board: showing the
// answer to the first player while the second still has to guess it blind
// would end the contest before it started. This is the check the HTTP layer
// asks before putting an answer or an entry in any response.
func (r *Run) WordRevealed(wordIndex int) bool {
	return r.Finished >= (wordIndex+1)*r.Seats()
}

// StartRound claims the next board and records the round that will play it.
//
// It refuses while a board is still in play: without that, a client that
// double-taps burns a word and leaves an orphaned round.
func (r *Run) StartRound(roundID string) (word string, seat int, err error) {
	if r.Complete() {
		return "", 0, ErrRunComplete
	}
	if r.InPlay() {
		return "", 0, ErrRoundInPlay
	}

	dealt := r.Started()
	r.RoundIDs = append(r.RoundIDs, roundID)
	r.UpdatedAt = time.Now().UTC()

	return r.Words[r.WordIndex(dealt)], r.SeatFor(dealt), nil
}

// RecordResult folds a finished board's score into the run totals.
func (r *Run) RecordResult(seat, points int) {
	if seat >= 0 && seat < len(r.Totals) {
		r.Totals[seat] += points
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
