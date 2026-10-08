// Package words holds the guess dictionary and the curated answer pool.
//
// The two lists do different jobs. The dictionary is permissive: it decides
// whether a guess is a real word at all, so it includes plenty of words nobody
// would enjoy being handed as an answer. The answer bank is the opposite — a
// curated list of words worth knowing, each with an entry, every one of which
// is also in the dictionary.
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

	bank     []Answer
	wordInfo map[string]Answer
	stats    Stats
}

// NewPool builds the pool from the embedded lists. It is safe to call once at
// startup and share; nothing here mutates after construction.
//
// It panics on a malformed classic.json: the file is embedded at build time, so a
// failure here is a broken binary rather than a runtime condition worth
// handling.
func NewPool() *Pool {
	bank, err := loadClassic()
	if err != nil {
		panic("words: " + err.Error())
	}
	if err := validateUniqueHints(bank); err != nil {
		panic("words: " + err.Error())
	}

	dictWords := append(strings.Fields(dictionaryRaw), strings.Fields(dictionaryExtra)...)
	dictionary := make(map[string]struct{}, len(dictWords)+len(bank))
	for _, w := range dictWords {
		dictionary[w] = struct{}{}
	}

	wordInfo := make(map[string]Answer, len(bank))
	for _, w := range bank {
		wordInfo[w.Word] = w
		// Slang often predates the dictionaries, so every answer is added to
		// the guess list too. Otherwise the game could serve a word it would
		// then refuse to accept.
		dictionary[w.Word] = struct{}{}
	}

	return &Pool{dictionary: dictionary, bank: bank, wordInfo: wordInfo, stats: computeStats(bank, len(dictionary))}
}

// IsWord reports whether guess is in the dictionary. Case-insensitive.
func (p *Pool) IsWord(guess string) bool {
	_, ok := p.dictionary[strings.ToLower(strings.TrimSpace(guess))]
	return ok
}

// Size reports how many playable answers and dictionary entries are loaded,
// for the health endpoint and startup logging.
//
// Answers are counted from the bank, which is where every word a player is
// dealt comes from.
func (p *Pool) Size() (answers, dictionary int) {
	return len(p.wordInfo), len(p.dictionary)
}
