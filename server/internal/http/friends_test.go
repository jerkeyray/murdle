package http

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jerkeyray/wordle/server/internal/auth"
	"github.com/jerkeyray/wordle/server/internal/duos"
	"github.com/jerkeyray/wordle/server/internal/players"
	"github.com/jerkeyray/wordle/server/internal/store"
	"github.com/jerkeyray/wordle/server/internal/testdb"
	"github.com/jerkeyray/wordle/server/internal/words"
)

func TestFriendRoutes(t *testing.T) {
	db := testdb.Open(t)
	pool := words.NewPool()
	api := NewServer(Options{Pool: pool, Rounds: store.NewMemory(0), Players: players.New(db), Duos: duos.New(db, pool), Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	call := func(user, method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		data, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(data))
		if user != "" {
			r = r.WithContext(auth.WithUserID(context.Background(), user))
		}
		w := httptest.NewRecorder()
		api.ServeHTTP(w, r)
		return w
	}
	for _, user := range []string{"", "outsider"} {
		w := call(user, "GET", "/api/me/friends/"+testdb.Friendship, nil)
		want := 404
		if user == "" {
			want = 401
		}
		if w.Code != want {
			t.Fatalf("privacy %d %s", w.Code, w.Body.String())
		}
	}
	w := call("adi", "GET", "/api/me/friends/"+testdb.Friendship, nil)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var detail map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"id", "displayName", "joinedAt", "streak", "wordsSolved", "together"} {
		if _, ok := detail[key]; !ok {
			t.Fatal("missing", key)
		}
	}
	for _, key := range []string{"PlayerID", "inviteCode", "userId"} {
		if _, ok := detail[key]; ok {
			t.Fatal("private field", key)
		}
	}
	w = call("adi", "POST", "/api/me/play-invites", duos.PlayInviteMutation{RequestID: testdb.ID(), InviteCode: "OUTCDE", Timezone: "Asia/Kolkata"})
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var invite duos.PlayInvitation
	if err := json.Unmarshal(w.Body.Bytes(), &invite); err != nil {
		t.Fatal(err)
	}
	w = call("adi", "GET", "/api/me/friends/"+invite.FriendshipID, nil)
	if w.Code != 404 {
		t.Fatal("pending profile exposed")
	}
	m := duos.PlayInviteMutation{RequestID: testdb.ID()}
	path := "/api/me/play-invites/" + invite.FriendshipID + "/accept"
	w = call("outsider", "POST", path, m)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	first := w.Body.String()
	w = call("outsider", "POST", path, m)
	if w.Code != 200 || w.Body.String() != first {
		t.Fatal("HTTP retry changed")
	}
	w = call("adi", "GET", "/api/me/friends/"+invite.FriendshipID, nil)
	if w.Code != http.StatusOK {
		t.Fatal(w.Code, w.Body.String())
	}
	w = call("adi", "GET", "/api/me/friends", nil)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var friends []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &friends); err != nil {
		t.Fatal(err)
	}
	if len(friends) != 2 || friends[0]["sharedStreak"] == nil {
		t.Fatal("friend summary", friends)
	}
}
