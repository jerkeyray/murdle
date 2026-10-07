package http

import (
	"errors"
	"github.com/go-chi/chi/v5"
	"github.com/jerkeyray/wordle/server/internal/duos"
	"net/http"
)

func (s *Server) duoError(w http.ResponseWriter, err error) {
	var e *duos.Error
	if errors.As(err, &e) {
		status := http.StatusUnprocessableEntity
		switch e.Code {
		case "not_found":
			status = http.StatusNotFound
		case "stale", "not_your_turn", "round_over", "pass_used", "hint_locked", "invalid_action", "request_reused":
			status = http.StatusConflict
		}
		writeJSON(w, status, map[string]any{"code": e.Code, "message": e.Message, "current": e.Current})
		return
	}
	s.log.Error("shared game request failed", "err", err)
	writeError(w, http.StatusInternalServerError, "internal", "Could not update the daily game")
}
func (s *Server) handleDuos(w http.ResponseWriter, r *http.Request) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
		return
	}
	out, err := s.duos.List(r.Context(), p.ID)
	if err != nil {
		s.duoError(w, err)
		return
	}
	writeJSON(w, 200, out)
}
func (s *Server) handlePresence(w http.ResponseWriter, r *http.Request) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
		return
	}
	if err := s.duos.Heartbeat(r.Context(), p.ID); err != nil {
		s.duoError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (s *Server) handleDuo(w http.ResponseWriter, r *http.Request) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
		return
	}
	out, err := s.duos.Get(r.Context(), chi.URLParam(r, "id"), p.ID)
	if err != nil {
		s.duoError(w, err)
		return
	}
	writeJSON(w, 200, out)
}
func (s *Server) handleDuoDay(w http.ResponseWriter, r *http.Request) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
		return
	}
	out, err := s.duos.Board(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "date"), p.ID)
	if err != nil {
		s.duoError(w, err)
		return
	}
	writeJSON(w, 200, out)
}
func (s *Server) handleInviteDuo(w http.ResponseWriter, r *http.Request) { s.mutateDuo(w, r, "invite") }
func (s *Server) handleDuoAction(w http.ResponseWriter, r *http.Request) {
	action := chi.URLParam(r, "action")
	date := chi.URLParam(r, "date")
	if date != "" && action != "guesses" && action != "pass" && action != "hint" || date == "" && action != "accept" && action != "decline" && action != "cancel" && action != "end" && action != "next" {
		writeError(w, 404, "not_found", "Action not found")
		return
	}
	if action == "guesses" {
		action = "guess"
	}
	s.mutateDuo(w, r, action)
}
func (s *Server) mutateDuo(w http.ResponseWriter, r *http.Request, action string) {
	p, ok := s.requirePlayer(w, r)
	if !ok {
		return
	}
	var body struct {
		RequestID    string `json:"requestId"`
		Version      *int   `json:"version"`
		FriendshipID string `json:"friendshipId,omitempty"`
		Timezone     string `json:"timezone,omitempty"`
		Guess        string `json:"guess,omitempty"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, 400, "invalid_body", err.Error())
		return
	}
	if body.Version == nil {
		writeError(w, 400, "invalid_body", "An expected version is required")
		return
	}
	m := duos.Mutation{RequestID: body.RequestID, Version: *body.Version, FriendshipID: body.FriendshipID, Timezone: body.Timezone, Guess: body.Guess}
	out, err := s.duos.Mutate(r.Context(), p.ID, chi.URLParam(r, "id"), chi.URLParam(r, "date"), action, m)
	if err != nil {
		s.duoError(w, err)
		return
	}
	writeJSON(w, 200, out)
}
