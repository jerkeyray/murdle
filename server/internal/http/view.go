// Package http exposes the game over JSON. It owns the wire format and nothing
// else: the rules live in internal/game and persistence in internal/store.
package http

import (
	"github.com/jerkeyray/murdle/server/internal/game"
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
