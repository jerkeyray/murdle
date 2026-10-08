package words

// Stats describes the answer bank for the "about the words" page. It is worked
// out from the embedded data when the pool is built, so what players read is
// always what the game is actually dealing, with nothing to keep in step by hand.
type Stats struct {
	// Answers are the playable entries; Retired are kept only for old solves.
	Answers int `json:"answers"`
	Retired int `json:"retired"`
	// Dictionary is every word a player may guess, answers included.
	Dictionary int           `json:"dictionary"`
	Lengths    []LengthStats `json:"lengths"`
	Slang      int           `json:"slang"`
	Coverage   Coverage      `json:"coverage"`
}

// LengthStats is the playable answers of one word length by difficulty.
type LengthStats struct {
	Length      int `json:"length"`
	Total       int `json:"total"`
	Familiar    int `json:"familiar"`
	Stretch     int `json:"stretch"`
	Challenging int `json:"challenging"`
}

// Coverage counts the playable answers that carry each optional field.
type Coverage struct {
	Pronunciation      int `json:"pronunciation"`
	PartOfSpeech       int `json:"partOfSpeech"`
	Origin             int `json:"origin"`
	Example            int `json:"example"`
	ExampleFromTatoeba int `json:"exampleFromTatoeba"`
}

func computeStats(bank []Answer, dictionary int) Stats {
	s := Stats{Dictionary: dictionary, Lengths: []LengthStats{{Length: 5}, {Length: 6}}}
	for _, w := range bank {
		if w.Retired {
			s.Retired++
			continue
		}
		s.Answers++
		if w.Register == RegisterSlang {
			s.Slang++
		}
		for i := range s.Lengths {
			l := &s.Lengths[i]
			if len([]rune(w.Word)) != l.Length {
				continue
			}
			l.Total++
			switch w.Difficulty {
			case "familiar":
				l.Familiar++
			case "stretch":
				l.Stretch++
			case "challenging":
				l.Challenging++
			}
		}
		if w.Pronunciation != "" {
			s.Coverage.Pronunciation++
		}
		if w.PartOfSpeech != "" {
			s.Coverage.PartOfSpeech++
		}
		if w.Origin != "" {
			s.Coverage.Origin++
		}
		if w.Example != "" {
			s.Coverage.Example++
		}
		if w.ExampleSource != "" {
			s.Coverage.ExampleFromTatoeba++
		}
	}
	return s
}

// Stats returns the figures for the about page.
func (p *Pool) Stats() Stats { return p.stats }
