// Package http exposes the game over JSON. It owns the wire format and nothing
// else: the rules live in internal/game and persistence in internal/store.
package http

import (
	"github.com/jerkeyray/murdle/server/internal/game"
	"github.com/jerkeyray/murdle/server/internal/words"
)

// rowView is one played row as the client sees it.
type rowView struct {
	Guess string   `json:"guess"`
	Marks []string `json:"marks"`
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

// roundView is the whole client-visible state of a round.
//
// There is deliberately no field for the answer while a round is in play.
// Answer is populated from Round.Reveal, which returns "" until the round is
// over, so the hidden word cannot leak by someone forgetting a check here.
type roundView struct {
	ID         string    `json:"id"`
	State      string    `json:"state"`
	WordLength int       `json:"wordLength"`
	MaxRows    int       `json:"maxRows"`
	Rows       []rowView `json:"rows"`
	HintsUsed  int       `json:"hintsUsed"`
	SolvedRow  int       `json:"solvedRow"`
	Points     int       `json:"points"`
	Answer     string    `json:"answer,omitempty"`
	// Entry rides along with Answer, for the same reason.
	Entry *entryView `json:"entry,omitempty"`
}

// newRoundView renders a round. The answer appears only once it is over.
func newRoundView(r *game.Round) roundView {
	rows := make([]rowView, len(r.Rows))
	for i, row := range r.Rows {
		marks := make([]string, len(row.Marks))
		for j, m := range row.Marks {
			marks[j] = m.String()
		}
		rows[i] = rowView{Guess: row.Guess, Marks: marks}
	}

	return roundView{
		ID:         r.ID,
		State:      string(r.State),
		WordLength: game.WordLength,
		MaxRows:    game.MaxRows,
		Rows:       rows,
		HintsUsed:  r.HintsUsed,
		SolvedRow:  r.SolvedRow,
		Points:     r.Points(),
		Answer:     r.Reveal(),
	}
}

// runView is the client-visible state of a run.
//
// There is deliberately no field for the pack id or title while the run is in
// progress. Pack is populated from a single guarded branch below, so the theme
// cannot leak by someone forgetting a check at a call site.
type runView struct {
	ID       string    `json:"id"`
	Length   int       `json:"length"`
	Started  int       `json:"started"`
	Finished int       `json:"finished"`
	Complete bool      `json:"complete"`
	Points   int       `json:"points"`
	Pack     *packView `json:"pack,omitempty"`
}

func newRunView(r *game.Run, pool *words.Pool) runView {
	v := runView{
		ID:       r.ID,
		Length:   r.Length(),
		Started:  r.Started(),
		Finished: r.Finished,
		Complete: r.Complete(),
		Points:   r.Points,
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
