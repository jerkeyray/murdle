package words

import (
	"testing"

	"github.com/jerkeyray/murdle/server/internal/game"
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

// Every curated answer has to be the right length and guessable, or a round
// could hand a player a word the keyboard refuses to accept.
func TestEveryAnswerIsPlayable(t *testing.T) {
	p := NewPool()
	for _, w := range p.answers {
		if len(w) != game.WordLength {
			t.Errorf("answer %q has length %d, want %d", w, len(w), game.WordLength)
		}
		if !p.IsWord(w) {
			t.Errorf("answer %q is not in the dictionary", w)
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

func TestRandomRespectsExclusions(t *testing.T) {
	p := NewPool()

	// Exclude everything but one word and we must get that word back.
	only := p.answers[7]
	exclude := make(map[string]struct{}, len(p.answers))
	for _, w := range p.answers {
		if w != only {
			exclude[w] = struct{}{}
		}
	}
	for i := 0; i < 20; i++ {
		if got := p.Random(exclude); got != only {
			t.Fatalf("Random() = %q, want the single eligible word %q", got, only)
		}
	}
}

func TestRandomFallsBackWhenAllExcluded(t *testing.T) {
	p := NewPool()
	exclude := make(map[string]struct{}, len(p.answers))
	for _, w := range p.answers {
		exclude[w] = struct{}{}
	}
	if got := p.Random(exclude); got == "" {
		t.Error("exhausting the pool should fall back to any answer, not return empty")
	}
}
