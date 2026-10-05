package http

// This fixture is compiled only into the test binary. Authentication shortcuts,
// answer inspection and restart controls never exist in the application server.
import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jerkeyray/wordle/server/internal/auth"
	"github.com/jerkeyray/wordle/server/internal/duos"
	"github.com/jerkeyray/wordle/server/internal/players"
	"github.com/jerkeyray/wordle/server/internal/store"
	"github.com/jerkeyray/wordle/server/internal/testdb"
	"github.com/jerkeyray/wordle/server/internal/words"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDuoBrowser(t *testing.T) {
	if os.Getenv("DUO_FIXTURE_SERVER") == "1" {
		serveDuoFixture(t)
		return
	}
	if os.Getenv("DUO_BROWSER_TEST") != "1" {
		t.Skip("DUO_BROWSER_TEST=1 enables two-browser PostgreSQL tests")
	}
	db := testdb.Open(t)
	fixtureURL := db.Config().ConnString()
	if u, e := url.Parse(fixtureURL); e == nil && (u.Scheme == "postgres" || u.Scheme == "postgresql") {
		q := u.Query()
		q.Set("search_path", db.Config().ConnConfig.RuntimeParams["search_path"])
		u.RawQuery = q.Encode()
		fixtureURL = u.String()
	} else {
		fixtureURL += " search_path=" + db.Config().ConnConfig.RuntimeParams["search_path"]
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	listener.Close()
	var child *exec.Cmd
	var lock sync.Mutex
	start := func() error {
		child = exec.Command(os.Args[0], "-test.run=^TestDuoBrowser$", "-test.v")
		child.Env = append(os.Environ(), "DUO_FIXTURE_SERVER=1", "DUO_FIXTURE_URL="+fixtureURL, "DUO_FIXTURE_ADDR="+addr)
		child.Stdout = os.Stdout
		child.Stderr = os.Stderr
		if err := child.Start(); err != nil {
			return err
		}
		client := &http.Client{Timeout: time.Second}
		for i := 0; i < 100; i++ {
			res, e := client.Get("http://" + addr + "/api/health")
			if e == nil {
				res.Body.Close()
				if res.StatusCode == 200 {
					return nil
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
		return fmt.Errorf("fixture API did not start")
	}
	stop := func() {
		if child != nil && child.Process != nil {
			_ = child.Process.Kill()
			_ = child.Wait()
		}
	}
	if err = start(); err != nil {
		stop()
		t.Fatal(err)
	}
	defer stop()
	target, _ := url.Parse("http://" + addr)
	proxy := httputil.NewSingleHostReverseProxy(target)
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lock.Lock()
		defer lock.Unlock()
		if r.URL.Path == "/test/restart" {
			stop()
			if e := start(); e != nil {
				http.Error(w, e.Error(), 500)
				return
			}
			w.WriteHeader(204)
			return
		}
		proxy.ServeHTTP(w, r)
	}))
	defer gateway.Close()
	cmd := exec.Command("npx", "playwright", "test", "tests/duos.spec.ts")
	cmd.Dir = "../../../web"
	cmd.Env = append(os.Environ(), "DUO_TEST_API="+gateway.URL)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err = cmd.Run(); err != nil {
		t.Fatal(err)
	}
}
func serveDuoFixture(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), os.Getenv("DUO_FIXTURE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	words := words.NewPool()
	duoStore := duos.New(pool, words)
	var advance atomic.Int64
	duoStore.Now = func() time.Time { return time.Now().Add(time.Duration(advance.Load()) * time.Second) }
	api := NewServer(Options{Pool: words, Rounds: store.NewMemory(6 * time.Hour), Players: players.New(pool), Duos: duoStore, Verifier: &auth.Verifier{}, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), AllowedOrigins: []string{"http://localhost:3000"}})
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer fixture-")
		if user != "adi" && user != "ananya" && user != "outsider" {
			user = ""
		}
		r.Header.Del("Authorization")
		if user != "" {
			r = r.WithContext(auth.WithUserID(r.Context(), user))
		}
		switch r.URL.Path {
		case "/test/advance":
			n, _ := strconv.ParseInt(r.URL.Query().Get("seconds"), 10, 64)
			advance.Add(n)
			w.WriteHeader(204)
			return
		case "/test/answer":
			var answer string
			err := pool.QueryRow(r.Context(), `select answer from duo_days join duos on duos.id=duo_days.duo_id join players on players.user_id=$2 where duo_id=$1 and players.id in (low_id,high_id) order by day desc, seq desc limit 1`, r.URL.Query().Get("id"), user).Scan(&answer)
			if err != nil {
				http.Error(w, "not found", 404)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"answer": answer})
			return
		}
		api.ServeHTTP(w, r)
	})
	if err = http.ListenAndServe(os.Getenv("DUO_FIXTURE_ADDR"), handler); err != nil {
		t.Fatal(err)
	}
}
