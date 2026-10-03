package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/jerkeyray/wordle/server/internal/auth"
	"github.com/jerkeyray/wordle/server/internal/duos"
	"github.com/jerkeyray/wordle/server/internal/game"
	"github.com/jerkeyray/wordle/server/internal/players"
	"github.com/jerkeyray/wordle/server/internal/store"
	"github.com/jerkeyray/wordle/server/internal/words"
)

// Server wires the router to its dependencies.
type Server struct {
	pool     *words.Pool
	rounds   store.Store
	players  *players.Store
	duos     *duos.Store
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
	Duos           *duos.Store
	Verifier       *auth.Verifier
}

// NewServer builds the HTTP handler.
func NewServer(opts Options) http.Handler {
	s := &Server{
		pool:     opts.Pool,
		rounds:   opts.Rounds,
		players:  opts.Players,
		duos:     opts.Duos,
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
	r.Get("/api/capabilities", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"sharedGames": s.duos != nil && s.players != nil && s.verifier != nil})
	})

	if s.players != nil {
		r.Route("/api/me", func(r chi.Router) {
			r.Use(auth.Require)
			r.Get("/", s.handleMe)
			r.Get("/home", s.handleHome)
			r.Post("/name", s.handleSetName)
			r.Get("/solves", s.handleMySolves)
			r.Get("/saved", s.handleSavedWords)
			r.Put("/saved/{word}", s.handleSaveWord)
			r.Delete("/saved/{word}", s.handleSaveWord)
			r.Get("/friends", s.handleFriends)
			r.Post("/friends", s.handleAddFriend)
			r.Post("/friends/{id}/respond", s.handleRespondFriend)
			if s.duos != nil {
				r.Get("/duos", s.handleDuos)
				r.Post("/duos", s.handleInviteDuo)
				r.Post("/presence", s.handlePresence)
			}
		})
	}
	if s.duos != nil && s.players != nil {
		r.Route("/api/duos/{id}", func(r chi.Router) {
			r.Use(auth.Require)
			r.Get("/", s.handleDuo)
			r.Post("/{action}", s.handleDuoAction)
			r.Get("/days/{date}", s.handleDuoDay)
			r.Post("/days/{date}/{action}", s.handleDuoAction)
		})
	}

	r.Route("/api/runs", func(r chi.Router) {
		r.Post("/", s.handleCreateRun)
		r.Get("/{id}", s.handleGetRun)
		r.Post("/{id}/rounds", s.handleStartRunRound)
	})
	r.Route("/api/rounds", func(r chi.Router) {
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

// roundView builds the wire view and attaches the entry once the round is
// over. Routing every response through here means the entry can only ever
// appear alongside a revealed answer.
func (s *Server) roundView(round *game.Round) roundView {
	v := newRoundView(round)
	if v.Answer != "" {
		if info, ok := s.pool.WordInfo(v.Answer); ok {
			entry := newEntryView(info)
			v.Entry = &entry
		}
	}
	return v
}

type createRunRequest struct {
	// ExcludePacks are themes already played, so a new run picks a fresh one.
	// Signed-out players have nowhere else to keep this, so the client sends
	// its local list; a signed-in player's real history is read from the
	// database and merged in, because local storage does not follow anyone to
	// a new phone.
	ExcludePacks []string `json:"excludePacks"`
	Mode         string   `json:"mode"`
	WordLength   int      `json:"wordLength"`
	Difficulty   string   `json:"difficulty"`
}

func (s *Server) handleCreateRun(w http.ResponseWriter, r *http.Request) {
	var req createRunRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	exclude := make(map[string]struct{}, len(req.ExcludePacks))
	for _, id := range req.ExcludePacks {
		exclude[id] = struct{}{}
	}
	s.excludePlayedPacks(r, exclude)

	mode := req.Mode
	if mode == "" {
		mode = "themed"
	}
	length := req.WordLength
	if length == 0 {
		length = game.WordLength
	}
	if (mode != "classic" && mode != "themed") || (length != 5 && length != 6) {
		writeError(w, http.StatusBadRequest, "invalid_mode", "choose classic or themed, with five or six letters")
		return
	}
	difficulty := req.Difficulty
	if difficulty == "" {
		difficulty = "mixed"
	}
	if difficulty != "mixed" && difficulty != "learning" {
		writeError(w, http.StatusBadRequest, "invalid_difficulty", "choose mixed or learning vocabulary")
		return
	}
	var wordsToPlay []string
	packID := ""
	newCycle := false
	if mode == "themed" {
		pack, ok := s.pool.RandomPackForLength(exclude, length)
		if !ok {
			writeError(w, http.StatusInternalServerError, "no_packs", "no themed packs are loaded for that length")
			return
		}
		packID, wordsToPlay, newCycle = pack.ID, pack.WordList(), s.pool.ExhaustedForLength(exclude, length)
	} else {
		word, ok := s.pool.RandomWordForDifficulty(length, difficulty)
		if !ok {
			writeError(w, http.StatusInternalServerError, "no_words", "no words are loaded for that length")
			return
		}
		wordsToPlay = []string{word.Word}
	}
	run, err := game.NewRunWithMode(store.NewID(), mode, packID, wordsToPlay)
	if err != nil {
		s.log.Error("creating run", "err", err)
		writeError(w, http.StatusInternalServerError, "create_failed", "could not start the run")
		return
	}
	run.NewCycle = newCycle
	if err := s.rounds.CreateRun(r.Context(), run); err != nil {
		s.log.Error("storing run", "err", err)
		writeError(w, http.StatusInternalServerError, "create_failed", "could not start the run")
		return
	}
	// The first board is always needed immediately. Dealing it in this request
	// removes a full client/server round trip from tapping Begin, while the
	// existing create-then-deal flow remains available to older clients.
	if r.URL.Query().Get("deal") == "1" {
		started, round, err := s.startRunRound(r.Context(), run.ID)
		if err != nil {
			s.log.Error("creating first round", "err", err)
			writeError(w, http.StatusInternalServerError, "create_failed", "could not start the round")
			return
		}
		writeJSON(w, http.StatusCreated, runRoundResponse{Round: s.roundView(round), Run: newRunView(started, s.pool)})
		return
	}

	writeJSON(w, http.StatusCreated, newRunView(run, s.pool))
}

// excludePlayedPacks adds the themes a signed-in player has finished.
//
// A pack counts as played only once every one of its words is recorded, which
// matches what the client does: abandoning a run halfway should let that theme
// come round again. Failures here are logged and ignored — not knowing your
// history is a reason to risk a repeat, never a reason to refuse a game.
func (s *Server) excludePlayedPacks(r *http.Request, exclude map[string]struct{}) {
	p, ok := s.player(r)
	if !ok {
		return
	}
	counts, err := s.players.PackWordCounts(r.Context(), p.ID)
	if err != nil {
		s.log.Error("reading played packs", "player", p.ID, "err", err)
		return
	}
	for id, played := range counts {
		if pack, ok := s.pool.Pack(id); ok && played >= len(pack.Words) {
			exclude[id] = struct{}{}
		}
	}
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
	run, round, err := s.startRunRound(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.writeGameError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, runRoundResponse{
		Round: s.roundView(round),
		Run:   newRunView(run, s.pool),
	})
}

func (s *Server) startRunRound(ctx context.Context, runID string) (*game.Run, *game.Round, error) {
	roundID := store.NewID()
	var answer string
	run, err := s.rounds.UpdateRun(ctx, runID, func(run *game.Run) error {
		var err error
		answer, err = run.StartRound(roundID)
		return err
	})
	if err != nil {
		return nil, nil, err
	}

	round := game.NewRound(roundID, answer)
	round.RunID = runID
	round.Mode = run.Mode
	if err := s.rounds.Create(ctx, round); err != nil {
		return nil, nil, err
	}
	return run, round, nil
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
		if err := round.Guess(req.Guess, s.pool.IsWord); err != nil {
			return err
		}
		justFinished = before == game.StatePlaying && round.State != game.StatePlaying
		return nil
	})
	if err != nil {
		s.writeGameError(w, err)
		return
	}

	s.touchRun(r, round)
	if justFinished {
		s.recordSolve(r, round)
	}

	// A round that just ended inside a run folds its scores into the run
	// totals. Doing it here rather than in Round.Guess keeps the rules package
	// free of any notion of storage.
	if justFinished && round.RunID != "" {
		run, err := s.rounds.UpdateRun(r.Context(), round.RunID, func(run *game.Run) error {
			run.RecordRound(round)
			return nil
		})
		if err != nil {
			// The round itself is sound; losing the run total is worth a log
			// rather than failing the guess the player just made.
			s.log.Error("recording run result", "run", round.RunID, "err", err)
		} else {
			// The completed snapshot includes the final connection only after all words finish.
			writeJSON(w, http.StatusOK, runRoundResponse{
				Round: s.roundView(round),
				Run:   newRunView(run, s.pool),
			})
			return
		}
	}

	writeJSON(w, http.StatusOK, s.roundView(round))
}

type hintResponse struct {
	Tier  int       `json:"tier"`
	Text  string    `json:"text"`
	Round roundView `json:"round"`
}

func (s *Server) handleHint(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Tier int `json:"tier"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	var reveal game.HintReveal
	round, err := s.rounds.Update(r.Context(), chi.URLParam(r, "id"), func(round *game.Round) error {
		info, ok := s.pool.WordInfo(round.Answer())
		if !ok {
			return game.ErrInvalidHint
		}
		var err error
		reveal, err = round.UseHint(req.Tier, info.Hints)
		return err
	})
	if err != nil {
		s.writeGameError(w, err)
		return
	}
	s.touchRun(r, round)
	writeJSON(w, http.StatusOK, hintResponse{Tier: reveal.Tier, Text: reveal.Text, Round: s.roundView(round)})
}

func (s *Server) touchRun(r *http.Request, round *game.Round) {
	if round.RunID != "" {
		_, err := s.rounds.UpdateRun(r.Context(), round.RunID, func(run *game.Run) error { run.UpdatedAt = time.Now().UTC(); return nil })
		if err != nil {
			s.log.Warn("refreshing run", "err", err)
		}
	}
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
	packID := ""
	if round.Mode == "" || round.Mode == "themed" {
		packID, _ = s.pool.PackIDFor(answer)
	}

	var solvedRow *int
	if round.State == game.StateWon {
		row := round.SolvedRow
		solvedRow = &row
	}

	err := s.players.RecordSolve(r.Context(), p.ID, players.Solve{
		Word:      answer,
		PackID:    packID,
		Solved:    round.State == game.StateWon,
		SolvedRow: solvedRow,
		Guesses:   len(round.Rows),
		HintsUsed: round.HintsUsed,
		Points:    round.Points(),
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
	case errors.Is(err, game.ErrWrongLength):
		writeError(w, http.StatusUnprocessableEntity, "wrong_length", "that is not the right number of letters")
	case errors.Is(err, game.ErrNotAWord):
		writeError(w, http.StatusUnprocessableEntity, "not_a_word", "that is not a word")
	case errors.Is(err, game.ErrHintLocked):
		writeError(w, http.StatusConflict, "hint_locked", fmt.Sprintf("context unlocks after %d guesses; association after %d and the first hint", game.HintUnlocksAfter(1), game.HintUnlocksAfter(2)))
	case errors.Is(err, game.ErrInvalidHint):
		writeError(w, http.StatusUnprocessableEntity, "invalid_hint", "choose hint 1 or 2")
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
