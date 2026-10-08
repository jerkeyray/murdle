package words

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// ClassicPackID is recorded against every new solve. solves.pack_id is not
// null, and rows from the days of themed packs keep their old values, so the
// column stays.
const ClassicPackID = "classic"

//go:embed classic.json
var classicRaw []byte

// loadClassic reads the answer bank: standalone words with an entry each. A
// word only needs to be a good word with a good entry, so the bank can run to
// thousands.
func loadClassic() ([]Answer, error) {
	var bank []Answer
	if err := json.Unmarshal(classicRaw, &bank); err != nil {
		return nil, fmt.Errorf("parsing classic.json: %w", err)
	}
	return bank, validateClassic(bank)
}

// structuralHint matches clues that describe the spelling instead of the
// meaning, which the board already tells the player.
var structuralHint = regexp.MustCompile(`(?i)\b(first|last|second|third|fourth|fifth|sixth) letter\b|\b(starts?|ends?) with (the )?(letter|vowel|consonant)\b`)

var classicWord = regexp.MustCompile(`^[a-z]{5,6}$`)

// validateClassic holds every entry to one bar. The bank is embedded, so a bad
// entry is a broken build rather than a runtime surprise.
func validateClassic(bank []Answer) error {
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
		case placeholderCopy(w):
			return fmt.Errorf("classic: %q has placeholder editorial copy", w.Word)
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
		for _, h := range w.Hints {
			if structuralHint.MatchString(h) {
				return fmt.Errorf("classic: %q has a hint about letter positions: %q", w.Word, h)
			}
		}
		if problem := hintProblem(w); problem != "" {
			return fmt.Errorf("classic: %q %s", w.Word, problem)
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
func validateEnrichment(w Answer) string {
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

var nonLetters = regexp.MustCompile(`[^a-z]+`)

func normalizeHint(s string) string {
	return strings.TrimSpace(nonLetters.ReplaceAllString(strings.ToLower(s), " "))
}

// hintProblem catches the two ways a clue announces the answer instead of
// nudging toward it: naming a relative of the word, and restating its
// definition. Either one turns a hint into a skip button.
func hintProblem(w Answer) string {
	root := w.Word[:4]
	definition := normalizeHint(w.Definition)
	for _, h := range w.Hints {
		hint := normalizeHint(h)
		for _, token := range strings.Fields(hint) {
			// "Related to amplify" gives AMPLE away as surely as the word
			// itself, so a shared four-letter start counts as a leak.
			if strings.HasPrefix(token, root) {
				return fmt.Sprintf("has a hint that shares its root: %q", h)
			}
		}
		// A hint that contains the whole definition, or most of it, is the
		// entry card read out early.
		if strings.Contains(hint, definition) || strings.Contains(definition, hint) && len(hint)*5 >= len(definition)*3 {
			return fmt.Sprintf("has a hint that restates the definition: %q", h)
		}
	}
	return ""
}

// validateUniqueHints rejects a clue used for two answers: one clue cannot
// fairly point at both, and a player who has met it before gets misled.
func validateUniqueHints(bank []Answer) error {
	owner := map[string]string{}
	for _, w := range bank {
		for _, h := range w.Hints {
			key := normalizeHint(h)
			if other, ok := owner[key]; ok && other != w.Word {
				return fmt.Errorf("hint %q is used for both %q and %q", h, other, w.Word)
			}
			owner[key] = w.Word
		}
	}
	return nil
}

// placeholderCopy catches boilerplate left over from bulk drafting, which would
// pass every structural check while teaching the player nothing.
func placeholderCopy(w Answer) bool {
	content := strings.ToLower(strings.Join(append(append([]string{}, w.Hints...), w.Definition, w.Note), " "))
	for _, phrase := range []string{
		"a common english word in this set",
		"first expanded wordle bank",
		"think about an everyday setting or idea",
		"its use becomes clearer in a familiar context",
		"it belongs to the set’s shared idea",
		"in this set, it helps reveal",
	} {
		if strings.Contains(content, phrase) {
			return true
		}
	}
	return false
}
