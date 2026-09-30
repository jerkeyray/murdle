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

// Pool answers "is this a word?" and "give me a word to play".
type Pool struct {
	dictionary map[string]struct{}
	answers    []string
}

// NewPool builds the pool from the embedded lists. It is safe to call once at
// startup and share; nothing here mutates after construction.
func NewPool() *Pool {
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

	return &Pool{dictionary: dictionary, answers: answers}
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
