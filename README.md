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

## Design notes

- **Dark by default**, light fully supported.
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
