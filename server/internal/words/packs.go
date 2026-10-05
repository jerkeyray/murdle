package words

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"regexp"
	"strings"
)

//go:embed packs.json
var packsRaw []byte

// Register distinguishes established vocabulary from informal usages.
type Register string

const (
	RegisterStandard Register = "standard"
	RegisterSlang    Register = "slang"
)

// PackWord is one answer and everything the entry needs to teach it.
type PackWord struct {
	Word       string   `json:"word"`
	Register   Register `json:"register"`
	Definition string   `json:"definition"`
	// Note is the part worth reading — where the word came from, or what it
	// used to mean. It is what makes the round end in something other than
	// "you got it".
	Note       string   `json:"note"`
	Hints      []string `json:"hints"`
	Difficulty string   `json:"difficulty"`
	Connection string   `json:"connection"`
}

// Pack is a themed run: several words that secretly belong together.
//
// The theme is withheld until the run ends, so the player is guessing at
// the connection as well as the word. Title and Blurb are the payoff.
type Pack struct {
	ID                   string     `json:"id"`
	ConnectionDifficulty string     `json:"connectionDifficulty"`
	LegacyTitles         []string   `json:"legacyTitles,omitempty"`
	Title                string     `json:"title"`
	Blurb                string     `json:"blurb"`
	Words                []PackWord `json:"words"`
}

func (p Pack) WordLength() int {
	if len(p.Words) == 0 {
		return 0
	}
	return len([]rune(p.Words[0].Word))
}

// WordList returns just the words, in pack order.
func (p Pack) WordList() []string {
	out := make([]string, len(p.Words))
	for i, w := range p.Words {
		out[i] = w.Word
	}
	return out
}

func loadPacks() ([]Pack, error) {
	var packs []Pack
	if err := json.Unmarshal(packsRaw, &packs); err != nil {
		return nil, fmt.Errorf("parsing packs.json: %w", err)
	}
	packs = append(packs, sixPacks()...)
	if err := validatePacks(packs); err != nil {
		return nil, err
	}
	return packs, nil
}

// Packs returns every pack, in file order.
func (p *Pool) Packs() []Pack { return p.packs }

// Pack looks up a pack by id.
func (p *Pool) Pack(id string) (Pack, bool) {
	pack, ok := p.packByID[id]
	return pack, ok
}

// WordInfo returns the entry for an answer, if it belongs to a pack.
func (p *Pool) WordInfo(word string) (PackWord, bool) {
	w, ok := p.wordInfo[word]
	return w, ok
}

// PackIDFor returns the pack an answer belongs to.
func (p *Pool) PackIDFor(word string) (string, bool) {
	id, ok := p.wordPack[word]
	return id, ok
}

// RandomPack picks a pack, avoiding any id in exclude.
//
// Falls back to an unfiltered pick once every pack has been played, rather
// than failing — running out of fresh themes should mean repeats, not an
// error in the middle of a game.
func (p *Pool) RandomPack(exclude map[string]struct{}) (Pack, bool) {
	return p.RandomPackForLength(exclude, 5)
}

func (p *Pool) RandomPackForLength(exclude map[string]struct{}, length int) (Pack, bool) {
	pool := make([]Pack, 0, len(p.packs))
	for _, pack := range p.packs {
		if pack.WordLength() == length {
			pool = append(pool, pack)
		}
	}
	if len(pool) == 0 {
		return Pack{}, false
	}
	eligible := pool
	if len(exclude) > 0 {
		eligible = make([]Pack, 0, len(pool))
		for _, pack := range pool {
			if !packExcluded(pack, exclude) {
				eligible = append(eligible, pack)
			}
		}
		if len(eligible) == 0 {
			eligible = pool
		}
	}
	return eligible[rand.IntN(len(eligible))], true
}

func (p *Pool) RandomWord(length int) (PackWord, bool) {
	return p.RandomWordForDifficulty(length, "mixed")
}

// RandomWordForDifficulty picks answers separately from the broad guess
// dictionary. Learning leaves everyday answers out, giving a player a word
// worth meeting without making their valid guesses any narrower.
func (p *Pool) RandomWordForDifficulty(length int, difficulty string) (PackWord, bool) {
	word, _, ok := p.FreshWord(length, difficulty, nil)
	return word, ok
}

// FreshWord picks an answer the player has not had yet.
//
// exclude holds every word they have already played. Once the whole pool is
// spent it starts over from all of it and reports a new cycle, the same way
// themed packs do, rather than refusing to deal a game. Until then a Classic
// game never repeats; before this, each game was an independent draw and a
// repeat turned up within about fifteen games.
func (p *Pool) FreshWord(length int, difficulty string, exclude map[string]struct{}) (word PackWord, newCycle, ok bool) {
	all := p.answersFor(length, difficulty)
	if len(all) == 0 {
		return PackWord{}, false, false
	}
	fresh := make([]PackWord, 0, len(all))
	for _, w := range all {
		if _, seen := exclude[w.Word]; !seen {
			fresh = append(fresh, w)
		}
	}
	if len(fresh) == 0 {
		return all[rand.IntN(len(all))], true, true
	}
	return fresh[rand.IntN(len(fresh))], false, true
}

// answersFor is every word a Classic game of this shape may deal: every pack
// word plus the Classic bank. Learning leaves everyday answers out without
// narrowing what a player may guess.
func (p *Pool) answersFor(length int, difficulty string) []PackWord {
	fits := func(w PackWord) bool {
		return len([]rune(w.Word)) == length && (difficulty != "learning" || w.Difficulty != "familiar")
	}
	all := []PackWord{}
	for _, pack := range p.packs {
		for _, word := range pack.Words {
			if fits(word) {
				all = append(all, word)
			}
		}
	}
	for _, word := range p.classic {
		if fits(word) {
			all = append(all, word)
		}
	}
	return all
}

/*
func (p *Pool) RandomPackLegacy(exclude map[string]struct{}) (Pack, bool) {
	if len(p.packs) == 0 {
		return Pack{}, false
	}

	eligible := p.packs
	if len(exclude) > 0 {
		eligible = make([]Pack, 0, len(p.packs))
		for _, pack := range p.packs {
			if !packExcluded(pack, exclude) {
				eligible = append(eligible, pack)
			}
		}
		if len(eligible) == 0 {
			eligible = p.packs
		}
	}

	return eligible[rand.IntN(len(eligible))], true
}
*/

func packExcluded(pack Pack, exclude map[string]struct{}) bool {
	if _, ok := exclude[pack.ID]; ok {
		return true
	}
	if _, ok := exclude[pack.Title]; ok {
		return true
	}
	for _, title := range pack.LegacyTitles {
		if _, ok := exclude[title]; ok {
			return true
		}
	}
	return false
}

func (p *Pool) Exhausted(exclude map[string]struct{}) bool {
	return p.ExhaustedForLength(exclude, 5)
}

func (p *Pool) ExhaustedForLength(exclude map[string]struct{}, length int) bool {
	any := false
	for _, pack := range p.packs {
		if pack.WordLength() != length {
			continue
		}
		any = true
		if !packExcluded(pack, exclude) {
			return false
		}
	}
	return any
}

// Embedded content must be structurally complete before the server can start.
// This cannot substitute for human review of meaning and factual accuracy.
func validatePacks(packs []Pack) error {
	ids, words := map[string]bool{}, map[string]bool{}
	wordPattern := regexp.MustCompile(`^[a-z]{5,6}$`)
	structuralHint := regexp.MustCompile(`(?i)\b(first|last|second|third|fourth|fifth|sixth) letter\b|\b(starts?|ends?) with (the )?(letter|vowel|consonant)\b`)
	placeholderCopy := []string{
		"a common english word in this set",
		"first expanded wordle bank",
		"think about an everyday setting or idea",
		"its use becomes clearer in a familiar context",
		"it belongs to the set’s shared idea",
	}
	for _, pack := range packs {
		if ids[pack.ID] || pack.ID == "" || len(pack.Words) != 5 || strings.TrimSpace(pack.Title) == "" || strings.TrimSpace(pack.Blurb) == "" {
			return fmt.Errorf("invalid pack %s", pack.ID)
		}
		ids[pack.ID] = true
		length := pack.WordLength()
		if length != 5 && length != 6 {
			return fmt.Errorf("invalid word length: %s", pack.ID)
		}
		if pack.ConnectionDifficulty != "easy" && pack.ConnectionDifficulty != "medium" && pack.ConnectionDifficulty != "hard" {
			return fmt.Errorf("missing connection difficulty: %s", pack.ID)
		}
		for _, w := range pack.Words {
			if !wordPattern.MatchString(w.Word) || len(w.Word) != length || words[w.Word] || len(w.Hints) != 2 || strings.TrimSpace(w.Connection) == "" || strings.TrimSpace(w.Definition) == "" || strings.TrimSpace(w.Note) == "" {
				return fmt.Errorf("incomplete word: %s", w.Word)
			}
			words[w.Word] = true
			if w.Difficulty != "familiar" && w.Difficulty != "stretch" && w.Difficulty != "challenging" {
				return fmt.Errorf("missing word difficulty: %s", w.Word)
			}
			for _, hint := range w.Hints {
				if len(strings.TrimSpace(hint)) < 12 || strings.Contains(strings.ToLower(hint), w.Word) || structuralHint.MatchString(hint) {
					return fmt.Errorf("invalid hint for %s: %q", w.Word, hint)
				}
			}
			content := strings.ToLower(strings.Join(append(append([]string{}, w.Hints...), w.Definition, w.Note, w.Connection), " "))
			for _, placeholder := range placeholderCopy {
				if strings.Contains(content, placeholder) {
					return fmt.Errorf("placeholder editorial copy: %s", w.Word)
				}
			}
			if w.Hints[0] == w.Hints[1] {
				return fmt.Errorf("repeated hint: %s", w.Word)
			}
		}
	}
	if len(packs) == 0 {
		return fmt.Errorf("empty pack pool")
	}
	return nil
}
