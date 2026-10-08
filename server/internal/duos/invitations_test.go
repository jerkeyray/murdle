package duos

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jerkeyray/wordle/server/internal/players"
	"github.com/jerkeyray/wordle/server/internal/testdb"
	"github.com/jerkeyray/wordle/server/internal/words"
)

func invitationFixture(t *testing.T) *Store {
	s := New(testdb.Open(t), words.NewPool())
	s.Now = func() time.Time { return time.Date(2026, 10, 1, 20, 0, 0, 0, time.UTC) }
	return s
}
func TestPlayInvitationAcceptRetryAndPrivacy(t *testing.T) {
	ctx := context.Background()
	s := invitationFixture(t)
	m := PlayInviteMutation{RequestID: testdb.ID(), InviteCode: " outcde ", Timezone: "Asia/Kolkata"}
	req, err := s.PlayInvite(ctx, testdb.A, "", "create", m)
	if err != nil || req.Status != "pending" || req.Duo != nil {
		t.Fatalf("request: %+v %v", req, err)
	}
	retry, err := s.PlayInvite(ctx, testdb.A, "", "create", m)
	if err != nil || retry.FriendshipID != req.FriendshipID {
		t.Fatal("request retry", err)
	}
	m.InviteCode = "ANACDE"
	_, err = s.PlayInvite(ctx, testdb.A, "", "create", m)
	requireCode(t, err, "request_reused")
	_, err = s.PlayInvite(ctx, testdb.B, req.FriendshipID, "accept", PlayInviteMutation{RequestID: testdb.ID()})
	requireCode(t, err, "not_found")
	_, err = s.PlayInvite(ctx, testdb.A, req.FriendshipID, "accept", PlayInviteMutation{RequestID: testdb.ID()})
	requireCode(t, err, "invalid_action")
	accept := PlayInviteMutation{RequestID: testdb.ID()}
	result, err := s.PlayInvite(ctx, testdb.C, req.FriendshipID, "accept", accept)
	if err != nil || result.Status != "accepted" || result.Duo == nil || result.Duo.Status != "active" || result.Duo.Today == nil {
		t.Fatalf("accept: %+v %v", result, err)
	}
	if result.Duo.Today.Date != "2026-10-02" || result.Duo.InviterID != testdb.A || result.Duo.Today.Answer != "" {
		t.Fatal("unsafe board or wrong timezone")
	}
	retry, err = s.PlayInvite(ctx, testdb.C, req.FriendshipID, "accept", accept)
	if err != nil || retry.Duo.ID != result.Duo.ID {
		t.Fatal("accept retry", err)
	}
	var boards int
	if err = s.db.QueryRow(ctx, `select count(*) from duo_days where duo_id=$1`, result.Duo.ID).Scan(&boards); err != nil || boards != 1 {
		t.Fatal("duplicate boards", boards, err)
	}
	reused, err := s.PlayInvite(ctx, testdb.A, "", "create", PlayInviteMutation{RequestID: testdb.ID(), InviteCode: "OUTCDE", Timezone: "UTC"})
	if err != nil || reused.Duo.ID != result.Duo.ID || reused.Duo.Timezone != "Asia/Kolkata" {
		t.Fatal("active game reuse", err)
	}
}
func TestPlayInvitationCancelDeclineAndRollback(t *testing.T) {
	for _, action := range []string{"cancel", "decline"} {
		t.Run(action, func(t *testing.T) {
			s := invitationFixture(t)
			ctx := context.Background()
			req, err := s.PlayInvite(ctx, testdb.A, "", "create", PlayInviteMutation{RequestID: testdb.ID(), InviteCode: "OUTCDE", Timezone: "UTC"})
			if err != nil {
				t.Fatal(err)
			}
			actor := testdb.C
			if action == "cancel" {
				actor = testdb.A
			}
			wrong := testdb.A
			if action == "cancel" {
				wrong = testdb.C
			}
			_, err = s.PlayInvite(ctx, wrong, req.FriendshipID, action, PlayInviteMutation{RequestID: testdb.ID()})
			requireCode(t, err, "invalid_action")
			m := PlayInviteMutation{RequestID: testdb.ID()}
			result, err := s.PlayInvite(ctx, actor, req.FriendshipID, action, m)
			if err != nil {
				t.Fatal(err)
			}
			retry, err := s.PlayInvite(ctx, actor, req.FriendshipID, action, m)
			if err != nil || retry.Status != result.Status {
				t.Fatal("retry", err)
			}
			var n int
			if err = s.db.QueryRow(ctx, `select count(*) from duos where friendship_id=$1`, req.FriendshipID).Scan(&n); err != nil || n != 0 {
				t.Fatal("unexpected game", err)
			}
			again, e := s.PlayInvite(ctx, testdb.A, "", "create", PlayInviteMutation{RequestID: testdb.ID(), InviteCode: "OUTCDE", Timezone: "UTC"})
			if action == "decline" {
				requireCode(t, e, "not_found")
			} else if e != nil || again.Status != "pending" {
				t.Fatal("cancel prevents new invite", e)
			}
		})
	}
	t.Run("rollback", func(t *testing.T) {
		s := invitationFixture(t)
		ctx := context.Background()
		req, err := s.PlayInvite(ctx, testdb.A, "", "create", PlayInviteMutation{RequestID: testdb.ID(), InviteCode: "OUTCDE", Timezone: "UTC"})
		if err != nil {
			t.Fatal(err)
		}
		// Fail after accepting the friendship and inserting a duo, during dealing.
		_, err = s.db.Exec(ctx, `create function reject_board() returns trigger language plpgsql as $$ begin raise exception 'test deal failure'; end $$; create trigger fail_board before insert on duo_days for each row execute function reject_board()`)
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.PlayInvite(ctx, testdb.C, req.FriendshipID, "accept", PlayInviteMutation{RequestID: testdb.ID()})
		if err == nil {
			t.Fatal("expected deal failure")
		}
		var status string
		var n int
		if err = s.db.QueryRow(ctx, `select status from friendships where id=$1`, req.FriendshipID).Scan(&status); err != nil || status != "pending" {
			t.Fatal("partial acceptance", status, err)
		}
		if err = s.db.QueryRow(ctx, `select count(*) from duos where friendship_id=$1`, req.FriendshipID).Scan(&n); err != nil || n != 0 {
			t.Fatal("partial game", err)
		}
	})
}
func TestPlayInvitationCrossedAndLegacy(t *testing.T) {
	t.Run("concurrent", func(t *testing.T) {
		s := invitationFixture(t)
		ctx := context.Background()
		var wg sync.WaitGroup
		results := make([]*PlayInvitation, 2)
		errs := make([]error, 2)
		for i, p := range []string{testdb.A, testdb.C} {
			wg.Add(1)
			go func(i int, p string) {
				defer wg.Done()
				code := "OUTCDE"
				if p == testdb.C {
					code = "ADICDE"
				}
				results[i], errs[i] = s.PlayInvite(ctx, p, "", "create", PlayInviteMutation{RequestID: testdb.ID(), InviteCode: code, Timezone: "UTC"})
			}(i, p)
		}
		wg.Wait()
		for _, err := range errs {
			if err != nil {
				t.Fatal(err)
			}
		}
		if results[0].FriendshipID != results[1].FriendshipID {
			t.Fatal("duplicate friendship")
		}
		var n int
		if err := s.db.QueryRow(ctx, `select count(*) from duos where friendship_id=$1 and status='active'`, results[0].FriendshipID).Scan(&n); err != nil || n != 1 {
			t.Fatal("crossed games", n, err)
		}
	})
	t.Run("legacy incoming", func(t *testing.T) {
		s := invitationFixture(t)
		ctx := context.Background()
		f, err := players.New(s.db).RequestFriend(ctx, testdb.C, "ADICDE")
		if err != nil {
			t.Fatal(err)
		}
		r, err := s.PlayInvite(ctx, testdb.A, "", "create", PlayInviteMutation{RequestID: testdb.ID(), InviteCode: "OUTCDE", Timezone: "UTC"})
		if err != nil || r.FriendshipID != f.FriendshipID || r.Status != "accepted" || r.Duo.Status != "pending" {
			t.Fatal("legacy consent", err)
		}
	})
	t.Run("legacy outgoing upgraded", func(t *testing.T) {
		s := invitationFixture(t)
		ctx := context.Background()
		f, err := players.New(s.db).RequestFriend(ctx, testdb.A, "OUTCDE")
		if err != nil {
			t.Fatal(err)
		}
		r, err := s.PlayInvite(ctx, testdb.A, "", "create", PlayInviteMutation{RequestID: testdb.ID(), InviteCode: "OUTCDE", Timezone: "UTC"})
		if err != nil || r.FriendshipID != f.FriendshipID || r.Status != "pending" {
			t.Fatal("upgrade", err)
		}
		r, err = s.PlayInvite(ctx, testdb.C, f.FriendshipID, "accept", PlayInviteMutation{RequestID: testdb.ID()})
		if err != nil || r.Duo.Status != "active" {
			t.Fatal("upgrade acceptance", err)
		}
	})
}
