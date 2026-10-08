package http

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jerkeyray/wordle/server/internal/duos"
	"github.com/jerkeyray/wordle/server/internal/players"
)

func (s *Server) handlePlayInvite(w http.ResponseWriter, r *http.Request) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
		return
	}
	var m duos.PlayInviteMutation
	if err := decodeJSON(w, r, &m); err != nil {
		writeError(w, 400, "invalid_body", err.Error())
		return
	}
	action := chi.URLParam(r, "action")
	if action == "" {
		action = "create"
	}
	out, err := s.duos.PlayInvite(r.Context(), p.ID, chi.URLParam(r, "id"), action, m)
	if err != nil {
		s.duoError(w, err)
		return
	}
	writeJSON(w, 200, out)
}
func (s *Server) handleFriendProfile(w http.ResponseWriter, r *http.Request) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if !validUUID(id) {
		writeError(w, 404, "not_found", "Friend not found")
		return
	}
	profile, err := s.players.FriendProfile(r.Context(), p.ID, id, localDate(r))
	if errors.Is(err, players.ErrNotFound) {
		writeError(w, 404, "not_found", "Friend not found")
		return
	}
	if err != nil {
		writeError(w, 500, "internal", "Could not read your friend")
		return
	}
	out := struct {
		*players.FriendProfile
		Online   bool           `json:"online"`
		Together duos.PairStats `json:"together"`
		Duo      *duos.Duo      `json:"duo,omitempty"`
	}{FriendProfile: profile}
	if s.duos != nil {
		online, e := s.duos.OnlinePlayers(r.Context(), []string{profile.PlayerID})
		if e != nil {
			s.duoError(w, e)
			return
		}
		out.Online = online[profile.PlayerID]
		stats, e := s.duos.PairStats(r.Context(), []string{id})
		if e != nil {
			s.duoError(w, e)
			return
		}
		out.Together = stats[id]
		// Fetch only this friendship's latest partnership and its seven results.
		out.Duo, err = s.duos.ForFriendship(r.Context(), id, p.ID)
		if err != nil {
			s.duoError(w, err)
			return
		}
	}
	writeJSON(w, 200, out)
}

func validUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			return false
		}
	}
	return true
}
