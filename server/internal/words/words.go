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
	"math/rand/v2"
	"strings"
)

//go:embed dictionary.txt
var dictionaryRaw string

//go:embed answers.txt
var answersRaw string

// Pool answers "is this a word?" and "give me something to play".
type Pool struct {
	dictionary map[string]struct{}
	answers    []string

	packs    []Pack
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

	answers := strings.Fields(answersRaw)

	dictWords := strings.Fields(dictionaryRaw)
	dictionary := make(map[string]struct{}, len(dictWords)+len(answers))
	for _, w := range dictWords {
		dictionary[w] = struct{}{}
	}
	// Belt and braces: every answer must be guessable, even if the curated list
	// and the dictionary ever drift apart.
	for _, w := range answers {
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

	return &Pool{
		dictionary: dictionary,
		answers:    answers,
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

// Random returns an answer chosen uniformly, skipping anything in exclude.
//
// exclude is how "don't show us a word we've already played" is enforced. If
// every answer is excluded it falls back to an unfiltered pick rather than
// failing — running out of unseen words should not be able to break a round.
func (p *Pool) Random(exclude map[string]struct{}) string {
	if len(p.answers) == 0 {
		return ""
	}

	eligible := p.answers
	if len(exclude) > 0 {
		eligible = make([]string, 0, len(p.answers))
		for _, w := range p.answers {
			if _, seen := exclude[w]; !seen {
				eligible = append(eligible, w)
			}
		}
		if len(eligible) == 0 {
			eligible = p.answers
		}
	}

	return eligible[rand.IntN(len(eligible))]
}

// Size reports how many answers and dictionary entries are loaded, for the
// health endpoint and startup logging.
func (p *Pool) Size() (answers, dictionary int) {
	return len(p.answers), len(p.dictionary)
}
