package duos

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jerkeyray/wordle/server/internal/players"
	"github.com/jerkeyray/wordle/server/internal/testdb"
)

func TestPairStatsAndDistinctFriendWords(t *testing.T) {
	s, d, now := fixture(t)
	ctx := context.Background()
	// A historical three-day streak, a gap, and yesterday's win.
	for _, date := range []string{"2026-09-26", "2026-09-27", "2026-09-28", "2026-09-30"} {
		_, err := s.db.Exec(ctx, `insert into duo_days(duo_id,day,seq,deadline,answer,entry,cycle,state,current_player) select duo_id,$2::date,0,$2::date+interval '1 day',answer,entry,cycle,'won',current_player from duo_days where duo_id=$1 limit 1`, d.ID, date)
		if err != nil {
			t.Fatal(err)
		}
	}
	stats, err := s.PairStats(ctx, []string{testdb.Friendship})
	if err != nil {
		t.Fatal(err)
	}
	st := stats[testdb.Friendship]
	if st.Current != 1 || st.Longest != 3 || st.WordsSolved != 4 {
		t.Fatalf("stats: %+v", st)
	}
	var answer string
	if err = s.db.QueryRow(ctx, `select answer from duo_days where duo_id=$1 limit 1`, d.ID).Scan(&answer); err != nil {
		t.Fatal(err)
	}
	// Multiple boards count as separate wins, but only one streak day.
	_, err = s.db.Exec(ctx, `update duo_days set state='won' where duo_id=$1 and day='2026-10-01'`, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.db.Exec(ctx, `insert into duo_days(duo_id,day,seq,deadline,answer,entry,cycle,state,current_player) select duo_id,day,1,deadline,answer,entry,cycle,'lost',current_player from duo_days where duo_id=$1 and day='2026-10-01'`, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	stats, err = s.PairStats(ctx, []string{testdb.Friendship})
	if err != nil {
		t.Fatal(err)
	}
	if stats[testdb.Friendship].Current != 2 || stats[testdb.Friendship].WordsSolved != 5 {
		t.Fatal("extra loss undid win", stats)
	}
	// Personal totals deduplicate repeats and include shared wins for both seats.
	ps := players.New(s.db)
	for _, record := range []players.Solve{{Word: answer, Solved: true, PlayedOn: *now}, {Word: "apple", Solved: true, PlayedOn: *now}, {Word: "crane", Solved: false, PlayedOn: *now}} {
		if err = ps.RecordSolve(ctx, testdb.B, record); err != nil {
			t.Fatal(err)
		}
	}
	p, err := ps.FriendProfile(ctx, testdb.A, testdb.Friendship, *now)
	if err != nil || p.WordsSolved != 2 || p.Streak.Current != 1 {
		t.Fatalf("personal: %+v %v", p, err)
	}
	p, err = ps.FriendProfile(ctx, testdb.B, testdb.Friendship, *now)
	if err != nil || p.WordsSolved != 1 {
		t.Fatalf("other seat: %+v %v", p, err)
	}
	_, err = ps.FriendProfile(ctx, testdb.C, testdb.Friendship, *now)
	if !errors.Is(err, players.ErrNotFound) {
		t.Fatal("outsider stats", err)
	}
	// A second friend's solve belongs in the personal total, never this pair's.
	req, err := s.PlayInvite(ctx, testdb.B, "", "create", PlayInviteMutation{RequestID: testdb.ID(), InviteCode: "OUTCDE", Timezone: "UTC"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = ps.FriendProfile(ctx, testdb.B, req.FriendshipID, *now)
	if !errors.Is(err, players.ErrNotFound) {
		t.Fatal("pending stats exposed", err)
	}
	accepted, err := s.PlayInvite(ctx, testdb.C, req.FriendshipID, "accept", PlayInviteMutation{RequestID: testdb.ID()})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.db.Exec(ctx, `update duo_days set state='won',answer='stone' where duo_id=$1`, accepted.Duo.ID)
	if err != nil {
		t.Fatal(err)
	}
	p, err = ps.FriendProfile(ctx, testdb.A, testdb.Friendship, *now)
	if err != nil || p.WordsSolved != 3 {
		t.Fatal("all friends total", p, err)
	}
	// Ending and restarting preserve history; newer duo owns a repeated date.
	_, err = s.Mutate(ctx, testdb.A, d.ID, "", "end", Mutation{RequestID: testdb.ID(), Version: d.Version})
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.PlayInvite(ctx, testdb.A, "", "create", PlayInviteMutation{RequestID: testdb.ID(), InviteCode: "ANACDE", Timezone: "Asia/Kolkata"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.PlayInvite(ctx, testdb.B, "", "create", PlayInviteMutation{RequestID: testdb.ID(), InviteCode: "ADICDE", Timezone: "UTC"})
	if err != nil {
		t.Fatal(err)
	}
	stats, err = s.PairStats(ctx, []string{testdb.Friendship, req.FriendshipID})
	if err != nil {
		t.Fatal(err)
	}
	if stats[testdb.Friendship].Current != 1 || stats[testdb.Friendship].Longest != 3 || stats[testdb.Friendship].WordsSolved != 5 {
		t.Fatal("restart stats", stats)
	}
	detail, err := s.ForFriendship(ctx, testdb.Friendship, testdb.A)
	if err != nil || detail.ID != r.Duo.ID || len(detail.Recent) != 6 {
		t.Fatal("restart history", err)
	}
	*now = now.Add(24 * time.Hour)
	stats, err = s.PairStats(ctx, []string{testdb.Friendship})
	if err != nil || stats[testdb.Friendship].Current != 0 {
		t.Fatal("missed day", stats, err)
	}
}
func TestLongestPairStreak(t *testing.T) {
	if n := longestPairStreak(map[string]string{"2026-03-07": "won", "2026-03-08": "won", "2026-03-09": "won", "2026-03-10": "lost", "2026-03-11": "won"}); n != 3 {
		t.Fatal(n)
	}
}
