package words

import "testing"

func good() PackWord {
	return PackWord{
		Word: "ember", Register: RegisterStandard, Difficulty: "familiar",
		Definition: "A small piece of burning wood or coal.",
		Note:       "From Old English aemerge.",
		Hints:      []string{"Left glowing after a fire.", "Still warm, no longer flaming."},
	}
}

// The validator is the gate every generated entry has to pass, so each rule is
// checked on its own: one broken field must be enough to stop the build.
func TestValidateClassic(t *testing.T) {
	if err := validateClassic([]PackWord{good()}); err != nil {
		t.Fatalf("a good entry was rejected: %v", err)
	}
	broken := map[string]func(*PackWord){
		"uppercase":        func(w *PackWord) { w.Word = "Ember" },
		"four letters":     func(w *PackWord) { w.Word = "embe" },
		"seven letters":    func(w *PackWord) { w.Word = "embered" },
		"no definition":    func(w *PackWord) { w.Definition = " " },
		"no note":          func(w *PackWord) { w.Note = "" },
		"bad register":     func(w *PackWord) { w.Register = "posh" },
		"bad difficulty":   func(w *PackWord) { w.Difficulty = "easy" },
		"one hint":         func(w *PackWord) { w.Hints = w.Hints[:1] },
		"repeated hint":    func(w *PackWord) { w.Hints[1] = w.Hints[0] },
		"short hint":       func(w *PackWord) { w.Hints[0] = "Warm." },
		"hint gives it up": func(w *PackWord) { w.Hints[0] = "An EMBER from a dying fire." },
	}
	for name, breakIt := range broken {
		w := good()
		w.Hints = append([]string(nil), w.Hints...)
		breakIt(&w)
		if err := validateClassic([]PackWord{w}); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if err := validateClassic([]PackWord{good(), good()}); err == nil {
		t.Error("a duplicated word was accepted")
	}
}

// The embedded bank must load, and a Classic-only word must behave exactly like
// a pack word everywhere the API looks one up.
func TestClassicBankIsPlayable(t *testing.T) {
	p := NewPool()
	if len(p.classic) == 0 {
		t.Skip("classic bank is empty")
	}
	w := p.classic[0]
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
