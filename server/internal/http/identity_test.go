package http

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jerkeyray/wordle/server/internal/auth"
	"github.com/jerkeyray/wordle/server/internal/players"
	"github.com/jerkeyray/wordle/server/internal/testdb"
)

func TestIdentityDatabaseFailureIsServiceError(t *testing.T) {
	pool := testdb.Open(t)
	s := &Server{players: players.New(pool), log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	ctx, cancel := context.WithCancel(auth.WithUserID(context.Background(), "adi"))
	cancel()
	for _, path := range []string{"/api/me", "/api/me/duos", "/api/me/presence"} {
		r := httptest.NewRequest(http.MethodGet, path, nil).WithContext(ctx)
		w := httptest.NewRecorder()
		switch path {
		case "/api/me":
			s.handleMe(w, r)
		case "/api/me/duos":
			s.handleDuos(w, r)
		default:
			s.handlePresence(w, r)
		}
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s: got %d %s, want 503", path, w.Code, w.Body.String())
		}
	}
	// Missing sessions and stale identities are still genuine authentication errors.
	for _, user := range []string{"", "missing-user"} {
		r := httptest.NewRequest(http.MethodGet, "/api/me", nil)
		if user != "" {
			r = r.WithContext(auth.WithUserID(r.Context(), user))
		}
		w := httptest.NewRecorder()
		s.handleMe(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("user %q: got %d, want 401", user, w.Code)
		}
	}
}
