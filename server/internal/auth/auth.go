// Package auth verifies the session tokens Better Auth issues.
//
// Go never mints a token and never stores a credential. Better Auth signs a
// JWT (EdDSA/Ed25519) and publishes its public keys at /api/auth/jwks; this
// package checks incoming tokens against that endpoint. One place in the
// system knows how to create a session, and it is not this one.
package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

var (
	// ErrNoToken means the caller sent no credentials at all.
	ErrNoToken = errors.New("no bearer token")
	// ErrBadToken means they sent something that did not verify.
	ErrBadToken = errors.New("invalid token")
)

// Verifier checks tokens against a JWKS endpoint.
type Verifier struct {
	keys   keyfunc.Keyfunc
	issuer string
}

// NewVerifier fetches the key set and keeps it refreshed.
//
// baseURL is the Next.js origin that issues the tokens, e.g.
// https://wordle.xyz. Keys are fetched once here so a bad configuration fails
// at startup rather than on a player's first request.
func NewVerifier(ctx context.Context, baseURL string) (*Verifier, error) {
	jwksURL := strings.TrimRight(baseURL, "/") + "/api/auth/jwks"

	keys, err := keyfunc.NewDefaultCtx(ctx, []string{jwksURL})
	if err != nil {
		return nil, fmt.Errorf("fetching jwks from %s: %w", jwksURL, err)
	}

	return &Verifier{keys: keys, issuer: strings.TrimRight(baseURL, "/")}, nil
}

// Subject verifies a token and returns the Better Auth user id it belongs to.
func (v *Verifier) Subject(token string) (string, error) {
	parsed, err := jwt.Parse(token, v.keys.Keyfunc,
		// Pin the algorithm. Without this a token could ask to be verified
		// with a different one, which is the classic JWT confusion attack.
		jwt.WithValidMethods([]string{"EdDSA"}),
		jwt.WithIssuer(v.issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil || !parsed.Valid {
		return "", ErrBadToken
	}

	subject, err := parsed.Claims.GetSubject()
	if err != nil || subject == "" {
		return "", ErrBadToken
	}

	return subject, nil
}

type contextKey struct{}

// UserID returns the authenticated Better Auth user id, if there is one.
func UserID(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(contextKey{}).(string)
	return id, ok && id != ""
}

// WithUserID is exported for tests, which need to build an authenticated
// context without minting a real token.
func WithUserID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, contextKey{}, id)
}

// bearer pulls the token out of an Authorization header.
func bearer(r *http.Request) (string, error) {
	header := r.Header.Get("Authorization")
	if header == "" {
		return "", ErrNoToken
	}

	token, ok := strings.CutPrefix(header, "Bearer ")
	if !ok || strings.TrimSpace(token) == "" {
		return "", ErrNoToken
	}

	return strings.TrimSpace(token), nil
}

// Optional attaches the user id when a valid token is present and otherwise
// lets the request through unauthenticated.
//
// Playing does not require an account — that is the point of a game two people
// pick up on one phone. Signing in is what adds history to it.
func (v *Verifier) Optional(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, err := bearer(r)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}

		id, err := v.Subject(token)
		if err != nil {
			// A token that was sent but does not verify is a real problem —
			// an expired session, or tampering — and silently treating it as
			// anonymous would hide both.
			http.Error(w, `{"code":"invalid_token","message":"sign in again"}`,
				http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r.WithContext(WithUserID(r.Context(), id)))
	})
}

// Require rejects anything without a valid token. Used for the endpoints that
// are about a person rather than about a game.
func Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := UserID(r.Context()); !ok {
			http.Error(w, `{"code":"unauthorized","message":"sign in to do that"}`,
				http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
