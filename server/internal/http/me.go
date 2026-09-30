package http

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/jerkeyray/murdle/server/internal/auth"
	"github.com/jerkeyray/murdle/server/internal/players"
)

// profileView is everything the profile screen needs in one request. It is a
// small amount of data and always wanted together, so it travels together.
type profileView struct {
	DisplayName string `json:"displayName"`
	SeatColor   string `json:"seatColor"`
	InviteCode  string `json:"inviteCode"`
	Streak      struct {
		Current     int  `json:"current"`
		Longest     int  `json:"longest"`
		PlayedToday bool `json:"playedToday"`
	} `json:"streak"`
	WordsLearned int `json:"wordsLearned"`
}

type solveView struct {
	Word      string     `json:"word"`
	PackID    string     `json:"packId"`
	Solved    bool       `json:"solved"`
	SolvedRow *int       `json:"solvedRow"`
	Guesses   int        `json:"guesses"`
	Points    int        `json:"points"`
	PlayedOn  string     `json:"playedOn"`
	Entry     *entryView `json:"entry,omitempty"`
}

type friendView struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Status      string `json:"status"`
	Incoming    bool   `json:"incoming"`
}

// player resolves the caller to a profile, creating one on first sight.
func (s *Server) player(r *http.Request) (players.Player, bool) {
	userID, ok := auth.UserID(r.Context())
	if !ok || s.players == nil {
		return players.Player{}, false
	}

	p, err := s.players.Ensure(r.Context(), userID)
	if err != nil {
		s.log.Error("ensuring player", "user", userID, "err", err)
		return players.Player{}, false
	}
	return p, true
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	p, ok := s.player(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "sign in to do that")
		return
	}

	streak, err := s.players.Streak(r.Context(), p.ID, localDate(r))
	if err != nil {
		s.log.Error("reading streak", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not read your streak")
		return
	}

	solves, err := s.players.Solves(r.Context(), p.ID, 500)
	if err != nil {
		s.log.Error("reading solves", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not read your history")
		return
	}

	var v profileView
	v.DisplayName = p.DisplayName
	v.SeatColor = p.SeatColor
	v.InviteCode = p.InviteCode
	v.Streak.Current = streak.Current
	v.Streak.Longest = streak.Longest
	v.Streak.PlayedToday = streak.PlayedToday
	v.WordsLearned = len(solves)

	writeJSON(w, http.StatusOK, v)
}

func (s *Server) handleMySolves(w http.ResponseWriter, r *http.Request) {
	p, ok := s.player(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "sign in to do that")
		return
	}

	solves, err := s.players.Solves(r.Context(), p.ID, 500)
	if err != nil {
		s.log.Error("reading solves", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not read your history")
		return
	}

	out := make([]solveView, 0, len(solves))
	for _, sv := range solves {
		view := solveView{
			Word:      sv.Word,
			PackID:    sv.PackID,
			Solved:    sv.Solved,
			SolvedRow: sv.SolvedRow,
			Guesses:   sv.Guesses,
			Points:    sv.Points,
			PlayedOn:  sv.PlayedOn.Format("2006-01-02"),
		}
		// The collection is only worth keeping if it still teaches. Attach the
		// entry so a solved word can be read again months later.
		if info, found := s.pool.WordInfo(sv.Word); found {
			entry := newEntryView(info)
			view.Entry = &entry
		}
		out = append(out, view)
	}

	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleSavedWords(w http.ResponseWriter, r *http.Request) {
	p, ok := s.player(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "sign in to do that")
		return
	}

	saved, err := s.players.SavedWords(r.Context(), p.ID)
	if err != nil {
		s.log.Error("reading saved words", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not read your saved words")
		return
	}

	out := make([]solveView, 0, len(saved))
	for _, word := range saved {
		view := solveView{Word: word}
		if id, found := s.pool.PackIDFor(word); found {
			view.PackID = id
		}
		if info, found := s.pool.WordInfo(word); found {
			entry := newEntryView(info)
			view.Entry = &entry
		}
		out = append(out, view)
	}

	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleSaveWord(w http.ResponseWriter, r *http.Request) {
	p, ok := s.player(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "sign in to do that")
		return
	}

	word := strings.ToLower(chi.URLParam(r, "word"))
	// Only real words, so the table cannot be used as free storage.
	if !s.pool.IsWord(word) {
		writeError(w, http.StatusUnprocessableEntity, "not_a_word", "that is not a word")
		return
	}

	var err error
	if r.Method == http.MethodDelete {
		err = s.players.UnsaveWord(r.Context(), p.ID, word)
	} else {
		err = s.players.SaveWord(r.Context(), p.ID, word)
	}
	if err != nil {
		s.log.Error("updating saved word", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not save that")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleFriends(w http.ResponseWriter, r *http.Request) {
	p, ok := s.player(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "sign in to do that")
		return
	}

	friends, err := s.players.Friends(r.Context(), p.ID)
	if err != nil {
		s.log.Error("listing friends", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not read your friends")
		return
	}

	out := make([]friendView, 0, len(friends))
	for _, f := range friends {
		out = append(out, friendView{
			ID:          f.FriendshipID,
			DisplayName: f.DisplayName,
			Status:      f.Status,
			Incoming:    f.Incoming,
		})
	}

	writeJSON(w, http.StatusOK, out)
}

type addFriendRequest struct {
	InviteCode string `json:"inviteCode"`
}

func (s *Server) handleAddFriend(w http.ResponseWriter, r *http.Request) {
	p, ok := s.player(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "sign in to do that")
		return
	}

	var req addFriendRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	friend, err := s.players.RequestFriend(r.Context(), p.ID, req.InviteCode)
	switch {
	case errors.Is(err, players.ErrNotFound):
		writeError(w, http.StatusNotFound, "no_such_code", "no one has that code")
		return
	case errors.Is(err, players.ErrSelfFriend):
		writeError(w, http.StatusUnprocessableEntity, "self_friend", "that is your own code")
		return
	case err != nil:
		s.log.Error("adding friend", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not send that request")
		return
	}

	writeJSON(w, http.StatusOK, friendView{
		ID:          friend.FriendshipID,
		DisplayName: friend.DisplayName,
		Status:      friend.Status,
		Incoming:    friend.Incoming,
	})
}

type respondFriendRequest struct {
	Accept bool `json:"accept"`
}

func (s *Server) handleRespondFriend(w http.ResponseWriter, r *http.Request) {
	p, ok := s.player(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "sign in to do that")
		return
	}

	var req respondFriendRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	err := s.players.RespondFriend(r.Context(), p.ID, chi.URLParam(r, "id"), req.Accept)
	if errors.Is(err, players.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no_such_request", "no pending request with that id")
		return
	}
	if err != nil {
		s.log.Error("responding to friend request", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not answer that")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
