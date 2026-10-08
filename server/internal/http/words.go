package http

import "net/http"

// handleWordStats serves the figures behind the about page. They are public and
// identical for everyone, and change only when the server is redeployed with a
// new bank, so an hour of caching costs nothing.
func (s *Server) handleWordStats(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=3600")
	writeJSON(w, http.StatusOK, s.pool.Stats())
}
