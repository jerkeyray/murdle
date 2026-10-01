// Command wordled serves the Wordle game API.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jerkeyray/wordle/server/internal/auth"
	"github.com/jerkeyray/wordle/server/internal/config"
	"github.com/jerkeyray/wordle/server/internal/db"
	"github.com/jerkeyray/wordle/server/internal/duos"
	wordlehttp "github.com/jerkeyray/wordle/server/internal/http"
	"github.com/jerkeyray/wordle/server/internal/players"
	"github.com/jerkeyray/wordle/server/internal/store"
	"github.com/jerkeyray/wordle/server/internal/words"
)

// roundTTL is how long an untouched round survives. Long enough that a pair can
// put the phone down mid-round and come back to it; short enough that abandoned
// rounds do not accumulate.
const roundTTL = 6 * time.Hour

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	if err := run(log); err != nil {
		log.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// A local .env is a convenience for development; real deployments set real
	// environment variables and this is a no-op.
	if err := config.LoadDotenv(".env"); err != nil {
		return err
	}

	// The database is optional for now. Rounds live in memory, so the game is
	// fully playable without it; what it unlocks is accounts and history. A
	// bad URL is still fatal — silently running without the database the
	// operator asked for would be worse than refusing to start.
	var playerStore *players.Store
	var verifier *auth.Verifier
	var duoStore *duos.Store
	pool := words.NewPool()

	if url := os.Getenv("DATABASE_URL"); url != "" {
		conn, err := db.Open(ctx, url)
		if err != nil {
			return err
		}
		defer conn.Close()

		applied, err := db.Migrate(ctx, conn)
		if err != nil {
			return err
		}
		if len(applied) > 0 {
			log.Info("migrations applied", "count", len(applied), "files", applied)
		} else {
			log.Info("database up to date")
		}

		playerStore = players.New(conn)
		duoStore = duos.New(conn, pool)

		// Accounts are only meaningful if the tokens can be checked, so the
		// verifier is fetched here and a failure is fatal. Serving /api/me
		// with no way to verify a caller would be worse than not serving it.
		authURL := config.Env("AUTH_BASE_URL", "http://localhost:3000")
		verifier, err = auth.NewVerifier(ctx, authURL)
		if err != nil {
			return err
		}
		log.Info("auth ready", "jwks", authURL+"/api/auth/jwks")
	} else {
		log.Warn("DATABASE_URL not set — running without accounts or history")
	}

	answers, dictionary := pool.Size()
	log.Info("word pool loaded", "answers", answers, "dictionary", dictionary)

	rounds := store.NewMemory(roundTTL)
	go rounds.Reap(ctx, 10*time.Minute)

	handler := wordlehttp.NewServer(wordlehttp.Options{
		Pool:           pool,
		Rounds:         rounds,
		Log:            log,
		AllowedOrigins: allowedOrigins(),
		Players:        playerStore,
		Duos:           duoStore,
		Verifier:       verifier,
	})

	srv := &http.Server{
		Addr:              ":" + config.Env("PORT", "8080"),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		log.Info("shutting down")
	}

	// Give in-flight requests a moment to finish rather than cutting a player
	// off mid-guess.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

// allowedOrigins reads the CORS allowlist from the environment. It defaults to
// the local Next.js dev server so a fresh clone works with no configuration.
func allowedOrigins() []string {
	raw := config.Env("ALLOWED_ORIGINS", "http://localhost:3000")
	parts := strings.Split(raw, ",")

	origins := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			origins = append(origins, p)
		}
	}
	return origins
}
