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
	return NewServer(Options{
		Pool:           words.NewPool(),
		Rounds:         store.NewMemory(time.Hour),
		Log:            log,
		AllowedOrigins: []string{"*"},
	})
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

// A run is the only way to get a round, and it deals words in order.
func TestRunDealsWords(t *testing.T) {
	h := newTestServer(t)

	rec, run := do(t, h, http.MethodPost, "/api/runs", nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create run: %d %v", rec.Code, run)
	}
	assertNoPack(t, rec, "create run response")

	rec, dealt := do(t, h, http.MethodPost, "/api/runs/"+run["id"].(string)+"/rounds", nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("deal: %d %v", rec.Code, dealt)
	}
	round := dealt["round"].(map[string]any)
	if round["wordLength"].(float64) != 5 {
		t.Errorf("wordLength = %v, want 5", round["wordLength"])
	}
	if _, present := round["answer"]; present {
		t.Error("a freshly dealt round carried an answer")
	}
}

// The single most important property: while a round is in play the answer must
// not appear anywhere in any response, in any field.
func TestAnswerDoesNotLeakWhilePlaying(t *testing.T) {
	h := newTestServer(t)

	_, run := do(t, h, http.MethodPost, "/api/runs", nil)
	_, dealt := do(t, h, http.MethodPost, "/api/runs/"+run["id"].(string)+"/rounds", nil)
	id := dealt["round"].(map[string]any)["id"].(string)

	for _, guess := range []string{"crane", "moist", "plumb"} {
		rec, _ := do(t, h, http.MethodPost, "/api/rounds/"+id+"/guesses",
			map[string]any{"guess": guess})
		if strings.Contains(rec.Body.String(), `"answer"`) {
			t.Fatalf("guess response leaked the answer: %s", rec.Body.String())
		}

		rec, _ = do(t, h, http.MethodGet, "/api/rounds/"+id, nil)
		if strings.Contains(rec.Body.String(), `"answer"`) {
			t.Fatalf("get response leaked the answer: %s", rec.Body.String())
		}
	}
}

func TestPlayARoundToCompletion(t *testing.T) {
	h := newTestServer(t)

	_, run := do(t, h, http.MethodPost, "/api/runs", nil)
	_, dealt := do(t, h, http.MethodPost, "/api/runs/"+run["id"].(string)+"/rounds", nil)
	id := dealt["round"].(map[string]any)["id"].(string)

	var final map[string]any
	for i := 0; i < 6; i++ {
		_, body := do(t, h, http.MethodPost, "/api/rounds/"+id+"/guesses",
			map[string]any{"guess": "crane"})
		final = body
		if nested, ok := body["round"].(map[string]any); ok {
			final = nested
		}
		if final["state"] != "playing" {
			break
		}
	}

	if final["state"] == "playing" {
		t.Fatalf("round still playing after six guesses: %v", final)
	}
	if answer, _ := final["answer"].(string); len(answer) != 5 {
		t.Errorf("finished round should reveal a five-letter answer, got %v", final["answer"])
	}
	entry, ok := final["entry"].(map[string]any)
	if !ok {
		t.Fatalf("finished round carried no entry: %v", final)
	}
	for _, field := range []string{"word", "definition", "note"} {
		if s, _ := entry[field].(string); s == "" {
			t.Errorf("entry.%s is empty", field)
		}
	}
}

func TestGuessValidation(t *testing.T) {
	h := newTestServer(t)

	_, run := do(t, h, http.MethodPost, "/api/runs", nil)
	_, dealt := do(t, h, http.MethodPost, "/api/runs/"+run["id"].(string)+"/rounds", nil)
	id := dealt["round"].(map[string]any)["id"].(string)

	cases := []struct{ name, guess, want string }{
		{"too short", "four", "wrong_length"},
		{"too long", "sixers", "wrong_length"},
		{"not a word", "zzzzz", "not_a_word"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec, body := do(t, h, http.MethodPost, "/api/rounds/"+id+"/guesses",
				map[string]any{"guess": tc.guess})
			if rec.Code != http.StatusUnprocessableEntity {
				t.Errorf("status = %d, want 422", rec.Code)
			}
			if body["code"] != tc.want {
				t.Errorf("code = %v, want %v", body["code"], tc.want)
			}
		})
	}
}

func TestHintsAreSpentAndCapped(t *testing.T) {
	h := newTestServer(t)

	_, run := do(t, h, http.MethodPost, "/api/runs", nil)
	_, dealt := do(t, h, http.MethodPost, "/api/runs/"+run["id"].(string)+"/rounds", nil)
	id := dealt["round"].(map[string]any)["id"].(string)

	for tier := 0; tier < 3; tier++ {
		rec, body := do(t, h, http.MethodPost, "/api/rounds/"+id+"/hints", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("hint %d: %d %v", tier, rec.Code, body)
		}
		if body["tier"].(float64) != float64(tier) {
			t.Errorf("tier = %v, want %d", body["tier"], tier)
		}
	}

	rec, body := do(t, h, http.MethodPost, "/api/rounds/"+id+"/hints", nil)
	if rec.Code != http.StatusConflict || body["code"] != "no_hints_left" {
		t.Errorf("fourth hint: %d %v, want 409 no_hints_left", rec.Code, body["code"])
	}
}

// Starting two rounds without finishing the first would burn a word and orphan
// a round.
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

// The theme is the payoff for the whole run, so it must not appear until the
// last word falls.
func TestThemeDoesNotLeakUntilTheRunIsComplete(t *testing.T) {
	h := newTestServer(t)

	rec, run := do(t, h, http.MethodPost, "/api/runs", nil)
	assertNoPack(t, rec, "create run response")

	runID := run["id"].(string)
	length := int(run["length"].(float64))

	for i := 0; i < length; i++ {
		rec, dealt := do(t, h, http.MethodPost, "/api/runs/"+runID+"/rounds", nil)
		assertNoPack(t, rec, "deal response")
		id := dealt["round"].(map[string]any)["id"].(string)

		var last *httptest.ResponseRecorder
		for g := 0; g < 6; g++ {
			r, body := do(t, h, http.MethodPost, "/api/rounds/"+id+"/guesses",
				map[string]any{"guess": "crane"})
			last = r
			state := body
			if nested, ok := body["round"].(map[string]any); ok {
				state = nested
			}
			if state["state"] != "playing" {
				break
			}
		}

		if i < length-1 {
			assertNoPack(t, last, "mid-run guess response")
			rec, _ := do(t, h, http.MethodGet, "/api/runs/"+runID, nil)
			assertNoPack(t, rec, "mid-run run state")
		}
	}

	rec, final := do(t, h, http.MethodGet, "/api/runs/"+runID, nil)
	if rec.Code != http.StatusOK || final["complete"] != true {
		t.Fatalf("run not complete: %d %v", rec.Code, final)
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
