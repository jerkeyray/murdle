package words

import "testing"

func good() Answer {
	return Answer{
		Word: "ember", Register: RegisterStandard, Difficulty: "familiar",
		Definition: "A small piece of burning wood or coal.",
		Note:       "From Old English aemerge.",
		Hints:      []string{"Left glowing after a fire.", "Still warm, no longer flaming."},
	}
}

// The validator is the gate every generated entry has to pass, so each rule is
// checked on its own: one broken field must be enough to stop the build.
func TestValidateClassic(t *testing.T) {
	if err := validateClassic([]Answer{good()}); err != nil {
		t.Fatalf("a good entry was rejected: %v", err)
	}
	broken := map[string]func(*Answer){
		"uppercase":          func(w *Answer) { w.Word = "Ember" },
		"four letters":       func(w *Answer) { w.Word = "embe" },
		"seven letters":      func(w *Answer) { w.Word = "embered" },
		"no definition":      func(w *Answer) { w.Definition = " " },
		"no note":            func(w *Answer) { w.Note = "" },
		"bad register":       func(w *Answer) { w.Register = "posh" },
		"bad difficulty":     func(w *Answer) { w.Difficulty = "easy" },
		"one hint":           func(w *Answer) { w.Hints = w.Hints[:1] },
		"repeated hint":      func(w *Answer) { w.Hints[1] = w.Hints[0] },
		"short hint":         func(w *Answer) { w.Hints[0] = "Warm." },
		"hint gives it up":   func(w *Answer) { w.Hints[0] = "An EMBER from a dying fire." },
		"hint shares root":   func(w *Answer) { w.Hints[0] = "Glowing like the embers of a fire." },
		"hint is definition": func(w *Answer) { w.Hints[1] = "A small piece of burning wood." },
	}
	for name, breakIt := range broken {
		w := good()
		w.Hints = append([]string(nil), w.Hints...)
		breakIt(&w)
		if err := validateClassic([]Answer{w}); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if err := validateClassic([]Answer{good(), good()}); err == nil {
		t.Error("a duplicated word was accepted")
	}
}

// The embedded bank must load, and a Classic-only word must behave exactly like
// a pack word everywhere the API looks one up.
func TestClassicBankIsPlayable(t *testing.T) {
	p := NewPool()
	if len(p.bank) == 0 {
		t.Skip("classic bank is empty")
	}
	w := p.bank[0]
	if !p.IsWord(w.Word) {
		t.Errorf("%q cannot be guessed", w.Word)
	}
	if info, ok := p.WordInfo(w.Word); !ok || info.Definition == "" {
		t.Errorf("%q has no entry", w.Word)
	}
	if id, ok := p.PackIDFor(w.Word); !ok || id != ClassicPackID {
		t.Errorf("%q recorded under pack %q", w.Word, id)
	}
	found := false
	for _, a := range p.answersFor(len(w.Word), "mixed") {
		found = found || a.Word == w.Word
	}
	if !found {
		t.Errorf("%q is never dealt", w.Word)
	}
}

func TestValidateUniqueHints(t *testing.T) {
	a, b := good(), good()
	b.Word = "cinder"
	if err := validateUniqueHints([]Answer{a, b}); err == nil {
		t.Error("a hint shared by two answers was accepted")
	}
	b.Hints = []string{"Grey and cold in the grate.", "What a fire leaves once it is out."}
	if err := validateUniqueHints([]Answer{a, b}); err != nil {
		t.Errorf("distinct hints were rejected: %v", err)
	}
}

// A retired answer keeps its entry for old solves but is never dealt.
func TestRetiredAnswersAreNotDealt(t *testing.T) {
	p := NewPool()
	if info, ok := p.WordInfo("doing"); !ok || !info.Retired {
		t.Fatal("doing should be a retired entry")
	}
	for _, w := range p.answersFor(5, "mixed") {
		if w.Retired {
			t.Fatalf("retired %q can be dealt", w.Word)
		}
	}
	if !p.IsWord("doing") {
		t.Error("a retired answer must stay guessable")
	}
}
