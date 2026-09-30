// Command murdled serves the Murdle game API.
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

	murdlehttp "github.com/jerkeyray/murdle/server/internal/http"
	"github.com/jerkeyray/murdle/server/internal/store"
	"github.com/jerkeyray/murdle/server/internal/words"
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

	pool := words.NewPool()
	answers, dictionary := pool.Size()
	log.Info("word pool loaded", "answers", answers, "dictionary", dictionary)

	rounds := store.NewMemory(roundTTL)
	go rounds.Reap(ctx, 10*time.Minute)

	handler := murdlehttp.NewServer(pool, rounds, log, allowedOrigins())

	srv := &http.Server{
		Addr:              ":" + env("PORT", "8080"),
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
	raw := env("ALLOWED_ORIGINS", "http://localhost:3000")
	parts := strings.Split(raw, ",")

	origins := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			origins = append(origins, p)
		}
	}
	return origins
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
