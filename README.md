<p align="center">
  <img src="web/public/icon.svg" width="88" alt="" />
</p>

<h1 align="center">Wordle</h1>

<p align="center"><em>Solve words. Keep the good ones.</em></p>

<p align="center"><a href="https://wordle.jerkeyray.com"><strong>Play →</strong></a></p>

<br />

> **wordle** · *noun*
>
> 1. Six tries at a word you don't know yet.
> 2. The word, once you do — kept, with what it means.

<br />

Play one word at a time, five or six letters, from easy to hard.
Or bring a friend: one board a day, turns traded back and forth.

Every word you solve stays with you.

## The words

**4,963 answers** can be dealt as the puzzle: 2,651 five-letter and 2,312
six-letter. Every one has a definition, a short note, two graded clues and a
difficulty. A further 13 are *retired* (never dealt, kept so earlier solves
still open to a full card). Players can guess from a much larger list of
**34,942 words**, so a word does not have to be an answer to be accepted.

| Difficulty | 5-letter | 6-letter | Meaning |
| --- | ---: | ---: | --- |
| Familiar | 1,634 | 1,572 | nearly everyone knows it |
| Stretch | 787 | 590 | many recognise it, few use it |
| Challenging | 230 | 150 | most educated adults could not define it |

*Mixed* games follow a 40 / 40 / 20 split across the three; *Learning* never
deals a familiar word; *Hard* deals only stretch and challenging words, about
70% challenging. 247 answers are slang, the rest standard. Figures are as of
October 2026; `pnpm bank:stats` (in `web/`) recounts them.

### Where each part comes from

| What you see | Source | Made by | Coverage |
| --- | --- | --- | ---: |
| Words you may guess | [SCOWL](http://wordlist.aspell.net/) via the `word-list` package, plus a 33-word supplement | program | 34,942 words |
| Definition | written for this game | **AI agents** | 100% |
| Note (etymology or usage fact) | written for this game | **AI agents** | 100% |
| Two clues, easy then sharp | written for this game | **AI agents** | 100% |
| Difficulty label | judged, not measured | **AI agents** (see below) | 100% |
| Pronunciation (IPA, shown respelled) | [Wiktionary](https://en.wiktionary.org) via [kaikki.org](https://kaikki.org) | program | 90% |
| Part of speech | Wiktionary, then [WordNet 3.1](https://wordnet.princeton.edu) | program | 89% |
| Origin line | Wiktionary etymology, shortened | program | 74% |
| Example sentence | Wiktionary, then WordNet, then [Tatoeba](https://tatoeba.org) (single-sense words only) | program | 35% |

Pronunciation, part of speech, origin and examples are copied from the
reference sources above by `web/scripts/enrich-entries.mjs`; a model does not
write them. A missing field simply isn't shown. Examples are thinnest because
the sources rarely hold a good modern sentence, and 425 of the 1,716 link back
to the Tatoeba sentence they came from.

### What the AI agents wrote, and what that means

The definitions, notes, clues and difficulty labels are language-model text,
not the work of a lexicographer, and no person has read every entry.

- **The original bank** (4,363 entries, drafted from 5 October 2026) was
  written in batches by AI agents. The repository does not record which model
  wrote which batch.
- **Clue rewrite.** When the validator below began rejecting clues that shared
  the answer's root or restated its definition, 87 entries failed. Claude
  rewrote those clues.
- **385 words added** in October 2026, from three routes. 102 came from
  unused dictionary words ranked by how often Tatoeba uses them; 17 from a
  pilot on words Tatoeba never uses (Haiku turned down 86% of that group, so
  it was not scaled up); and 266 from lists of hard but fair vocabulary that
  Claude Haiku proposed by theme, checked against the guess dictionary and the
  bank. In every route Haiku drafted the entry behind a strict reject filter
  (about a third of proposed words were turned down as technical, archaic,
  offensive, inflected or doubtful, and some of those were later restored by
  hand). Origin notes were read against known etymologies; the rest was
  spot-checked, not fully reviewed.
- **Difficulty re-grade.** Haiku graded every word without seeing its current
  label. Claude Sonnet independently re-graded the 962 words Haiku would have
  changed. A label moved only where both agreed: 498 words, 373 easier and 125
  harder. The labels are still a model's judgement, not measured from how
  players actually do.

Treat an etymology in a note as a good-faith claim, not a verified fact. If
you find a wrong one, the entry is in `server/internal/words/classic.json`.

### Checks every entry passes

The server refuses to start if any answer fails these, so a bad entry is a
broken build, not a bad game:

- five or six lowercase letters, in the guess dictionary, listed once;
- a definition, a note, a register (standard or slang) and a difficulty;
- exactly two different clues, each at least 12 characters;
- no clue that contains the answer or any word sharing its first four letters;
- no clue that restates the definition or talks about letter positions;
- no clue reused for a different answer;
- well-formed pronunciation, part of speech, origin and example, where present.

Automated checks cannot tell whether a clue is fair or a note is true. See
[development notes](docs/development.md#content) for how entries are drafted,
merged and re-checked.

### Credits and licences

The code is [MIT](LICENSE). The word data is a mix, and its sources carry
their own terms:

- **Wiktionary** (pronunciations, origins, some examples and parts of speech):
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Fields
  taken from it remain under that licence.
- **Tatoeba** (example sentences, each linked by `exampleSource`):
  [CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/).
- **WordNet 3.1** (parts of speech and examples): © Princeton University,
  under the WordNet licence.
- **SCOWL** (the guess dictionary): see the
  [SCOWL copyright notice](http://wordlist.aspell.net/scowl-readme/).

<br />

<p align="center"><sub><a href="docs/development.md">Development notes</a> · <a href="LICENSE">MIT</a></sub></p>
