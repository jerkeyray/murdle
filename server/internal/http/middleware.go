package http

import (
	"net"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jerkeyray/wordle/server/internal/auth"
)

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
		w.ResponseWriter.WriteHeader(code)
	}
}
func (w *statusWriter) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(p)
}
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (s *Server) requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		pattern := chi.RouteContext(r.Context()).RoutePattern()
		if pattern == "" {
			pattern = "unmatched"
		}
		status := sw.status
		if status == 0 {
			status = http.StatusOK
		}
		s.log.Info("http request", "request_id", middleware.GetReqID(r.Context()), "method", r.Method, "route", pattern, "status", status, "duration_ms", time.Since(started).Milliseconds())
	})
}

type rateBucket struct {
	start time.Time
	count int
}
type rateLimits struct {
	mu        sync.Mutex
	entries   map[string]rateBucket
	lastSweep time.Time
}

func newRateLimits() *rateLimits { return &rateLimits{entries: make(map[string]rateBucket)} }
func configuredLimit(key string, fallback int) int {
	n, err := strconv.Atoi(os.Getenv(key))
	if err != nil || n < 1 {
		return fallback
	}
	return n
}

func (l *rateLimits) allow(key string, limit int, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.lastSweep) > time.Minute {
		for k, v := range l.entries {
			if now.Sub(v.start) > 2*time.Minute {
				delete(l.entries, k)
			}
		}
		l.lastSweep = now
	}
	if _, ok := l.entries[key]; !ok && len(l.entries) >= 10000 {
		return false
	}
	b := l.entries[key]
	if now.Sub(b.start) >= time.Minute || b.start.IsZero() {
		b = rateBucket{start: now}
	}
	b.count++
	l.entries[key] = b
	return b.count <= limit
}

func (s *Server) limit(kind string, limit int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, ok := auth.UserID(r.Context())
			if !ok {
				host, _, err := net.SplitHostPort(r.RemoteAddr)
				if err == nil {
					identity = host
				} else {
					identity = r.RemoteAddr
				}
			}
			if !s.limits.allow(kind+":"+identity, limit, time.Now()) {
				w.Header().Set("Retry-After", "60")
				writeError(w, http.StatusTooManyRequests, "rate_limited", "too many requests; try again shortly")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Only invitation-state transitions use the invitation budget. Daily guesses,
// passes, and endings have different usage patterns and stay outside it.
func (s *Server) limitDuoInvitation() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		limited := s.limit("invite", configuredLimit("INVITE_RATE_LIMIT", 10))(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch chi.URLParam(r, "action") {
			case "accept", "decline", "cancel":
				limited.ServeHTTP(w, r)
			default:
				next.ServeHTTP(w, r)
			}
		})
	}
}
