package words

import "testing"

func TestPoolLoads(t *testing.T) {
	p := NewPool()
	answers, dict := p.Size()
	if answers < 4000 {
		t.Errorf("loaded %d answers, expected the full bank", answers)
	}
	if dict < 5000 {
		t.Errorf("loaded %d dictionary words, expected the full list", dict)
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
	if !p.IsWord("rapes") || !p.IsWord("rapist") {
		t.Error("common uncensored words should validate")
	}
}

func TestLearningVocabularySkipsFamiliarAnswers(t *testing.T) {
	p := NewPool()
	for _, length := range []int{5, 6} {
		for range 20 {
			word, ok := p.RandomWordForDifficulty(length, "learning")
			if !ok {
				t.Fatalf("learning pool has no %d-letter answers", length)
			}
			if word.Difficulty == "familiar" {
				t.Fatalf("learning pool returned familiar answer %q", word.Word)
			}
		}
	}
}

// Classic must deal every word in the pool once before any word comes round
// again, and only then report a new cycle.
func TestFreshWordNeverRepeatsUntilThePoolIsSpent(t *testing.T) {
	p := NewPool()
	pool := p.answersFor(5, "mixed")
	seen := map[string]struct{}{}
	for i := range pool {
		w, cycled, ok := p.FreshWord(5, "mixed", seen)
		if !ok {
			t.Fatal("no word dealt")
		}
		if cycled {
			t.Fatalf("reported a new cycle after only %d of %d words", i, len(pool))
		}
		if _, dup := seen[w.Word]; dup {
			t.Fatalf("repeated %q after %d words", w.Word, i)
		}
		seen[w.Word] = struct{}{}
	}
	if _, cycled, _ := p.FreshWord(5, "mixed", seen); !cycled {
		t.Fatal("a spent pool should start a new cycle")
	}
}

// Mixed games should follow the target mix rather than the bank's own
// proportions, which lean heavily towards familiar words.
func TestMixedDealsFollowTheDifficultyMix(t *testing.T) {
	p := NewPool()
	const draws = 10000
	counts := map[string]int{}
	for range draws {
		w, _, ok := p.FreshWord(5, "mixed", nil)
		if !ok {
			t.Fatal("no word dealt")
		}
		counts[w.Difficulty]++
	}
	for _, target := range difficultyMix["mixed"] {
		got := float64(counts[target.tier]) / draws * 100
		if diff := got - float64(target.weight); diff > 3 || diff < -3 {
			t.Errorf("%s dealt %.1f%% of the time, want about %d%%", target.tier, got, target.weight)
		}
	}
}

func TestPickByDifficultySkipsEmptyTiers(t *testing.T) {
	only := []Answer{{Word: "ember", Difficulty: "familiar"}}
	for range 50 {
		if got := pickByDifficulty(only, "mixed"); got.Word != "ember" {
			t.Fatalf("picked %q from a single-word pool", got.Word)
		}
	}
}

func TestDuoCandidatesAreNeverEveryday(t *testing.T) {
	p := NewPool()
	got := p.DuoCandidates(5)
	for _, w := range got {
		if len(w.Word) != 5 {
			t.Fatalf("duo candidate %q is not five letters", w.Word)
		}
		if w.Retired {
			t.Fatalf("retired %q offered to duos", w.Word)
		}
		if w.Difficulty == "familiar" {
			t.Fatalf("familiar word %q offered to duos", w.Word)
		}
	}
	if len(got) < 800 {
		t.Errorf("duo pool has only %d words", len(got))
	}
}

// Both lengths must be dealable at every difficulty, or a setting could leave a
// player with no game.
func TestEveryLengthAndDifficultyIsPlayable(t *testing.T) {
	p := NewPool()
	for _, length := range []int{5, 6} {
		for _, difficulty := range []string{"mixed", "learning", "hard"} {
			if _, _, ok := p.FreshWord(length, difficulty, nil); !ok {
				t.Errorf("no %d-letter %s word", length, difficulty)
			}
		}
	}
}

// A guessed word and an answer are separate lists, but an answer must always be
// guessable, and every answer must be exactly five or six letters.
func TestEveryAnswerIsGuessable(t *testing.T) {
	p := NewPool()
	for _, w := range p.bank {
		if !p.IsWord(w.Word) {
			t.Errorf("answer %q cannot be guessed", w.Word)
		}
	}
}

// Hard deals no everyday word and leans towards the words most adults could not
// define; an unknown setting is not a setting at all.
func TestHardLeansTowardsChallengingWords(t *testing.T) {
	p := NewPool()
	const draws = 5000
	challenging := 0
	for range draws {
		w, _, ok := p.FreshWord(5, "hard", nil)
		if !ok {
			t.Fatal("no hard word dealt")
		}
		if w.Difficulty == "familiar" {
			t.Fatalf("hard dealt a familiar word %q", w.Word)
		}
		if w.Difficulty == "challenging" {
			challenging++
		}
	}
	if share := float64(challenging) / draws * 100; share < 65 || share > 75 {
		t.Errorf("hard dealt challenging words %.1f%% of the time, want about 70%%", share)
	}
	if !ValidDifficulty("hard") || ValidDifficulty("brutal") {
		t.Error("ValidDifficulty disagrees with the settings on offer")
	}
}
