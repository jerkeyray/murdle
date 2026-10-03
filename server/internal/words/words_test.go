package words

import (
	"testing"

	"github.com/jerkeyray/wordle/server/internal/game"
)

func TestPoolLoads(t *testing.T) {
	p := NewPool()
	answers, dict := p.Size()
	if answers < 100 {
		t.Errorf("loaded %d answers, expected the curated list to be substantial", answers)
	}
	if dict < 5000 {
		t.Errorf("loaded %d dictionary words, expected the full list", dict)
	}
}

// Every word a pack can deal has to be the right length and guessable, or a
// round could hand a player a word the keyboard refuses to accept.
func TestEveryAnswerIsPlayable(t *testing.T) {
	p := NewPool()
	for _, pack := range p.Packs() {
		for _, w := range pack.Words {
			if len(w.Word) != game.WordLength {
				t.Errorf("answer %q has length %d, want %d", w.Word, len(w.Word), game.WordLength)
			}
			if !p.IsWord(w.Word) {
				t.Errorf("answer %q is not in the dictionary", w.Word)
			}
		}
	}
}

func TestIsWord(t *testing.T) {
	p := NewPool()
	if !p.IsWord("SALVE") {
		t.Error("uppercase real word should validate")
	}
	if !p.IsWord(" salve ") {
		t.Error("padded real word should validate")
	}
	if p.IsWord("zzzzz") {
		t.Error("nonsense should not validate")
	}
}

func TestPackExclusionsAcceptIDsAndLegacyTitles(t *testing.T) {
	p := NewPool()
	for _, useTitles := range []bool{false, true} {
		exclude := map[string]struct{}{}
		for _, pack := range p.packs[1:] {
			key := pack.ID
			if useTitles {
				key = pack.Title
				if len(pack.LegacyTitles) > 0 {
					key = pack.LegacyTitles[0]
				}
			}
			exclude[key] = struct{}{}
		}
		for i := 0; i < 20; i++ {
			got, ok := p.RandomPack(exclude)
			if !ok || got.ID != p.packs[0].ID {
				t.Fatalf("unexpected repeat: %s", got.ID)
			}
		}
		if p.Exhausted(exclude) {
			t.Fatal("pool not yet exhausted")
		}
		exclude[p.packs[0].ID] = struct{}{}
		if !p.Exhausted(exclude) {
			t.Fatal("pool should be exhausted")
		}
		if _, ok := p.RandomPack(exclude); !ok {
			t.Fatal("cannot begin new cycle")
		}
	}
}
