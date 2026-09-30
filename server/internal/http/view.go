// Package http exposes the game over JSON. It owns the wire format and nothing
// else: the rules live in internal/game and persistence in internal/store.
package http

import (
	"github.com/jerkeyray/murdle/server/internal/game"
	"github.com/jerkeyray/murdle/server/internal/words"
)

// rowView is one played row as the client sees it.
type rowView struct {
	Seat  int      `json:"seat"`
	Guess string   `json:"guess"`
	Marks []string `json:"marks"`
}

// roundView is the whole client-visible state of a round.
//
// There is deliberately no field for the answer while a round is in play.
// Answer is populated only from Round.Reveal, which returns "" until the round
// is over, so the hidden word cannot leak by someone forgetting a check here.
type roundView struct {
	ID         string    `json:"id"`
	Mode       string    `json:"mode"`
	State      string    `json:"state"`
	WordLength int       `json:"wordLength"`
	MaxRows    int       `json:"maxRows"`
	Seats      int       `json:"seats"`
	FirstSeat  int       `json:"firstSeat"`
	TurnSeat   int       `json:"turnSeat"`
	Rows       []rowView `json:"rows"`
	HintsUsed  []int     `json:"hintsUsed"`
	SolvedRow  int       `json:"solvedRow"`
	Scores     []int     `json:"scores"`
	Answer     string    `json:"answer,omitempty"`
	// Entry is the definition and note for the answer, present only once the
	// round is over. It rides along with Answer for the same reason.
	Entry *entryView `json:"entry,omitempty"`
}

func newRoundView(r *game.Round) roundView {
	rows := make([]rowView, len(r.Rows))
	for i, row := range r.Rows {
		marks := make([]string, len(row.Marks))
		for j, m := range row.Marks {
			marks[j] = m.String()
		}
		rows[i] = rowView{Seat: row.Seat, Guess: row.Guess, Marks: marks}
	}

	seats := r.Seats()
	hints := make([]int, seats)
	copy(hints, r.HintsUsed[:seats])

	return roundView{
		ID:         r.ID,
		Mode:       string(r.Mode),
		State:      string(r.State),
		WordLength: game.WordLength,
		MaxRows:    game.MaxRows,
		Seats:      seats,
		FirstSeat:  r.FirstSeat,
		TurnSeat:   r.TurnSeat(),
		Rows:       rows,
		HintsUsed:  hints,
		SolvedRow:  r.SolvedRow,
		Scores:     r.Scores(),
		Answer:     r.Reveal(),
	}
}

// entryView is what the round taught you. Populated only once the round is
// over, from the pack the answer belongs to.
type entryView struct {
	Word       string `json:"word"`
	Register   string `json:"register"`
	Definition string `json:"definition"`
	Note       string `json:"note"`
}

// packView is the theme reveal. It exists only on a completed run — the whole
// point of a themed run is that you work the connection out first.
type packView struct {
	Title string `json:"title"`
	Blurb string `json:"blurb"`
}

// runView is the client-visible state of a run.
//
// There is deliberately no field for the pack id or title while the run is in
// progress. Pack is populated from a single guarded branch in newRunView, so
// the theme cannot leak by someone forgetting a check at a call site.
type runView struct {
	ID       string    `json:"id"`
	Mode     string    `json:"mode"`
	Length   int       `json:"length"`
	Started  int       `json:"started"`
	Finished int       `json:"finished"`
	Complete bool      `json:"complete"`
	Totals   []int     `json:"totals"`
	Winner   int       `json:"winner"`
	Pack     *packView `json:"pack,omitempty"`
}

func newRunView(r *game.Run, pool *words.Pool) runView {
	v := runView{
		ID:       r.ID,
		Mode:     string(r.Mode),
		Length:   r.Length(),
		Started:  r.Started(),
		Finished: r.Finished,
		Complete: r.Complete(),
		Totals:   r.Totals,
		Winner:   r.Winner(),
	}

	if r.Complete() {
		if pack, ok := pool.Pack(r.PackID); ok {
			v.Pack = &packView{Title: pack.Title, Blurb: pack.Blurb}
		}
	}

	return v
}

func newEntryView(w words.PackWord) entryView {
	return entryView{
		Word:       w.Word,
		Register:   string(w.Register),
		Definition: w.Definition,
		Note:       w.Note,
	}
}
