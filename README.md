# Murdle

A word game for two people and one phone.

Wordle gives everyone the same word once a day and has nothing to say about it
afterwards. Murdle is built for how two people sitting next to each other
actually play: a **shared board where guesses alternate** — you take row 1, she
takes row 2 — so you are reading each other's clues rather than playing two
separate games. The words are curated to be worth knowing, and when the round
ends the app teaches you the one you just played.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Game engine, word pool, API | Done |
| 1 | Solo play + design system | Done |
| 2 | Shared board pass-and-play | Next |
| 3 | Word pipeline, learn cards, hints | Planned |
| 4 | Accounts, head-to-head history | Planned |
| 5 | Two-device realtime (optional) | Planned |

The shared-board rules, scoring and turn order are already implemented and
tested in the Go engine — Phase 2 is the UI for them.

## Layout

```
server/   Go API: game rules, word pool, round state
web/      Next.js app: UI, and from Phase 3 the AI word pipeline
```

The server holds the answer and scores every guess. The client never knows the
word until the round is over — on a shared phone, both players are looking at
the same DevTools if anyone gets curious.

## Running it

Two processes. The Go API first:

```bash
cd server && go run ./cmd/murdled
```

Then the web app:

```bash
cd web && pnpm install && pnpm dev
```

Open http://localhost:3000. The web app talks to `http://localhost:8080` by
default; override with `NEXT_PUBLIC_API_URL`. The API allows
`http://localhost:3000` by default; override with `ALLOWED_ORIGINS`.

No database is needed yet — rounds live in memory and the word pool is embedded
in the binary. Postgres arrives in Phase 3, when the word pipeline needs
somewhere to write.

## Tests

```bash
cd server && go test ./...
```

Covers the parts that are easy to get quietly wrong: duplicate-letter marking,
turn alternation, the scoring maths, and an assertion that the answer never
appears in a response while a round is live.

## Design

The game is about words worth knowing, so the interface is built to feel like a
specimen page from a well-made dictionary rather than a game app.

- **Ink and paper, not slate.** Both themes are warm — a blue-cast dark theme
  reads as software, a warm one reads as printed matter. The marks are
  verdigris and ochre: pigments rather than UI colours.
- **A serif doing real work.** Fraunces sets the wordmark, the board letters
  and the entry at the end of a round. Serif letterforms on the tiles are what
  make the board read as type, and they tie the game to the dictionary entry it
  produces. The sans carries chrome only — keyboard, labels, buttons — so it
  never competes with the words.
- **Editorial furniture.** Hairline rules bracket the board, labels are small
  caps, and the header carries a specimen number that is a real count of the
  words this device has played.
- **Paper grain and a warm pool of light** behind the board, both subtle enough
  that you would only notice them by their absence.
- **Colour-blind mode** swaps green/amber for blue/orange *and* adds glyphs, so
  the marks are readable with no colour perception at all.
- **One-handed layout** — keyboard in the thumb arc, `100dvh` so iOS Safari's
  toolbar cannot clip the bottom row, no scrolling during play.
- Installs to the home screen as a PWA.

## Word lists

`server/internal/words/dictionary.txt` — 8,506 five-letter words, derived from
the system dictionary. This decides whether a *guess* is a real word, and is
deliberately permissive.

`server/internal/words/answers.txt` — 260 curated answers. Every one is also in
the dictionary. This list is the seed; Phase 3 replaces it with an LLM-generated
and human-reviewed pool in Postgres.
