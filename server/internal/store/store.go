// Package store persists rounds. The memory implementation is what Phases 0-2
// run on; a Postgres implementation lands alongside it in Phase 3 without the
// handlers having to change.
package store

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"strings"
	"sync"
	"time"

	"github.com/jerkeyray/murdle/server/internal/game"
)

// Store is the persistence boundary for rounds.
type Store interface {
	Create(ctx context.Context, r *game.Round) error
	Get(ctx context.Context, id string) (*game.Round, error)
	// Update applies fn to the stored round under whatever locking the
	// implementation needs, then persists the result. Read-modify-write on a
	// round has to be atomic or two fast taps can both claim the same row.
	Update(ctx context.Context, id string, fn func(*game.Round) error) (*game.Round, error)
}

// NewID returns a short, URL-safe, unguessable round id.
//
// Unguessable matters: round ids are the only thing standing between a curious
// player and someone else's in-progress board.
func NewID() string {
	var b [10]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand does not fail in practice, and a round id is not worth
		// taking the process down for.
		panic("store: reading random bytes: " + err.Error())
	}
	return strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:]))
}

// Memory keeps rounds in a map and forgets them after a TTL.
type Memory struct {
	mu     sync.RWMutex
	rounds map[string]*game.Round
	ttl    time.Duration
}

// NewMemory returns a store that drops rounds untouched for ttl. Call Reap in a
// goroutine, or rely on the lazy expiry in Get.
func NewMemory(ttl time.Duration) *Memory {
	return &Memory{rounds: make(map[string]*game.Round), ttl: ttl}
}

func (m *Memory) Create(_ context.Context, r *game.Round) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rounds[r.ID] = r
	return nil
}

func (m *Memory) Get(_ context.Context, id string) (*game.Round, error) {
	m.mu.RLock()
	r, ok := m.rounds[id]
	m.mu.RUnlock()

	if !ok || m.expired(r) {
		return nil, game.ErrRoundNotFound
	}
	return r, nil
}

func (m *Memory) Update(_ context.Context, id string, fn func(*game.Round) error) (*game.Round, error) {
	// The write lock covers the whole read-modify-write. Rounds are tiny and
	// held briefly, so a single store-wide lock is simpler than per-round
	// locking and costs nothing at this scale.
	m.mu.Lock()
	defer m.mu.Unlock()

	r, ok := m.rounds[id]
	if !ok || m.expired(r) {
		return nil, game.ErrRoundNotFound
	}
	if err := fn(r); err != nil {
		return nil, err
	}
	return r, nil
}

func (m *Memory) expired(r *game.Round) bool {
	return m.ttl > 0 && time.Since(r.UpdatedAt) > m.ttl
}

// Reap deletes expired rounds until ctx is cancelled. Without it, abandoned
// rounds would sit in the map forever.
func (m *Memory) Reap(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.mu.Lock()
			for id, r := range m.rounds {
				if m.expired(r) {
					delete(m.rounds, id)
				}
			}
			m.mu.Unlock()
		}
	}
}

// Len reports how many rounds are held, for the health endpoint.
func (m *Memory) Len() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.rounds)
}
