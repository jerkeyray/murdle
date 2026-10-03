package words

// sixPacks is deliberately code-owned for the first six-letter release. It
// keeps the new bank separate from the established JSON archive while the
// editorial pipeline catches up with variable word lengths.
func sixPacks() []Pack {
	groups := []struct {
		id, title, blurb string
		words            []string
	}{
		{"night-sky", "Night Sky", "Things that make the dark look occupied.", []string{"comets", "aurora", "nebula", "planet", "meteor"}},
		{"on-stage", "On Stage", "Words from the side of a performance.", []string{"chorus", "melody", "rhythm", "encore", "actors"}},
		{"by-water", "By Water", "A small coast in five words.", []string{"beacon", "harbor", "sailor", "voyage", "island"}},
		{"printed-page", "Printed Page", "Parts of a story before it becomes one.", []string{"author", "volume", "leafed", "margin", "phrase"}},
		{"garden-work", "Garden Work", "The patient parts of growing things.", []string{"petals", "shovel", "trowel", "seeded", "pruned"}},
		{"cold-weather", "Cold Weather", "A forecast with its collar up.", []string{"frosty", "flurry", "winter", "icicle", "sleigh"}},
		{"at-home", "At Home", "Objects that earn their keep indoors.", []string{"pillow", "kettle", "drawer", "carpet", "window"}},
		{"in-the-city", "In The City", "The pieces that make a place feel busy.", []string{"street", "subway", "market", "museum", "arcade"}},
		{"on-the-road", "On The Road", "Ways of moving through a journey.", []string{"ticket", "engine", "travel", "detour", "tarmac"}},
		{"kitchen-table", "Kitchen Table", "The useful grammar of cooking.", []string{"recipe", "ladles", "simmer", "pepper", "saucer"}},
		{"weather-watch", "Weather Watch", "A day deciding what sort it will be.", []string{"breeze", "cloudy", "stormy", "sunset", "melted"}},
		{"small-creatures", "Small Creatures", "Animals that make their presence known.", []string{"beetle", "weevil", "rabbit", "otters", "insect"}},
		{"workshop", "Workshop", "Tools and the marks they leave behind.", []string{"hammer", "chisel", "sawing", "sander", "planer"}},
		{"good-argument", "Good Argument", "The ingredients of changing a mind.", []string{"reason", "debate", "proofs", "listen", "assent"}},
		{"at-the-match", "At The Match", "Words that arrive with a scoreboard.", []string{"sports", "league", "racket", "umpire", "medals"}},
		{"colour-notes", "Colour Notes", "Names for what light has been doing.", []string{"yellow", "orange", "violet", "indigo", "sienna"}},
		{"time-keepers", "Time Keepers", "Ways we arrange a day into parts.", []string{"minute", "second", "season", "spring", "autumn"}},
		{"human-scale", "Human Scale", "Words for the texture of ordinary life.", []string{"friend", "family", "smiles", "voices", "kindly"}},
		{"open-country", "Open Country", "A walk with more horizon than walls.", []string{"meadow", "valley", "forest", "summit", "canyon"}},
		{"quiet-arts", "Quiet Arts", "Making something slowly and by hand.", []string{"weaver", "potter", "sketch", "writer", "design"}},
	}
	out := make([]Pack, 0, len(groups))
	for _, group := range groups {
		pack := Pack{ID: group.id, Title: group.title, Blurb: group.blurb, ConnectionDifficulty: "medium"}
		for _, word := range group.words {
			pack.Words = append(pack.Words, PackWord{Word: word, Register: RegisterStandard, Difficulty: sixDifficulty(word), Definition: "A common English word in this set.", Note: "This six-letter word is part of the first expanded Wordle bank. Its full editorial note will be refined as the new content pipeline matures.", Hints: []string{"Think about an everyday setting or idea.", "Its use becomes clearer in a familiar context."}, Connection: "It belongs to the set’s shared idea."})
		}
		out = append(out, pack)
	}
	return out
}

// These answers are still friendly enough to solve, but are less likely to
// be words a player sees every day. The learning setting uses this editorial
// classification rather than changing which guesses the game accepts.
func sixDifficulty(word string) string {
	stretch := map[string]bool{
		"aurora": true, "nebula": true, "meteor": true, "chorus": true, "rhythm": true,
		"encore": true, "beacon": true, "harbor": true, "voyage": true, "margin": true,
		"phrase": true, "trowel": true, "pruned": true, "flurry": true, "icicle": true,
		"sleigh": true, "tarmac": true, "weevil": true, "chisel": true, "planer": true,
		"assent": true, "sienna": true, "indigo": true, "meadow": true, "summit": true,
		"canyon": true, "weaver": true, "potter": true,
	}
	if stretch[word] {
		return "stretch"
	}
	return "familiar"
}
