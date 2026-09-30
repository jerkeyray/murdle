package http

import (
	"net/http"
	"time"
)

// localDateHeader carries the player's own calendar date, as YYYY-MM-DD.
const localDateHeader = "X-Murdle-Date"

// localDate returns the calendar day to file a round under, and to measure a
// streak against.
//
// A streak is a question about the player's day, not the server's. Those are
// different days for several hours out of every twenty-four: at 00:21 in
// Delhi it is still yesterday in UTC, so a round played just after midnight
// would be written under one date and then compared against another, and the
// streak would read as broken the moment it mattered most.
//
// The client is the only thing that knows which day it is where the phone is,
// so it says. There is no integrity concern: the only thing a player can do by
// lying is flatter their own streak.
func localDate(r *http.Request) time.Time {
	if raw := r.Header.Get(localDateHeader); raw != "" {
		if d, err := time.Parse("2006-01-02", raw); err == nil {
			return d
		}
	}
	// No header: fall back to the server's date, normalised the same way, so
	// writes and reads still agree with each other.
	now := time.Now().UTC()
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
}
