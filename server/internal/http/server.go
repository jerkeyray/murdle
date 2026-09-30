package http

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/jerkeyray/murdle/server/internal/game"
	"github.com/jerkeyray/murdle/server/internal/store"
	"github.com/jerkeyray/murdle/server/internal/words"
)

// hintTiers is how many hints each seat may reveal per round. It matches the
// three tiers the word pipeline writes: semantic, category, structural.
const hintTiers = 3

// Server wires the router to its dependencies.
type Server struct {
	pool   *words.Pool
	rounds store.Store
	log    *slog.Logger
}

// NewServer builds the HTTP handler. allowedOrigins is the exact list of web
// origins permitted to call the API.
func NewServer(pool *words.Pool, rounds store.Store, log *slog.Logger, allowedOrigins []string) http.Handler {
	s := &Server{pool: pool, rounds: rounds, log: log}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(15 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Get("/api/health", s.handleHealth)
	r.Route("/api/rounds", func(r chi.Router) {
		r.Post("/", s.handleCreateRound)
		r.Get("/{id}", s.handleGetRound)
		r.Post("/{id}/guesses", s.handleGuess)
		r.Post("/{id}/hints", s.handleHint)
	})

	return r
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	answers, dictionary := s.pool.Size()
	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "ok",
		"answers":    answers,
		"dictionary": dictionary,
	})
}

type createRoundRequest struct {
	Mode      string `json:"mode"`
	FirstSeat int    `json:"firstSeat"`
	// Exclude is words this pair has already played, so a round does not repeat
	// one. The client holds this list until Phase 4 gives us real history.
	Exclude []string `json:"exclude"`
}

func (s *Server) handleCreateRound(w http.ResponseWriter, r *http.Request) {
	var req createRoundRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	mode := game.Mode(req.Mode)
	if mode == "" {
		mode = game.ModeSolo
	}
	if mode != game.ModeSolo && mode != game.ModeShared {
		writeError(w, http.StatusBadRequest, "invalid_mode", "mode must be solo or shared")
		return
	}

	firstSeat := req.FirstSeat
	if mode == game.ModeSolo {
		firstSeat = 0
	}
	if firstSeat != 0 && firstSeat != 1 {
		writeError(w, http.StatusBadRequest, "invalid_seat", "firstSeat must be 0 or 1")
		return
	}

	exclude := make(map[string]struct{}, len(req.Exclude))
	for _, word := range req.Exclude {
		exclude[word] = struct{}{}
	}

	answer := s.pool.Random(exclude)
	if answer == "" {
		writeError(w, http.StatusInternalServerError, "no_words", "the word pool is empty")
		return
	}

	round := game.NewRound(store.NewID(), mode, firstSeat, answer)
	if err := s.rounds.Create(r.Context(), round); err != nil {
		s.log.Error("creating round", "err", err)
		writeError(w, http.StatusInternalServerError, "create_failed", "could not start the round")
		return
	}

	writeJSON(w, http.StatusCreated, newRoundView(round))
}

func (s *Server) handleGetRound(w http.ResponseWriter, r *http.Request) {
	round, err := s.rounds.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.writeGameError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, newRoundView(round))
}

type guessRequest struct {
	Seat  int    `json:"seat"`
	Guess string `json:"guess"`
}

func (s *Server) handleGuess(w http.ResponseWriter, r *http.Request) {
	var req guessRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	round, err := s.rounds.Update(r.Context(), chi.URLParam(r, "id"), func(round *game.Round) error {
		return round.Guess(req.Seat, req.Guess, s.pool.IsWord)
	})
	if err != nil {
		s.writeGameError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, newRoundView(round))
}

type hintRequest struct {
	Seat int `json:"seat"`
}

type hintResponse struct {
	// Tier is which rung of the ladder was spent. Phase 3 attaches the written
	// tiers from the word pipeline; this structural reveal is the rung that
	// needs no generated content.
	Tier int `json:"tier"`
	// Position is the 0-indexed slot in the word that Letter belongs to.
	Position int       `json:"position"`
	Letter   string    `json:"letter"`
	Round    roundView `json:"round"`
}

func (s *Server) handleHint(w http.ResponseWriter, r *http.Request) {
	var req hintRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	var reveal game.HintReveal
	round, err := s.rounds.Update(r.Context(), chi.URLParam(r, "id"), func(round *game.Round) error {
		var err error
		reveal, err = round.UseHint(req.Seat, hintTiers)
		return err
	})
	if err != nil {
		s.writeGameError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, hintResponse{
		Tier:     reveal.Tier,
		Position: reveal.Position,
		Letter:   reveal.Letter,
		Round:    newRoundView(round),
	})
}

// writeGameError maps a rules error to a status the client can branch on.
// Anything unrecognised is a bug on our side, not the caller's.
func (s *Server) writeGameError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, game.ErrRoundNotFound):
		writeError(w, http.StatusNotFound, "round_not_found", "no such round")
	case errors.Is(err, game.ErrRoundOver):
		writeError(w, http.StatusConflict, "round_over", "this round has already finished")
	case errors.Is(err, game.ErrWrongSeat):
		writeError(w, http.StatusConflict, "wrong_seat", "it is not your turn")
	case errors.Is(err, game.ErrWrongLength):
		writeError(w, http.StatusUnprocessableEntity, "wrong_length", "that is not five letters")
	case errors.Is(err, game.ErrNotAWord):
		writeError(w, http.StatusUnprocessableEntity, "not_a_word", "that is not a word")
	case errors.Is(err, game.ErrNoHintsLeft):
		writeError(w, http.StatusConflict, "no_hints_left", "you have used every hint")
	default:
		s.log.Error("unhandled request error", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "something went wrong")
	}
}

// decodeJSON reads a small JSON body into dst. An empty body is not an error:
// several of these endpoints have sensible defaults for every field, and a
// client posting nothing should get those rather than a 400.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	// Bodies here are a handful of fields; cap them so a bad client cannot make
	// us read an unbounded request.
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()

	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorBody{Code: code, Message: message})
}
