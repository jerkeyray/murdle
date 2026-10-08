package words

import (
	"math/rand/v2"
	"sort"
	"strings"
)

// Register distinguishes established vocabulary from informal usages.
type Register string

const (
	RegisterStandard Register = "standard"
	RegisterSlang    Register = "slang"
)

// Answer is one answer in the bank, with everything its entry needs to teach it.
type Answer struct {
	Word       string   `json:"word"`
	Register   Register `json:"register"`
	Definition string   `json:"definition"`
	// Note is the part worth reading — where the word came from, or what it
	// used to mean. It is what makes the round end in something other than
	// "you got it".
	Note string `json:"note"`
	// The fields below come from Wiktionary, WordNet and Tatoeba (see
	// web/scripts/enrich-entries.mjs) and are optional: a word without them
	// renders exactly as before.
	// Pronunciation is IPA without slashes, PartOfSpeech is a lowercase label,
	// Origin is a one-line source chain such as "Anglo-Norman abatre, from
	// Latin battere", and Example is one sentence that uses the word.
	Pronunciation string `json:"pronunciation,omitempty"`
	PartOfSpeech  string `json:"partOfSpeech,omitempty"`
	Origin        string `json:"origin,omitempty"`
	Example       string `json:"example,omitempty"`
	// ExampleSource links the sentence an example was taken from, when its
	// licence asks for attribution (Tatoeba, CC BY).
	ExampleSource string   `json:"exampleSource,omitempty"`
	Hints         []string `json:"hints"`
	Difficulty    string   `json:"difficulty"`
	// Retired answers are never dealt again, but keep their entry so a
	// player's earlier solves still open to a full card. Used for inflections
	// and function words that make a dull answer but remain fair guesses.
	Retired bool `json:"retired,omitempty"`
}

// WordInfo returns the entry for an answer, if it is in the bank.
func (p *Pool) WordInfo(word string) (Answer, bool) {
	w, ok := p.wordInfo[word]
	return w, ok
}

// WordsMatching searches the embedded teaching text, including the answer itself.
func (p *Pool) WordsMatching(query string, length int) []string {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return nil
	}
	var found []string
	for word, info := range p.wordInfo {
		if length != 0 && len([]rune(word)) != length {
			continue
		}
		if strings.Contains(strings.ToLower(word+" "+info.Definition+" "+info.Note), query) {
			found = append(found, word)
		}
	}
	sort.Strings(found)
	return found
}

// PackIDFor labels an answer for the profile. Solves once recorded the themed
// pack a word came from; every word is Classic now, and old rows keep whatever
// they stored.
func (p *Pool) PackIDFor(word string) (string, bool) {
	_, ok := p.wordInfo[word]
	return ClassicPackID, ok
}

func (p *Pool) RandomWord(length int) (Answer, bool) {
	return p.RandomWordForDifficulty(length, "mixed")
}

// RandomWordForDifficulty picks answers separately from the broad guess
// dictionary. Learning leaves everyday answers out, giving a player a word
// worth meeting without making their valid guesses any narrower.
func (p *Pool) RandomWordForDifficulty(length int, difficulty string) (Answer, bool) {
	word, _, ok := p.FreshWord(length, difficulty, nil)
	return word, ok
}

// FreshWord picks an answer the player has not had yet.
//
// exclude holds every word they have already played. Once the whole pool is
// spent it starts over from all of it and reports a new cycle, rather than
// refusing to deal a game. Until then a game never repeats a word.
func (p *Pool) FreshWord(length int, difficulty string, exclude map[string]struct{}) (word Answer, newCycle, ok bool) {
	all := p.answersFor(length, difficulty)
	if len(all) == 0 {
		return Answer{}, false, false
	}
	fresh := make([]Answer, 0, len(all))
	for _, w := range all {
		if _, seen := exclude[w.Word]; !seen {
			fresh = append(fresh, w)
		}
	}
	if len(fresh) == 0 {
		return pickByDifficulty(all, difficulty), true, true
	}
	return pickByDifficulty(fresh, difficulty), false, true
}

// difficultyMix is the share of games each tier should get. The bank is about
// two-thirds everyday words, so a uniform draw made "mixed" mostly easy; picking
// the tier first keeps a steady supply of words worth learning.
var difficultyMix = map[string][]struct {
	tier   string
	weight int
}{
	"mixed":    {{"familiar", 40}, {"stretch", 40}, {"challenging", 20}},
	"learning": {{"stretch", 60}, {"challenging", 40}},
}

// pickByDifficulty draws a tier by weight, then a word within it. Tiers with
// nothing left drop out and the rest share their weight, so a spent tier never
// stops a game being dealt.
func pickByDifficulty(words []Answer, difficulty string) Answer {
	byTier := map[string][]Answer{}
	for _, w := range words {
		byTier[w.Difficulty] = append(byTier[w.Difficulty], w)
	}
	total := 0
	for _, t := range difficultyMix[difficulty] {
		if len(byTier[t.tier]) > 0 {
			total += t.weight
		}
	}
	if total == 0 {
		return words[rand.IntN(len(words))]
	}
	n := rand.IntN(total)
	for _, t := range difficultyMix[difficulty] {
		if len(byTier[t.tier]) == 0 {
			continue
		}
		if n < t.weight {
			tier := byTier[t.tier]
			return tier[rand.IntN(len(tier))]
		}
		n -= t.weight
	}
	return words[rand.IntN(len(words))]
}

// answersFor is every word a game of this shape may deal. Learning leaves
// everyday answers out without narrowing what a player may guess.
func (p *Pool) answersFor(length int, difficulty string) []Answer {
	all := []Answer{}
	for _, word := range p.bank {
		if !word.Retired && len([]rune(word.Word)) == length && (difficulty != "learning" || word.Difficulty != "familiar") {
			all = append(all, word)
		}
	}
	return all
}

// DuoCandidates is every word a shared daily board may deal. Everyday words
// stay out: two people pondering one board deserve something more than ABOUT.
func (p *Pool) DuoCandidates(length int) []Answer {
	out := []Answer{}
	for _, w := range p.bank {
		if !w.Retired && len([]rune(w.Word)) == length && w.Difficulty != "familiar" {
			out = append(out, w)
		}
	}
	return out
}
