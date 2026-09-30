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

	"github.com/jerkeyray/murdle/server/internal/auth"
	"github.com/jerkeyray/murdle/server/internal/game"
	"github.com/jerkeyray/murdle/server/internal/players"
	"github.com/jerkeyray/murdle/server/internal/store"
	"github.com/jerkeyray/murdle/server/internal/words"
)

// hintTiers is how many hints each seat may reveal per round. It matches the
// three tiers the word pipeline writes: semantic, category, structural.
const hintTiers = 3

// Server wires the router to its dependencies.
type Server struct {
	pool     *words.Pool
	rounds   store.Store
	players  *players.Store
	verifier *auth.Verifier
	log      *slog.Logger
}

// Options are the server's dependencies.
//
// Players and Verifier are optional and travel together: without a database
// there are no accounts, and without accounts there is nothing to verify. The
// game itself works either way — playing has never required signing in.
type Options struct {
	Pool           *words.Pool
	Rounds         store.Store
	Log            *slog.Logger
	AllowedOrigins []string
	Players        *players.Store
	Verifier       *auth.Verifier
}

// NewServer builds the HTTP handler.
func NewServer(opts Options) http.Handler {
	s := &Server{
		pool:     opts.Pool,
		rounds:   opts.Rounds,
		players:  opts.Players,
		verifier: opts.Verifier,
		log:      opts.Log,
	}
	allowedOrigins := opts.AllowedOrigins

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(15 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", localDateHeader},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Attaching identity is opt-in per request: a token makes the round count
	// towards your history, and no token still plays a perfectly good game.
	if s.verifier != nil {
		r.Use(s.verifier.Optional)
	}

	r.Get("/api/health", s.handleHealth)

	if s.players != nil {
		r.Route("/api/me", func(r chi.Router) {
			r.Use(auth.Require)
			r.Get("/", s.handleMe)
			r.Get("/solves", s.handleMySolves)
			r.Get("/saved", s.handleSavedWords)
			r.Put("/saved/{word}", s.handleSaveWord)
			r.Delete("/saved/{word}", s.handleSaveWord)
			r.Get("/friends", s.handleFriends)
			r.Post("/friends", s.handleAddFriend)
			r.Post("/friends/{id}/respond", s.handleRespondFriend)
		})
	}

	r.Route("/api/runs", func(r chi.Router) {
		r.Post("/", s.handleCreateRun)
		r.Get("/{id}", s.handleGetRun)
		r.Post("/{id}/rounds", s.handleStartRunRound)
	})
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

	mode, ok := parseMode(req.Mode)
	if !ok {
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

	writeJSON(w, http.StatusCreated, s.roundView(round))
}

// roundView builds the wire view and attaches the entry once the round is
// over. Routing every response through here means the entry can only ever
// appear alongside a revealed answer.
func (s *Server) roundView(round *game.Round) roundView {
	v := newRoundView(round)
	if answer := round.Reveal(); answer != "" {
		if info, ok := s.pool.WordInfo(answer); ok {
			entry := newEntryView(info)
			v.Entry = &entry
		}
	}
	return v
}

type createRunRequest struct {
	Mode string `json:"mode"`
	// ExcludePacks are themes this pair has already played, so a new run picks
	// a fresh one. The client holds this list until Phase 4 gives us history.
	ExcludePacks []string `json:"excludePacks"`
}

func (s *Server) handleCreateRun(w http.ResponseWriter, r *http.Request) {
	var req createRunRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	mode, ok := parseMode(req.Mode)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_mode", "mode must be solo or shared")
		return
	}

	exclude := make(map[string]struct{}, len(req.ExcludePacks))
	for _, id := range req.ExcludePacks {
		exclude[id] = struct{}{}
	}

	pack, ok := s.pool.RandomPack(exclude)
	if !ok {
		writeError(w, http.StatusInternalServerError, "no_packs", "no themed packs are loaded")
		return
	}

	run, err := game.NewRun(store.NewID(), pack.ID, mode, pack.WordList())
	if err != nil {
		s.log.Error("creating run", "err", err)
		writeError(w, http.StatusInternalServerError, "create_failed", "could not start the run")
		return
	}
	if err := s.rounds.CreateRun(r.Context(), run); err != nil {
		s.log.Error("storing run", "err", err)
		writeError(w, http.StatusInternalServerError, "create_failed", "could not start the run")
		return
	}

	writeJSON(w, http.StatusCreated, newRunView(run, s.pool))
}

func (s *Server) handleGetRun(w http.ResponseWriter, r *http.Request) {
	run, err := s.rounds.GetRun(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.writeGameError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, newRunView(run, s.pool))
}

type runRoundResponse struct {
	Round roundView `json:"round"`
	Run   runView   `json:"run"`
}

func (s *Server) handleStartRunRound(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "id")
	roundID := store.NewID()

	var answer string
	var firstSeat int
	run, err := s.rounds.UpdateRun(r.Context(), runID, func(run *game.Run) error {
		var err error
		answer, firstSeat, err = run.StartRound(roundID)
		return err
	})
	if err != nil {
		s.writeGameError(w, err)
		return
	}

	round := game.NewRound(roundID, run.Mode, firstSeat, answer)
	round.RunID = runID
	if err := s.rounds.Create(r.Context(), round); err != nil {
		s.log.Error("creating round", "err", err)
		writeError(w, http.StatusInternalServerError, "create_failed", "could not start the round")
		return
	}

	writeJSON(w, http.StatusCreated, runRoundResponse{
		Round: s.roundView(round),
		Run:   newRunView(run, s.pool),
	})
}

func (s *Server) handleGetRound(w http.ResponseWriter, r *http.Request) {
	round, err := s.rounds.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.writeGameError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.roundView(round))
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

	var justFinished bool
	round, err := s.rounds.Update(r.Context(), chi.URLParam(r, "id"), func(round *game.Round) error {
		before := round.State
		if err := round.Guess(req.Seat, req.Guess, s.pool.IsWord); err != nil {
			return err
		}
		justFinished = before == game.StatePlaying && round.State != game.StatePlaying
		return nil
	})
	if err != nil {
		s.writeGameError(w, err)
		return
	}

	view := s.roundView(round)

	if justFinished {
		s.recordSolve(r, round)
	}

	// A round that just ended inside a run folds its scores into the run
	// totals. Doing it here rather than in Round.Guess keeps the rules package
	// free of any notion of storage.
	if justFinished && round.RunID != "" {
		run, err := s.rounds.UpdateRun(r.Context(), round.RunID, func(run *game.Run) error {
			run.RecordResult(round.Scores())
			return nil
		})
		if err != nil {
			// The round itself is sound; losing the run total is worth a log
			// rather than failing the guess the player just made.
			s.log.Error("recording run result", "run", round.RunID, "err", err)
		} else {
			runView := newRunView(run, s.pool)
			writeJSON(w, http.StatusOK, runRoundResponse{Round: view, Run: runView})
			return
		}
	}

	writeJSON(w, http.StatusOK, view)
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
		Round:    s.roundView(round),
	})
}

// recordSolve files a finished round in the player's history.
//
// Best effort on purpose: the round is already over and correct, and failing
// the response because the history write failed would punish the player for an
// infrastructure problem they cannot see or fix.
func (s *Server) recordSolve(r *http.Request, round *game.Round) {
	if s.players == nil {
		return
	}
	p, ok := s.player(r)
	if !ok {
		return
	}

	answer := round.Reveal()
	packID, _ := s.pool.PackIDFor(answer)

	var solvedRow *int
	if round.State == game.StateWon {
		row := round.SolvedRow
		solvedRow = &row
	}

	scores := round.Scores()
	points := 0
	if len(scores) > 0 {
		points = scores[0]
	}

	err := s.players.RecordSolve(r.Context(), p.ID, players.Solve{
		Word:      answer,
		PackID:    packID,
		Solved:    round.State == game.StateWon,
		SolvedRow: solvedRow,
		Guesses:   len(round.Rows),
		HintsUsed: round.HintsUsed[0],
		Points:    points,
		PlayedOn:  localDate(r),
	})
	if err != nil {
		s.log.Error("recording solve", "player", p.ID, "word", answer, "err", err)
	}
}

// writeGameError maps a rules error to a status the client can branch on.
// Anything unrecognised is a bug on our side, not the caller's.
func (s *Server) writeGameError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, game.ErrRoundNotFound):
		writeError(w, http.StatusNotFound, "round_not_found", "no such round")
	case errors.Is(err, game.ErrRunNotFound):
		writeError(w, http.StatusNotFound, "run_not_found", "no such run")
	case errors.Is(err, game.ErrRunComplete):
		writeError(w, http.StatusConflict, "run_complete", "this run is finished")
	case errors.Is(err, game.ErrRoundInPlay):
		writeError(w, http.StatusConflict, "round_in_play", "finish the current word first")
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
// parseMode defaults an empty mode to solo and rejects anything unrecognised.
func parseMode(raw string) (game.Mode, bool) {
	switch mode := game.Mode(raw); mode {
	case "":
		return game.ModeSolo, true
	case game.ModeSolo, game.ModeShared:
		return mode, true
	default:
		return "", false
	}
}

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
