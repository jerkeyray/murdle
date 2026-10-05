package words

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// ClassicPackID is recorded against a solve whose word came from the Classic
// bank rather than a themed pack. solves.pack_id is not null, and this is not
// a pack Pack() can find, so themed exclusion simply never matches it.
const ClassicPackID = "classic"

//go:embed classic.json
var classicRaw []byte

// loadClassic reads the Classic bank: standalone answers with an entry each
// and no theme around them.
//
// This is what lets the pool grow past what themed packs can carry. A pack
// needs five words and a connection worth revealing; a Classic answer only
// needs to be a good word with a good entry, so the bank can run to thousands
// while packs stay hand-built.
func loadClassic() ([]PackWord, error) {
	var bank []PackWord
	if err := json.Unmarshal(classicRaw, &bank); err != nil {
		return nil, fmt.Errorf("parsing classic.json: %w", err)
	}
	return bank, validateClassic(bank)
}

var classicWord = regexp.MustCompile(`^[a-z]{5,6}$`)

// validateClassic holds the bank to the same bar as pack words, minus the
// connection, since there is no theme to connect to. Like packs.json it is
// embedded, so a bad entry is a broken build rather than a runtime surprise.
func validateClassic(bank []PackWord) error {
	seen := map[string]bool{}
	for _, w := range bank {
		switch {
		case !classicWord.MatchString(w.Word):
			return fmt.Errorf("classic: %q is not five or six lowercase letters", w.Word)
		case seen[w.Word]:
			return fmt.Errorf("classic: %q appears twice", w.Word)
		case strings.TrimSpace(w.Definition) == "" || strings.TrimSpace(w.Note) == "":
			return fmt.Errorf("classic: %q needs a definition and a note", w.Word)
		case w.Register != RegisterStandard && w.Register != RegisterSlang:
			return fmt.Errorf("classic: %q has register %q", w.Word, w.Register)
		case w.Difficulty != "familiar" && w.Difficulty != "stretch" && w.Difficulty != "challenging":
			return fmt.Errorf("classic: %q has difficulty %q", w.Word, w.Difficulty)
		case validateEnrichment(w) != "":
			return fmt.Errorf("classic: %q %s", w.Word, validateEnrichment(w))
		case len(w.Hints) != 2 || w.Hints[0] == w.Hints[1]:
			return fmt.Errorf("classic: %q needs two different hints", w.Word)
		}
		for _, h := range w.Hints {
			if len(strings.TrimSpace(h)) < 12 || strings.Contains(strings.ToLower(h), w.Word) {
				return fmt.Errorf("classic: %q has a hint that is too short or gives it away", w.Word)
			}
		}
		seen[w.Word] = true
	}
	return nil
}

var partsOfSpeech = map[string]bool{
	"noun": true, "verb": true, "adjective": true, "adverb": true,
	"preposition": true, "conjunction": true, "interjection": true, "pronoun": true,
}

// validateEnrichment checks the optional fields when they are present and
// returns a complaint, or "" if they are fine. Absent is fine: the banks are
// enriched in batches, and an unenriched word just shows less.
func validateEnrichment(w PackWord) string {
	switch {
	case strings.ContainsAny(w.Pronunciation, "/[]"):
		return "pronunciation should be bare IPA, without slashes or brackets"
	case w.PartOfSpeech != "" && !partsOfSpeech[w.PartOfSpeech]:
		return fmt.Sprintf("has part of speech %q", w.PartOfSpeech)
	case w.ExampleSource != "" && (w.Example == "" || !strings.HasPrefix(w.ExampleSource, "https://")):
		return "example source must be a link, and only alongside an example"
	case len(w.Origin) > 160:
		return "origin should be one short line"
	case w.Example != "" && !strings.Contains(strings.ToLower(w.Example), w.Word[:3]):
		// Only the first three letters, so inflections such as "knives" count.
		return "example does not use the word"
	}
	return ""
}
