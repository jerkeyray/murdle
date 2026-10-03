// Package http exposes the game over JSON. It owns the wire format and nothing
// else: the rules live in internal/game and persistence in internal/store.
package http

import (
	"github.com/jerkeyray/wordle/server/internal/game"
	"github.com/jerkeyray/wordle/server/internal/words"
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
type connectionView struct {
	Word        string `json:"word"`
	Explanation string `json:"explanation"`
}

type packView struct {
	ID          string           `json:"id"`
	Connections []connectionView `json:"connections"`
	Title       string           `json:"title"`
	Blurb       string           `json:"blurb"`
}

// roundView is the whole client-visible state of a round.
//
// There is deliberately no field for the answer while a round is in play.
// Answer is populated from Round.Reveal, which returns "" until the round is
// over, so the hidden word cannot leak by someone forgetting a check here.
type roundView struct {
	ID         string            `json:"id"`
	State      string            `json:"state"`
	WordLength int               `json:"wordLength"`
	MaxRows    int               `json:"maxRows"`
	Rows       []rowView         `json:"rows"`
	HintsUsed  int               `json:"hintsUsed"`
	Hints      []game.HintReveal `json:"hints"`
	SolvedRow  int               `json:"solvedRow"`
	Points     int               `json:"points"`
	Answer     string            `json:"answer,omitempty"`
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
		WordLength: r.WordLength,
		MaxRows:    game.MaxRows,
		Rows:       rows,
		HintsUsed:  r.HintsUsed,
		Hints:      r.Hints,
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
	ID             string      `json:"id"`
	Mode           string      `json:"mode"`
	WordLength     int         `json:"wordLength"`
	CurrentRoundID string      `json:"currentRoundId,omitempty"`
	CompletedWords []roundView `json:"completedWords"`
	NewCycle       bool        `json:"newCycle"`
	Length         int         `json:"length"`
	Started        int         `json:"started"`
	Finished       int         `json:"finished"`
	Complete       bool        `json:"complete"`
	Points         int         `json:"points"`
	Pack           *packView   `json:"pack,omitempty"`
}

func newRunView(r *game.Run, pool *words.Pool) runView {
	v := runView{
		ID:             r.ID,
		Mode:           r.Mode,
		WordLength:     r.WordLength,
		Length:         r.Length(),
		Started:        r.Started(),
		Finished:       r.Finished,
		Complete:       r.Complete(),
		Points:         r.Points,
		NewCycle:       r.NewCycle,
		CompletedWords: make([]roundView, 0, len(r.Results)),
	}

	if len(r.RoundIDs) > 0 {
		v.CurrentRoundID = r.RoundIDs[len(r.RoundIDs)-1]
	}
	for i := range r.Results {
		result := newRoundView(&r.Results[i])
		if info, ok := pool.WordInfo(result.Answer); ok {
			entry := newEntryView(info)
			result.Entry = &entry
		}
		v.CompletedWords = append(v.CompletedWords, result)
	}
	if r.Mode == "themed" && r.Complete() {
		if pack, ok := pool.Pack(r.PackID); ok {
			v.Pack = &packView{ID: pack.ID, Title: pack.Title, Blurb: pack.Blurb}
			for _, word := range pack.Words {
				v.Pack.Connections = append(v.Pack.Connections, connectionView{word.Word, word.Connection})
			}
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
