package players

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/jerkeyray/wordle/server/internal/testdb"
)

func TestReplayKeepsEveryActivityDayAndBestWordResult(t *testing.T) {
	store := New(testdb.Open(t))
	ctx := context.Background()
	first := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	second := first.AddDate(0, 0, 1)
	row := 2
	if err := store.RecordSolve(ctx, testdb.A, Solve{Word: "voice", PackID: "theme", Solved: true, SolvedRow: &row, Guesses: 3, HintsUsed: 2, Points: 4, PlayedOn: first}); err != nil {
		t.Fatal(err)
	}
	betterRow := 1
	if err := store.RecordSolve(ctx, testdb.A, Solve{Word: "voice", PackID: "theme", Solved: true, SolvedRow: &betterRow, Guesses: 2, HintsUsed: 1, Points: 5, PlayedOn: second}); err != nil {
		t.Fatal(err)
	}
	bestRow := 0
	if err := store.RecordSolve(ctx, testdb.A, Solve{Word: "voice", PackID: "theme", Solved: true, SolvedRow: &bestRow, Guesses: 1, HintsUsed: 0, Points: 5, PlayedOn: second}); err != nil {
		t.Fatal(err)
	}
	third := second.AddDate(0, 0, 1)
	if err := store.RecordSolve(ctx, testdb.A, Solve{Word: "voice", PackID: "theme", Solved: false, Guesses: 6, Points: 0, PlayedOn: third}); err != nil {
		t.Fatal(err)
	}
	collection, err := store.Solves(ctx, testdb.A, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(collection) != 1 || !collection[0].Solved || collection[0].Points != 5 || collection[0].SolvedRow == nil || *collection[0].SolvedRow != bestRow || collection[0].HintsUsed != 0 || !collection[0].PlayedOn.Equal(third) {
		t.Fatalf("best result/latest date = %+v", collection)
	}
	streak, err := store.Streak(ctx, testdb.A, second)
	if err != nil {
		t.Fatal(err)
	}
	if streak.Current != 2 || streak.Longest != 2 || !streak.PlayedToday {
		t.Fatalf("activity days lost on replay: %+v", streak)
	}
	page, total, err := store.SolvePage(ctx, testdb.A, 1, 0, 5, []string{"voice"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(page) != 1 || page[0].Word != "voice" {
		t.Fatalf("filtered page = %+v, total %d", page, total)
	}
	if err := store.SaveWord(ctx, testdb.A, "voice"); err != nil {
		t.Fatal(err)
	}
	saved, number, err := store.SavedWordPage(ctx, testdb.A, 24, 0, 5, []string{"voice"})
	if err != nil {
		t.Fatal(err)
	}
	if number != 1 || len(saved) != 1 || saved[0] != "voice" {
		t.Fatalf("saved page = %v, total %d", saved, number)
	}
}

func TestPostgresCurrentStreaksMatchesProfiles(t *testing.T) {
	store := New(testdb.Open(t))
	ctx := context.Background()
	today := time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC)
	for _, entry := range []struct {
		id     string
		offset int
	}{{testdb.A, 0}, {testdb.A, -1}, {testdb.A, -2}, {testdb.A, -4}, {testdb.A, 1}, {testdb.B, -1}, {testdb.B, -2}} {
		if _, err := store.pool.Exec(ctx, `insert into player_activity_days(player_id,played_on) values($1,$2)`, entry.id, today.AddDate(0, 0, entry.offset)); err != nil {
			t.Fatal(err)
		}
	}
	currents, err := store.CurrentStreaks(ctx, []string{testdb.A, testdb.B, testdb.C}, today)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{testdb.A, testdb.B, testdb.C} {
		profile, err := store.Streak(ctx, id, today)
		if err != nil || currents[id] != profile.Current {
			t.Fatalf("%s summary %d profile %+v err %v", id, currents[id], profile, err)
		}
	}
	if currents[testdb.A] != 3 || currents[testdb.B] != 2 || currents[testdb.C] != 0 {
		t.Fatal(currents)
	}
}

// A word revealed on a finished duo board counts as played for both members,
// so Classic does not deal it again; a board still in play does not.
func TestPostgresPlayedWordsIncludesFinishedDuoBoards(t *testing.T) {
	store := New(testdb.Open(t))
	ctx := context.Background()
	day := time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC)
	if err := store.RecordSolve(ctx, testdb.A, Solve{Word: "voice", PackID: "theme", Solved: true, Guesses: 3, Points: 4, PlayedOn: day}); err != nil {
		t.Fatal(err)
	}
	duo := testdb.ID()
	if _, err := store.pool.Exec(ctx, `insert into duos(id,friendship_id,inviter_id,low_id,high_id,timezone,status,started_on) values($1,$2,$3,least($3::uuid,$4::uuid),greatest($3::uuid,$4::uuid),'UTC','active',$5)`, duo, testdb.Friendship, testdb.A, testdb.B, day); err != nil {
		t.Fatal(err)
	}
	for i, board := range []struct{ answer, state string }{{"clout", "won"}, {"edict", "playing"}} {
		if _, err := store.pool.Exec(ctx, `insert into duo_days(duo_id,day,seq,deadline,answer,entry,cycle,state,current_player) values($1,$2,$3,$2::date+interval '1 day',$4,'{}',0,$5,$6)`, duo, day, i, board.answer, board.state, testdb.A); err != nil {
			t.Fatal(err)
		}
	}
	for id, want := range map[string][]string{testdb.A: {"clout", "voice"}, testdb.B: {"clout"}, testdb.C: nil} {
		got, err := store.PlayedWords(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		slices.Sort(got)
		if !slices.Equal(got, want) {
			t.Errorf("%s played %v, want %v", id, got, want)
		}
	}
}
