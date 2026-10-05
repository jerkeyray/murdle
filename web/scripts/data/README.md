# Reference data

Neither data file is committed; both are rebuilt from the steps below.

`wiktionary.jsonl` is a cut-down extract of English Wiktionary, holding only
the words in our banks. It comes from the [kaikki.org](https://kaikki.org)
machine-readable dump (wiktextract) and is rebuilt with
`scripts/extract-wiktionary.mjs`. It feeds the pronunciation, part of speech,
origin and example fields that `scripts/enrich-entries.mjs` adds to
`server/internal/words/classic.json` and `packs.json`.

Wiktionary content is licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The fields
taken from it carry the same licence and need attribution wherever they are
shown; the app credits Wiktionary on the word entry.

WordNet 3.1 comes from the `wordnet-db` package and needs no download. It
fills part of speech and examples where Wiktionary could not. WordNet is
© Princeton University, used under its permissive WordNet licence.

`tatoeba.tsv` is the English sentence export from [Tatoeba](https://tatoeba.org),
licensed [CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/):

    curl -L https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences_detailed.tsv.bz2 \
      | bunzip2 > scripts/data/tatoeba.tsv

It supplies examples only for words with a single sense, because its
sentences are not tagged by meaning. Each such example links back to its
sentence through `exampleSource`.

`enrich-review.json` lists the words the data could not fill confidently,
with the candidate senses alongside. Fill in the missing fields and apply
them with `node scripts/enrich-entries.mjs --from <file>`.
