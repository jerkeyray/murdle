package players

import (
	"context"
	"testing"
	"time"

	"github.com/jerkeyray/wordle/server/internal/testdb"
)

// A pack is only finished once every one of its words is recorded, so the
// counts have to be per pack and must not double-count a word played twice.
func TestPostgresPackWordCounts(t *testing.T) {
	store := New(testdb.Open(t))
	ctx := context.Background()
	day := time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC)

	record := func(word, pack string) {
		t.Helper()
		if err := store.RecordSolve(ctx, testdb.A, Solve{
			Word: word, PackID: pack, Solved: true, Guesses: 3, Points: 4, PlayedOn: day,
		}); err != nil {
			t.Fatal(err)
		}
	}

	for _, w := range []string{"voice", "clout", "edict"} {
		record(w, "terminally-online")
	}
	record("amour", "soft-landing")
	// The same word again must not inflate its pack: solves is unique on
	// (player, word), so this is an upsert rather than a second row.
	record("voice", "terminally-online")

	counts, err := store.PackWordCounts(ctx, testdb.A)
	if err != nil {
		t.Fatal(err)
	}
	if counts["terminally-online"] != 3 {
		t.Fatalf("replayed word changed the count: %d", counts["terminally-online"])
	}
	if counts["soft-landing"] != 1 {
		t.Fatalf("second pack: %d", counts["soft-landing"])
	}
	if _, ok := counts["never-played"]; ok {
		t.Fatal("reported a pack with no solves")
	}

	// Another player's history is their own.
	other, err := store.PackWordCounts(ctx, testdb.B)
	if err != nil {
		t.Fatal(err)
	}
	if len(other) != 0 {
		t.Fatalf("leaked another player's packs: %v", other)
	}
}

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
