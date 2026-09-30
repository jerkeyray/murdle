package words

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math/rand/v2"
)

//go:embed packs.json
var packsRaw []byte

// Register says what kind of word this is. The pool deliberately mixes the
// two: the jolt of GYATT and SALVE sitting in the same game is the joke, and
// the entry plays both of them straight.
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
	Note string `json:"note"`
}

// Pack is a themed run: several words that secretly belong together.
//
// The theme is withheld until the run ends, so the two of you are guessing at
// the connection as well as the word. Title and Blurb are the payoff.
type Pack struct {
	ID    string     `json:"id"`
	Title string     `json:"title"`
	Blurb string     `json:"blurb"`
	Words []PackWord `json:"words"`
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

// RandomPack picks a pack, avoiding any id in exclude.
//
// Falls back to an unfiltered pick once every pack has been played, rather
// than failing — running out of fresh themes should mean repeats, not an
// error in the middle of a game.
func (p *Pool) RandomPack(exclude map[string]struct{}) (Pack, bool) {
	if len(p.packs) == 0 {
		return Pack{}, false
	}

	eligible := p.packs
	if len(exclude) > 0 {
		eligible = make([]Pack, 0, len(p.packs))
		for _, pack := range p.packs {
			if _, seen := exclude[pack.ID]; !seen {
				eligible = append(eligible, pack)
			}
		}
		if len(eligible) == 0 {
			eligible = p.packs
		}
	}

	return eligible[rand.IntN(len(eligible))], true
}
