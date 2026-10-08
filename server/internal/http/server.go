package http

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

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
	db       *pgxpool.Pool
	limits   *rateLimits
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
	DB             *pgxpool.Pool
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
		db:       opts.DB,
		limits:   newRateLimits(),
	}
	allowedOrigins := opts.AllowedOrigins

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)
	r.Use(s.requestLog)
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
	r.Get("/api/ready", s.handleReady)
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
			r.Get("/saved/status/{word}", s.handleSavedWordStatus)
			r.Put("/saved/{word}", s.handleSaveWord)
			r.Delete("/saved/{word}", s.handleSaveWord)
			r.Get("/friends", s.handleFriends)
			r.Get("/friends/{id}", s.handleFriendProfile)
			r.With(s.limit("friend", configuredLimit("FRIEND_RATE_LIMIT", 10))).Post("/friends", s.handleAddFriend)
			r.With(s.limit("friend", configuredLimit("FRIEND_RATE_LIMIT", 10))).Post("/friends/{id}/respond", s.handleRespondFriend)
			if s.duos != nil {
				r.With(s.limit("friend", configuredLimit("FRIEND_RATE_LIMIT", 10))).Post("/play-invites", s.handlePlayInvite)
				r.With(s.limit("friend", configuredLimit("FRIEND_RATE_LIMIT", 10))).Post("/play-invites/{id}/{action}", s.handlePlayInvite)
				r.Get("/duos", s.handleDuos)
				r.With(s.limit("invite", configuredLimit("INVITE_RATE_LIMIT", 10))).Post("/duos", s.handleInviteDuo)
				r.Post("/presence", s.handlePresence)
			}
		})
	}
	if s.duos != nil && s.players != nil {
		r.Route("/api/duos/{id}", func(r chi.Router) {
			r.Use(auth.Require)
			r.Get("/", s.handleDuo)
			r.With(s.limitDuoInvitation()).Post("/{action}", s.handleDuoAction)
			r.Get("/days/{date}", s.handleDuoDay)
			r.Post("/days/{date}/{action}", s.handleDuoAction)
		})
	}

	r.Route("/api/runs", func(r chi.Router) {
		r.With(s.limit("game", configuredLimit("GAME_CREATE_RATE_LIMIT", 120))).Post("/", s.handleCreateRun)
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

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	if s.db != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.db.Ping(ctx); err != nil {
			writeError(w, http.StatusServiceUnavailable, "not_ready", "database unavailable")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
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
	// ExcludeWords does the same for Classic: answers already played, sent by
	// a signed-out client and merged with the database for a signed-in one.
	ExcludeWords []string `json:"excludeWords"`
	Mode         string   `json:"mode"`
	WordLength   int      `json:"wordLength"`
	Difficulty   string   `json:"difficulty"`
	RequestID    string   `json:"requestId"`
}

func (s *Server) handleCreateRun(w http.ResponseWriter, r *http.Request) {
	if userID, signedIn := auth.UserID(r.Context()); signedIn && s.players != nil {
		if _, err := s.players.Ensure(r.Context(), userID); err != nil {
			s.log.Error("resolving player before run creation", "err", err)
			writeError(w, http.StatusInternalServerError, "identity_unavailable", "could not start the run")
			return
		}
	}
	var req createRunRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.RequestID != "" && !validRequestID(req.RequestID) {
		writeError(w, http.StatusBadRequest, "invalid_request_id", "request IDs must be 1 to 128 characters")
		return
	}
	createFingerprintRequest := req
	createFingerprintRequest.RequestID = ""
	fingerprint := mutationFingerprint("create_run", createFingerprintRequest)

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
		seen := make(map[string]struct{}, len(req.ExcludeWords))
		for _, w := range req.ExcludeWords {
			seen[w] = struct{}{}
		}
		s.excludePlayedWords(r, seen)
		word, cycled, ok := s.pool.FreshWord(length, difficulty, seen)
		if !ok {
			writeError(w, http.StatusInternalServerError, "no_words", "no words are loaded for that length")
			return
		}
		wordsToPlay, newCycle = []string{word.Word}, cycled
	}
	run, err := game.NewRunWithMode(store.NewID(), mode, packID, wordsToPlay)
	if err != nil {
		s.log.Error("creating run", "err", err)
		writeError(w, http.StatusInternalServerError, "create_failed", "could not start the run")
		return
	}
	run.NewCycle = newCycle
	// The production store combines these writes in one database transaction.
	if r.URL.Query().Get("deal") == "1" {
		if req.RequestID != "" {
			if atomic, ok := s.rounds.(interface {
				CreateRunWithFirstRoundRequest(context.Context, *game.Run, string, string, string) (*game.Run, *game.Round, error)
			}); ok {
				started, round, err := atomic.CreateRunWithFirstRoundRequest(r.Context(), run, store.NewID(), req.RequestID, fingerprint)
				if err != nil {
					s.writeGameError(w, err)
					return
				}
				writeJSON(w, http.StatusCreated, runRoundResponse{Round: s.roundView(round), Run: newRunView(started, s.pool)})
				return
			}
		}
		if atomic, ok := s.rounds.(interface {
			CreateRunWithFirstRound(context.Context, *game.Run, string) (*game.Run, *game.Round, error)
		}); ok {
			started, round, err := atomic.CreateRunWithFirstRound(r.Context(), run, store.NewID())
			if err != nil {
				s.log.Error("creating run and first round", "err", err)
				writeError(w, http.StatusInternalServerError, "create_failed", "could not start the run")
				return
			}
			writeJSON(w, http.StatusCreated, runRoundResponse{Round: s.roundView(round), Run: newRunView(started, s.pool)})
			return
		}
	}
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

// excludePlayedWords adds every word a signed-in player has finished, so a
// Classic game never repeats one across devices. As with packs, a failed
// lookup risks a repeat rather than refusing a game.
func (s *Server) excludePlayedWords(r *http.Request, exclude map[string]struct{}) {
	p, ok := s.player(r)
	if !ok {
		return
	}
	played, err := s.players.PlayedWords(r.Context(), p.ID)
	if err != nil {
		s.log.Error("reading played words", "player", p.ID, "err", err)
		return
	}
	for _, w := range played {
		exclude[w] = struct{}{}
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
	var req struct {
		ExpectedRoundID string `json:"expectedRoundId"`
		RequestID       string `json:"requestId"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.RequestID != "" && !validRequestID(req.RequestID) {
		writeError(w, http.StatusBadRequest, "invalid_request_id", "request IDs must be 1 to 128 characters")
		return
	}
	var run *game.Run
	var round *game.Round
	var err error
	if req.RequestID != "" {
		runID := chi.URLParam(r, "id")
		fingerprint := mutationFingerprint("next_round", struct {
			RunID           string `json:"runId"`
			ExpectedRoundID string `json:"expectedRoundId"`
		}{runID, req.ExpectedRoundID})
		if atomic, ok := s.rounds.(interface {
			StartRunRoundRequest(context.Context, string, string, string, string, string) (*game.Run, *game.Round, error)
		}); ok {
			run, round, err = atomic.StartRunRoundRequest(r.Context(), runID, store.NewID(), req.ExpectedRoundID, req.RequestID, fingerprint)
		} else {
			run, round, err = s.startRunRound(r.Context(), chi.URLParam(r, "id"))
		}
	} else {
		run, round, err = s.startRunRound(r.Context(), chi.URLParam(r, "id"))
	}
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
	if atomic, ok := s.rounds.(interface {
		StartRunRound(context.Context, string, string) (*game.Run, *game.Round, error)
	}); ok {
		return atomic.StartRunRound(ctx, runID, roundID)
	}
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
	Guess     string `json:"guess"`
	RequestID string `json:"requestId"`
}

func validRequestID(id string) bool { return len(id) > 0 && len(id) <= 128 }

func mutationFingerprint(operation string, payload any) string {
	data, _ := json.Marshal(struct {
		Operation string `json:"operation"`
		Payload   any    `json:"payload"`
	}{operation, payload})
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func guessFingerprint(guess string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(guess))))
	return hex.EncodeToString(sum[:])
}

func (s *Server) handleGuess(w http.ResponseWriter, r *http.Request) {
	var req guessRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.RequestID == "" || len(req.RequestID) > 128 {
		writeError(w, http.StatusBadRequest, "invalid_request_id", "a request ID is required")
		return
	}
	fingerprint := guessFingerprint(req.Guess)
	if atomic, ok := s.rounds.(interface {
		UpdateRoundAndRun(context.Context, string, func(*game.Round, *game.Run, pgx.Tx) error) (*game.Round, *game.Run, error)
	}); ok {
		var player *players.Player
		if userID, signedIn := auth.UserID(r.Context()); signedIn && s.players != nil {
			p, err := s.players.Ensure(r.Context(), userID)
			if err != nil {
				s.log.Error("resolving player before guess", "err", err)
				writeError(w, http.StatusInternalServerError, "identity_unavailable", "could not save this move")
				return
			}
			player = &p
		}
		round, run, err := atomic.UpdateRoundAndRun(r.Context(), chi.URLParam(r, "id"), func(round *game.Round, run *game.Run, tx pgx.Tx) error {
			if round.RequestIDs[req.RequestID] {
				if old := round.RequestFingerprints[req.RequestID]; old != "" && old != fingerprint {
					return game.ErrRequestReused
				}
			} else {
				if err := round.Guess(req.Guess, s.pool.IsWord); err != nil {
					return err
				}
				if req.RequestID != "" {
					if round.RequestIDs == nil {
						round.RequestIDs = map[string]bool{}
					}
					round.RequestIDs[req.RequestID] = true
					if round.RequestFingerprints == nil {
						round.RequestFingerprints = map[string]string{}
					}
					round.RequestFingerprints[req.RequestID] = fingerprint
				}
			}
			if round.State != game.StatePlaying && player != nil {
				if err := s.players.RecordSolveTx(r.Context(), tx, player.ID, s.solveRecord(r, round)); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			s.writeGameError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, runRoundResponse{Round: s.roundView(round), Run: newRunView(run, s.pool)})
		return
	}
	if atomic, ok := s.rounds.(interface {
		UpdateRoundAndRunMemory(context.Context, string, func(*game.Round, *game.Run) error) (*game.Round, *game.Run, error)
	}); ok {
		var justFinished bool
		round, run, err := atomic.UpdateRoundAndRunMemory(r.Context(), chi.URLParam(r, "id"), func(round *game.Round, run *game.Run) error {
			if round.RequestIDs[req.RequestID] {
				if old := round.RequestFingerprints[req.RequestID]; old != "" && old != fingerprint {
					return game.ErrRequestReused
				}
				return nil
			}
			before := round.State
			if err := round.Guess(req.Guess, s.pool.IsWord); err != nil {
				return err
			}
			if round.RequestIDs == nil {
				round.RequestIDs = map[string]bool{}
			}
			if round.RequestFingerprints == nil {
				round.RequestFingerprints = map[string]string{}
			}
			round.RequestIDs[req.RequestID] = true
			round.RequestFingerprints[req.RequestID] = fingerprint
			justFinished = before == game.StatePlaying && round.State != game.StatePlaying
			if justFinished && run != nil {
				run.RecordRound(round)
			}
			return nil
		})
		if err != nil {
			s.writeGameError(w, err)
			return
		}
		if justFinished {
			s.recordSolve(r, round)
		}
		if round.State == game.StatePlaying {
			writeJSON(w, http.StatusOK, s.roundView(round))
		} else {
			writeJSON(w, http.StatusOK, runRoundResponse{Round: s.roundView(round), Run: newRunView(run, s.pool)})
		}
		return
	}

	var justFinished bool
	round, err := s.rounds.Update(r.Context(), chi.URLParam(r, "id"), func(round *game.Round) error {
		if round.RequestIDs[req.RequestID] {
			if old := round.RequestFingerprints[req.RequestID]; old != "" && old != fingerprint {
				return game.ErrRequestReused
			}
			return nil
		}
		before := round.State
		if err := round.Guess(req.Guess, s.pool.IsWord); err != nil {
			return err
		}
		if round.RequestIDs == nil {
			round.RequestIDs = make(map[string]bool)
		}
		if round.RequestFingerprints == nil {
			round.RequestFingerprints = map[string]string{}
		}
		round.RequestIDs[req.RequestID] = true
		round.RequestFingerprints[req.RequestID] = fingerprint
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
	// A retried final guess has already finished the round. Recording a run is
	// idempotent, and returning it here lets the client recover the completed
	// theme instead of being left with a stale local total.
	if round.State != game.StatePlaying && round.RunID != "" {
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

	err := s.players.RecordSolve(r.Context(), p.ID, s.solveRecord(r, round))
	if err != nil {
		s.log.Error("recording solve", "player", p.ID, "word", round.Reveal(), "err", err)
	}
}

func (s *Server) solveRecord(r *http.Request, round *game.Round) players.Solve {
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
	return players.Solve{
		Word:      answer,
		PackID:    packID,
		Solved:    round.State == game.StateWon,
		SolvedRow: solvedRow,
		Guesses:   len(round.Rows),
		HintsUsed: round.HintsUsed,
		Points:    round.Points(),
		PlayedOn:  localDate(r),
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
	case errors.Is(err, game.ErrStaleRun):
		writeError(w, http.StatusConflict, "stale_run", "the run has advanced; reload the current word")
	case errors.Is(err, game.ErrRoundInPlay):
		writeError(w, http.StatusConflict, "round_in_play", "finish the current word first")
	case errors.Is(err, game.ErrRoundOver):
		writeError(w, http.StatusConflict, "round_over", "this round has already finished")
	case errors.Is(err, game.ErrWrongLength):
		writeError(w, http.StatusUnprocessableEntity, "wrong_length", "that is not the right number of letters")
	case errors.Is(err, game.ErrNotAWord):
		writeError(w, http.StatusUnprocessableEntity, "not_a_word", "that is not a word")
	case errors.Is(err, game.ErrHintLocked):
		writeError(w, http.StatusConflict, "hint_locked", fmt.Sprintf("a clue unlocks after %d guesses", game.HintUnlocksAfter(1)))
	case errors.Is(err, game.ErrInvalidHint):
		writeError(w, http.StatusUnprocessableEntity, "invalid_hint", "that clue is unavailable")
	case errors.Is(err, game.ErrRequestReused):
		writeError(w, http.StatusConflict, "request_reused", "this request ID was already used for a different guess")
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
