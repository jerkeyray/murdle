package http

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jerkeyray/murdle/server/internal/store"
	"github.com/jerkeyray/murdle/server/internal/words"
)

func newTestServer(t *testing.T) http.Handler {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewServer(words.NewPool(), store.NewMemory(time.Hour), log, []string{"*"})
}

// do sends a request and returns the recorder plus the decoded body.
func do(t *testing.T, h http.Handler, method, path string, body any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()

	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshalling request: %v", err)
		}
		reader = bytes.NewReader(raw)
	}

	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var decoded map[string]any
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &decoded); err != nil {
			t.Fatalf("decoding %s %s response %q: %v", method, path, rec.Body.String(), err)
		}
	}
	return rec, decoded
}

func TestHealth(t *testing.T) {
	rec, body := do(t, newTestServer(t), http.MethodGet, "/api/health", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body["status"] != "ok" {
		t.Errorf("status field = %v, want ok", body["status"])
	}
	if body["answers"].(float64) < 100 {
		t.Errorf("answers = %v, want the curated pool", body["answers"])
	}
}

func TestCreateRoundAcceptsAnEmptyBody(t *testing.T) {
	rec, body := do(t, newTestServer(t), http.MethodPost, "/api/rounds", nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d body = %v, want 201", rec.Code, body)
	}
	if body["mode"] != "solo" {
		t.Errorf("default mode = %v, want solo", body["mode"])
	}
	if body["turnSeat"].(float64) != 0 {
		t.Errorf("opening turnSeat = %v, want 0", body["turnSeat"])
	}
}

// The single most important property of this API: while a round is in play, the
// answer must not appear anywhere in any response, in any field.
func TestAnswerDoesNotLeakWhilePlaying(t *testing.T) {
	h := newTestServer(t)

	_, created := do(t, h, http.MethodPost, "/api/rounds", map[string]any{"mode": "solo"})
	id := created["id"].(string)

	if _, present := created["answer"]; present {
		t.Fatal("create response carried an answer field")
	}

	// Play several wrong guesses and re-read the round between each, checking
	// the whole serialized body rather than one field.
	for _, guess := range []string{"crane", "moist", "plumb"} {
		rec, _ := do(t, h, http.MethodPost, "/api/rounds/"+id+"/guesses",
			map[string]any{"seat": 0, "guess": guess})
		assertNoAnswerField(t, rec, "guess response")

		rec, _ = do(t, h, http.MethodGet, "/api/rounds/"+id, nil)
		assertNoAnswerField(t, rec, "get response")
	}
}

func assertNoAnswerField(t *testing.T, rec *httptest.ResponseRecorder, what string) {
	t.Helper()
	if strings.Contains(rec.Body.String(), `"answer"`) {
		t.Fatalf("%s exposed an answer field while the round was live: %s", what, rec.Body.String())
	}
}

func TestPlayARoundToCompletion(t *testing.T) {
	h := newTestServer(t)
	_, created := do(t, h, http.MethodPost, "/api/rounds", map[string]any{"mode": "solo"})
	id := created["id"].(string)

	// Burn all six rows. The pool word is unknown to the test, so on the tiny
	// chance a guess is correct the round ends early and we stop.
	var final map[string]any
	for i := 0; i < 6; i++ {
		_, final = do(t, h, http.MethodPost, "/api/rounds/"+id+"/guesses",
			map[string]any{"seat": 0, "guess": "crane"})
		if final["state"] != "playing" {
			break
		}
	}

	if final["state"] == "playing" {
		t.Fatalf("round still playing after six guesses: %v", final)
	}
	answer, ok := final["answer"].(string)
	if !ok || len(answer) != 5 {
		t.Errorf("finished round should reveal a five-letter answer, got %v", final["answer"])
	}
	if final["turnSeat"].(float64) != -1 {
		t.Errorf("finished round turnSeat = %v, want -1", final["turnSeat"])
	}
}

func TestGuessValidation(t *testing.T) {
	h := newTestServer(t)
	_, created := do(t, h, http.MethodPost, "/api/rounds", nil)
	id := created["id"].(string)

	cases := []struct {
		name  string
		guess string
		want  string
	}{
		{"too short", "four", "wrong_length"},
		{"too long", "sixers", "wrong_length"},
		{"not a word", "zzzzz", "not_a_word"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec, body := do(t, h, http.MethodPost, "/api/rounds/"+id+"/guesses",
				map[string]any{"seat": 0, "guess": tc.guess})
			if rec.Code != http.StatusUnprocessableEntity {
				t.Errorf("status = %d, want 422", rec.Code)
			}
			if body["code"] != tc.want {
				t.Errorf("code = %v, want %v", body["code"], tc.want)
			}
		})
	}
}

func TestSharedRoundRejectsOutOfTurnGuesses(t *testing.T) {
	h := newTestServer(t)
	_, created := do(t, h, http.MethodPost, "/api/rounds",
		map[string]any{"mode": "shared", "firstSeat": 1})
	id := created["id"].(string)

	if created["turnSeat"].(float64) != 1 {
		t.Fatalf("turnSeat = %v, want 1", created["turnSeat"])
	}

	rec, body := do(t, h, http.MethodPost, "/api/rounds/"+id+"/guesses",
		map[string]any{"seat": 0, "guess": "crane"})
	if rec.Code != http.StatusConflict {
		t.Errorf("status = %d, want 409", rec.Code)
	}
	if body["code"] != "wrong_seat" {
		t.Errorf("code = %v, want wrong_seat", body["code"])
	}
}

func TestHintsAreSpentAndCapped(t *testing.T) {
	h := newTestServer(t)
	_, created := do(t, h, http.MethodPost, "/api/rounds", nil)
	id := created["id"].(string)

	for tier := 0; tier < 3; tier++ {
		rec, body := do(t, h, http.MethodPost, "/api/rounds/"+id+"/hints", map[string]any{"seat": 0})
		if rec.Code != http.StatusOK {
			t.Fatalf("hint %d status = %d body = %v", tier, rec.Code, body)
		}
		if body["tier"].(float64) != float64(tier) {
			t.Errorf("tier = %v, want %d", body["tier"], tier)
		}
	}

	rec, body := do(t, h, http.MethodPost, "/api/rounds/"+id+"/hints", map[string]any{"seat": 0})
	if rec.Code != http.StatusConflict || body["code"] != "no_hints_left" {
		t.Errorf("fourth hint: status %d code %v, want 409 no_hints_left", rec.Code, body["code"])
	}
}

func TestUnknownRound(t *testing.T) {
	rec, body := do(t, newTestServer(t), http.MethodGet, "/api/rounds/nope", nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
	if body["code"] != "round_not_found" {
		t.Errorf("code = %v, want round_not_found", body["code"])
	}
}

// A run's whole point is that you work out the connection yourselves. The
// theme must not appear anywhere in any response until the final round ends.
func TestThemeDoesNotLeakUntilTheRunIsComplete(t *testing.T) {
	h := newTestServer(t)

	rec, run := do(t, h, http.MethodPost, "/api/runs", map[string]any{"mode": "solo"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create run: %d %v", rec.Code, run)
	}
	assertNoPack(t, rec, "create run response")

	runID := run["id"].(string)
	length := int(run["length"].(float64))
	if length == 0 {
		t.Fatal("run has no words")
	}

	for i := 0; i < length; i++ {
		rec, body := do(t, h, http.MethodPost, "/api/runs/"+runID+"/rounds", nil)
		if rec.Code != http.StatusCreated {
			t.Fatalf("round %d: %d %v", i, rec.Code, body)
		}
		assertNoPack(t, rec, "start round response")

		roundID := body["round"].(map[string]any)["id"].(string)

		// Burn the round out. Six wrong guesses ends it unless one happens to
		// be right, which ends it sooner.
		var last *httptest.ResponseRecorder
		for g := 0; g < 6; g++ {
			var round map[string]any
			last, round = do(t, h, http.MethodPost, "/api/rounds/"+roundID+"/guesses",
				map[string]any{"seat": 0, "guess": "crane"})
			if r, ok := round["round"].(map[string]any); ok {
				if r["state"] != "playing" {
					break
				}
			} else if round["state"] != "playing" {
				break
			}
		}

		// Every response before the last round ends must stay silent about it.
		if i < length-1 {
			assertNoPack(t, last, "mid-run guess response")

			rec, _ := do(t, h, http.MethodGet, "/api/runs/"+runID, nil)
			assertNoPack(t, rec, "mid-run run state")
		}
	}

	rec, final := do(t, h, http.MethodGet, "/api/runs/"+runID, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("final run state: %d", rec.Code)
	}
	if final["complete"] != true {
		t.Fatalf("run not complete after %d rounds: %v", length, final)
	}
	pack, ok := final["pack"].(map[string]any)
	if !ok {
		t.Fatalf("completed run did not reveal its pack: %v", final)
	}
	if pack["title"] == "" || pack["blurb"] == "" {
		t.Errorf("revealed pack is empty: %v", pack)
	}
}

func assertNoPack(t *testing.T, rec *httptest.ResponseRecorder, what string) {
	t.Helper()
	if rec == nil {
		return
	}
	if strings.Contains(rec.Body.String(), `"pack"`) {
		t.Fatalf("%s revealed the theme early: %s", what, rec.Body.String())
	}
}

// The entry rides along with the answer: both absent while playing, both
// present once the round is over.
func TestEntryAppearsOnlyWithTheAnswer(t *testing.T) {
	h := newTestServer(t)

	_, run := do(t, h, http.MethodPost, "/api/runs", map[string]any{"mode": "solo"})
	runID := run["id"].(string)

	_, started := do(t, h, http.MethodPost, "/api/runs/"+runID+"/rounds", nil)
	roundID := started["round"].(map[string]any)["id"].(string)

	rec, _ := do(t, h, http.MethodGet, "/api/rounds/"+roundID, nil)
	if strings.Contains(rec.Body.String(), `"entry"`) {
		t.Fatal("entry exposed while the round was still in play")
	}

	var round map[string]any
	for g := 0; g < 6; g++ {
		_, body := do(t, h, http.MethodPost, "/api/rounds/"+roundID+"/guesses",
			map[string]any{"seat": 0, "guess": "crane"})
		if r, ok := body["round"].(map[string]any); ok {
			round = r
		} else {
			round = body
		}
		if round["state"] != "playing" {
			break
		}
	}

	entry, ok := round["entry"].(map[string]any)
	if !ok {
		t.Fatalf("finished round carried no entry: %v", round)
	}
	for _, field := range []string{"word", "definition", "note"} {
		if s, _ := entry[field].(string); s == "" {
			t.Errorf("entry.%s is empty: %v", field, entry)
		}
	}
}

// Starting two rounds without finishing the first would burn a word from the
// run and orphan a round.
func TestRunRefusesOverlappingRounds(t *testing.T) {
	h := newTestServer(t)

	_, run := do(t, h, http.MethodPost, "/api/runs", nil)
	runID := run["id"].(string)

	if rec, body := do(t, h, http.MethodPost, "/api/runs/"+runID+"/rounds", nil); rec.Code != http.StatusCreated {
		t.Fatalf("first round: %d %v", rec.Code, body)
	}

	rec, body := do(t, h, http.MethodPost, "/api/runs/"+runID+"/rounds", nil)
	if rec.Code != http.StatusConflict || body["code"] != "round_in_play" {
		t.Errorf("overlapping round: %d %v, want 409 round_in_play", rec.Code, body["code"])
	}
}
