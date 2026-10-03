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
