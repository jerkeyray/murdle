// Package words holds the guess dictionary and the curated answer pool.
//
// The two lists do different jobs. The dictionary is permissive: it decides
// whether a guess is a real word at all, so it includes plenty of words nobody
// would enjoy being handed as an answer. The answer pool is the opposite — a
// small curated list of words worth knowing, every one of which is also in the
// dictionary.
//
// In Phase 3 the answer pool moves to Postgres and is filled by the generation
// pipeline. This package is the seed that keeps the game playable until then,
// and stays the source of truth for guess validation either way.
package words

import (
	_ "embed"
	"strings"
)

//go:embed dictionary.txt
var dictionaryRaw string

// dictionaryExtra is a small uncensored supplement while the broad-source
// import is reviewed. Guess acceptance is intentionally separate from which
// words the game can serve as answers.
//
//go:embed dictionary_extra.txt
var dictionaryExtra string

// Pool answers "is this a word?" and "give me something to play".
type Pool struct {
	dictionary map[string]struct{}

	packs    []Pack
	classic  []PackWord
	packByID map[string]Pack
	wordInfo map[string]PackWord
	wordPack map[string]string
}

// NewPool builds the pool from the embedded lists. It is safe to call once at
// startup and share; nothing here mutates after construction.
//
// It panics on malformed packs.json: the file is embedded at build time, so a
// failure here is a broken binary rather than a runtime condition worth
// handling.
func NewPool() *Pool {
	packs, err := loadPacks()
	if err != nil {
		panic("words: " + err.Error())
	}
	classic, err := loadClassic()
	if err != nil {
		panic("words: " + err.Error())
	}

	dictWords := append(strings.Fields(dictionaryRaw), strings.Fields(dictionaryExtra)...)
	dictionary := make(map[string]struct{}, len(dictWords)+len(packs)*5)
	for _, w := range dictWords {
		dictionary[w] = struct{}{}
	}

	packByID := make(map[string]Pack, len(packs))
	wordInfo := make(map[string]PackWord)
	wordPack := make(map[string]string)
	for _, pack := range packs {
		packByID[pack.ID] = pack
		for _, w := range pack.Words {
			wordInfo[w.Word] = w
			wordPack[w.Word] = pack.ID
			// Slang often predates the dictionaries, so pack words are added
			// to the guess list too. Otherwise the game could serve a word it
			// would then refuse to accept.
			dictionary[w.Word] = struct{}{}
		}
	}

	// The Classic bank joins the same lookups, so an entry card, its clues and
	// the recorded solve all work for it unchanged. A word in both keeps its
	// pack entry, which is the richer one.
	bank := make([]PackWord, 0, len(classic))
	for _, w := range classic {
		if _, inPack := wordInfo[w.Word]; inPack {
			continue
		}
		bank = append(bank, w)
		wordInfo[w.Word] = w
		wordPack[w.Word] = ClassicPackID
		dictionary[w.Word] = struct{}{}
	}

	return &Pool{
		dictionary: dictionary,
		classic:    bank,
		packs:      packs,
		packByID:   packByID,
		wordInfo:   wordInfo,
		wordPack:   wordPack,
	}
}

// IsWord reports whether guess is in the dictionary. Case-insensitive.
func (p *Pool) IsWord(guess string) bool {
	_, ok := p.dictionary[strings.ToLower(strings.TrimSpace(guess))]
	return ok
}

// Size reports how many playable answers and dictionary entries are loaded,
// for the health endpoint and startup logging.
//
// Answers are counted from the packs, which is where every word a player is
// actually dealt now comes from. A separate curated list used to sit alongside
// them and was reported here long after nothing read it, so the number on the
// health endpoint described a pool the game had stopped playing from.
func (p *Pool) Size() (answers, dictionary int) {
	return len(p.wordInfo), len(p.dictionary)
}
