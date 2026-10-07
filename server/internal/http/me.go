package http

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/jerkeyray/wordle/server/internal/auth"
	"github.com/jerkeyray/wordle/server/internal/players"
)

// profileView is everything the profile screen needs in one request. It is a
// small amount of data and always wanted together, so it travels together.
type profileView struct {
	DisplayName string `json:"displayName"`
	// NeedsName is true until the player has chosen a nickname. Google hands
	// us a legal name, which is not what anyone wants on a game they play with
	// their girlfriend, so we ask instead of assuming.
	NeedsName  bool   `json:"needsName"`
	InviteCode string `json:"inviteCode"`
	Streak     struct {
		Current     int  `json:"current"`
		Longest     int  `json:"longest"`
		PlayedToday bool `json:"playedToday"`
	} `json:"streak"`
	WordsLearned int `json:"wordsLearned"`
}

// homeView is deliberately smaller than a profile. The front page only needs
// to know whether a signed-in player could lose a streak; loading hundreds of
// solved words just to paint a badge makes the first screen wait on work it
// does not show.
type homeView struct {
	Streak struct {
		Current     int  `json:"current"`
		PlayedToday bool `json:"playedToday"`
	} `json:"streak"`
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

type collectionPageView struct {
	Items      []solveView `json:"items"`
	Total      int         `json:"total"`
	NextCursor string      `json:"nextCursor"`
}

func nextCursor(offset, limit, total int) string {
	if offset+limit >= total {
		return ""
	}
	return strconv.Itoa(offset + limit)
}

func invalidCollectionQuery(err error) bool {
	return err != nil && (err.Error() == "invalid limit" || err.Error() == "invalid cursor" || err.Error() == "invalid length")
}

func (s *Server) collectionPage(r *http.Request, playerID string, saved bool) ([]players.Solve, int, int, int, error) {
	limit := 24
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return nil, 0, 0, 0, errors.New("invalid limit")
		}
		if n > 100 {
			n = 100
		}
		limit = n
	}
	offset := 0
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			return nil, 0, 0, 0, errors.New("invalid cursor")
		}
		offset = n
	}
	length := 0
	if raw := r.URL.Query().Get("length"); raw != "" && raw != "all" {
		n, err := strconv.Atoi(raw)
		if err != nil || (n != 5 && n != 6) {
			return nil, 0, 0, 0, errors.New("invalid length")
		}
		length = n
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	var matches []string
	if query != "" {
		matches = s.pool.WordsMatching(query, length)
		if matches == nil {
			matches = []string{}
		}
	}
	if saved {
		words, total, err := s.players.SavedWordPage(r.Context(), playerID, limit, offset, length, matches)
		if err != nil {
			return nil, 0, 0, 0, err
		}
		out := make([]players.Solve, 0, len(words))
		for _, word := range words {
			out = append(out, players.Solve{Word: word})
		}
		return out, total, offset, limit, nil
	}
	items, total, err := s.players.SolvePage(r.Context(), playerID, limit, offset, length, matches)
	return items, total, offset, limit, err
}

type friendView struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Status      string `json:"status"`
	Incoming    bool   `json:"incoming"`
	Online      bool   `json:"online"`
	DayStreak   int    `json:"dayStreak"`
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

// requirePlayer writes the appropriate response so database failures cannot
// masquerade as sign-out or cause clients to discard uncertain mutations.
func (s *Server) requirePlayer(w http.ResponseWriter, r *http.Request) (players.Player, bool) {
	user, ok := auth.UserID(r.Context())
	if !ok || s.players == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Sign in to do that")
		return players.Player{}, false
	}
	p, err := s.players.Ensure(r.Context(), user)
	if errors.Is(err, players.ErrNotFound) {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Sign in to do that")
		return players.Player{}, false
	}
	if err != nil {
		s.log.Error("resolving player", "err", err)
		writeError(w, http.StatusServiceUnavailable, "service_unavailable", "Could not load your account. Please try again.")
		return players.Player{}, false
	}
	return p, true
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
		return
	}

	streak, err := s.players.Streak(r.Context(), p.ID, localDate(r))
	if err != nil {
		s.log.Error("reading streak", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not read your streak")
		return
	}

	wordsLearned, err := s.players.SolveCount(r.Context(), p.ID)
	if err != nil {
		s.log.Error("reading solves", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not read your history")
		return
	}

	var v profileView
	v.DisplayName = p.DisplayName
	v.NeedsName = p.DisplayName == ""
	v.InviteCode = p.InviteCode
	v.Streak.Current = streak.Current
	v.Streak.Longest = streak.Longest
	v.Streak.PlayedToday = streak.PlayedToday
	v.WordsLearned = wordsLearned

	writeJSON(w, http.StatusOK, v)
}

func (s *Server) handleHome(w http.ResponseWriter, r *http.Request) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
		return
	}

	streak, err := s.players.Streak(r.Context(), p.ID, localDate(r))
	if err != nil {
		s.log.Error("reading home streak", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not read your home")
		return
	}

	var v homeView
	v.Streak.Current = streak.Current
	v.Streak.PlayedToday = streak.PlayedToday
	writeJSON(w, http.StatusOK, v)
}

type setNameRequest struct {
	Name string `json:"name"`
}

func (s *Server) handleSetName(w http.ResponseWriter, r *http.Request) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
		return
	}

	var req setNameRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	name, err := s.players.SetDisplayName(r.Context(), p.ID, req.Name)
	if errors.Is(err, players.ErrBadName) {
		writeError(w, http.StatusUnprocessableEntity, "bad_name",
			"one to sixteen characters")
		return
	}
	if err != nil {
		s.log.Error("renaming player", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not save that")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"displayName": name})
}

func (s *Server) handleMySolves(w http.ResponseWriter, r *http.Request) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
		return
	}

	solves, total, offset, limit, err := s.collectionPage(r, p.ID, false)
	if err != nil {
		if invalidCollectionQuery(err) {
			writeError(w, http.StatusBadRequest, "invalid_query", err.Error())
			return
		}
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

	writeJSON(w, http.StatusOK, collectionPageView{Items: out, Total: total, NextCursor: nextCursor(offset, limit, total)})
}

func (s *Server) handleSavedWords(w http.ResponseWriter, r *http.Request) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
		return
	}

	saved, total, offset, limit, err := s.collectionPage(r, p.ID, true)
	if err != nil {
		if invalidCollectionQuery(err) {
			writeError(w, http.StatusBadRequest, "invalid_query", err.Error())
			return
		}
		s.log.Error("reading saved words", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not read your saved words")
		return
	}

	out := make([]solveView, 0, len(saved))
	for _, word := range saved {
		view := solveView{Word: word.Word}
		if id, found := s.pool.PackIDFor(word.Word); found {
			view.PackID = id
		}
		if info, found := s.pool.WordInfo(word.Word); found {
			entry := newEntryView(info)
			view.Entry = &entry
		}
		out = append(out, view)
	}

	writeJSON(w, http.StatusOK, collectionPageView{Items: out, Total: total, NextCursor: nextCursor(offset, limit, total)})
}

func (s *Server) handleSaveWord(w http.ResponseWriter, r *http.Request) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
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

func (s *Server) handleSavedWordStatus(w http.ResponseWriter, r *http.Request) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
		return
	}
	saved, err := s.players.IsWordSaved(r.Context(), p.ID, strings.ToLower(chi.URLParam(r, "word")))
	if err != nil {
		s.log.Error("checking saved word", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not read saved status")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"saved": saved})
}

func (s *Server) handleFriends(w http.ResponseWriter, r *http.Request) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
		return
	}

	friends, err := s.players.Friends(r.Context(), p.ID)
	if err != nil {
		s.log.Error("listing friends", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not read your friends")
		return
	}

	ids := []string{}
	for _, f := range friends {
		if f.Status == "accepted" {
			ids = append(ids, f.PlayerID)
		}
	}
	onlinePlayers := map[string]bool{}
	if s.duos != nil {
		onlinePlayers, err = s.duos.OnlinePlayers(r.Context(), ids)
		if err != nil {
			writeError(w, 500, "internal", "Could not read your friends")
			return
		}
	}
	currentStreaks, err := s.players.CurrentStreaks(r.Context(), ids, localDate(r))
	if err != nil {
		writeError(w, 500, "internal", "Could not read your friends")
		return
	}
	out := make([]friendView, 0, len(friends))
	for _, f := range friends {
		var online bool
		var dayStreak int
		if f.Status == "accepted" {
			if s.duos != nil {
				online = onlinePlayers[f.PlayerID]
			}
			dayStreak = currentStreaks[f.PlayerID]
		}
		out = append(out, friendView{
			ID:          f.FriendshipID,
			DisplayName: f.DisplayName,
			Status:      f.Status,
			Incoming:    f.Incoming,
			Online:      online,
			DayStreak:   dayStreak,
		})
	}

	writeJSON(w, http.StatusOK, out)
}

type addFriendRequest struct {
	InviteCode string `json:"inviteCode"`
}

func (s *Server) handleAddFriend(w http.ResponseWriter, r *http.Request) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
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
	p, ok := s.requirePlayer(w, r)
	if !ok {
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
