# Wordle

Solve five words. Uncover one idea.

Wordle is a solo word game built around five linked, five-letter words. Each
board allows six guesses. Completed words accumulate as clues to a hidden
connection; a private theory can be revised throughout the run. The final
page explains how each word belongs.

The interface keeps a dictionary aesthetic: rose paper or plum ink, serif
letters, short definitions, and optional reading after each word. The game
works without an account. Signing in enables a lexicon, saved words, streaks,
and friends. Friends can share a daily board from separate devices, taking
alternating guesses and building a streak together.

## Development

```sh
make install
make dev
make test
```

The web app runs at `http://localhost:3000`, the Go API at
`http://localhost:8080`. `make api` and `make web` start them separately.
Copy `.env.example` to the appropriate local environment files if configuring
authentication or a database. Without `DATABASE_URL`, the API runs with
in-memory games and no account history.

The frontend uses Better Auth for Google sign-in and EdDSA session tokens.
Go verifies those tokens against the frontend JWKS. Both services use the
same Postgres database when configured; Go migrations leave Better Auth's
tables alone. Google sign-in stays hidden until configured.

Production configuration:

| Variable | Service | Example |
| --- | --- | --- |
| `BETTER_AUTH_URL` | web | `https://wordle.jerkeyray.com` |
| `NEXT_PUBLIC_API_URL` | web | `https://api.wordle.jerkeyray.com` |
| `AUTH_BASE_URL` | server | `https://wordle.jerkeyray.com` |
| `ALLOWED_ORIGINS` | server | `https://wordle.jerkeyray.com` |

Google's authorised redirect URI is the web origin followed by
`/api/auth/callback/google`. Better Auth's tables can be created with
`pnpm dlx @better-auth/cli migrate` from `web/`.

## Hints, restoration, and scoring

Each word has two separately authored clues: context after two accepted
guesses, association after four. They are optional and sequential. Requests
specify tier 1 or 2, so repeating a request returns the same clue. The API
never sends unused hints, future answers, or connection metadata during play.

Hints mark a result as assisted without reducing its points. A solve is worth
6 through 1 points according to its row; a loss earns 0. Historical database
scores are not recalculated.

The device remembers its active run, private theory, and completed pack IDs.
Restoration reads server state before accepting more input. A lost response
can therefore be retried without blindly resubmitting a guess. Completed
boards are kept with the run and can be revisited, including lost boards.

**Solo sessions are in memory.** They expire after six hours of inactivity and are
cleared on server restart. An expired session offers an explicit new start;
this is not offline play or cross-device synchronisation. Storage-blocked
browsers can play but cannot retain private notes between visits.

## Shared daily games

Open Friends from home or your profile. Copy/share your friend link, or add
someone by code. After a friend request is accepted, select that friend and
choose **Play together**. They accept a separate daily-game invitation.
Several friendships can each have their own word and streak.

Shared boards have six alternating guesses, one optional pass per person, and
no hints. They reset at midnight in the inviter's timezone. A solve extends the
pair's streak; a missed or lost day breaks it. The starting player rotates by
calendar date. Ending a partnership keeps its results and friendship; starting
another requires another accepted invitation and resets the shared streak.

PostgreSQL stores partnerships, board/entry snapshots, guesses, passes, and
retry receipts. Shared games survive API restarts. Every move checks membership,
turn ownership, deadline, and expected version inside a transaction. Request
IDs make retries safe. Private drafts and pending request IDs stay on the device,
scoped to player, partnership, and date.

Visible boards refresh every three seconds; friend summaries refresh every
30 seconds. Hidden pages pause polling, failures back off, and focus/reconnect
refresh immediately. Presence is ephemeral and expires after 90 seconds. No
last-seen timestamps, private collections, or other friendships' games are
exposed. Shared games require accounts and PostgreSQL; `/api/capabilities`
reports availability. Apply additive migration `0002_daily_duos.sql` by restarting
the updated API, and release the updated client alongside it.

Routes include `GET/POST /api/me/duos`, `POST /api/me/presence`,
`GET /api/duos/{id}`, `POST /api/duos/{id}/{accept|decline|cancel|end}`,
and `GET /api/duos/{id}/days/{date|today}`. Board mutations are
`POST /api/duos/{id}/days/{date}/{guesses|pass}` with `requestId` and `version`.

Legacy completion lists containing titles are accepted, including titles from
before the content revision. New completions store stable IDs. After every
pack has been seen, the next run begins a fresh exclusion cycle.

## Content

`server/internal/words/dictionary.txt` is the permissive guess dictionary.
`packs.json` contains 30 ordered packs and 150 answers with definitions,
notes, two clues, vocabulary difficulty, and per-word connection explanations.
Pack connection difficulty is rated separately. `answers.txt` remains the
legacy curated list; active runs use packs.

```sh
cd web
pnpm packs:check
pnpm test:content
pnpm packs:generate                 # requires AI_GATEWAY_API_KEY
pnpm packs:review
pnpm packs:review -- --approve <id>
```

Generation writes pending content only. Approval revalidates structure and
duplicates before promotion. Read the clues alongside earlier answers:
a sentence can omit the answer and still give it away. Verify factual claims,
and use usage notes instead of speculative etymology. Automated checks cannot
establish editorial fairness. See [content review](docs/content-review.md) for
the initial audit and player-test checklist.

Ship reviewed content, server, and client together: the hint wire format
changed from `{position, letter}` to `{tier, text, round}`. Restarting the API
loads the embedded content and expires existing in-memory runs.

## Verification

```sh
make test                    # Go, TypeScript, ESLint, content checks
cd server && go test -race ./...
cd web
pnpm exec playwright install chromium
pnpm test:e2e
```

Browser tests use the web app on port 3000 (reusing a running dev server) and
an isolated database-free API on 8082. They redirect the browser's default
localhost:8080 API calls to that test server and stub authentication. Stop
anything already using 8082 before running them. A custom frontend API URL
requires adapting the test route.

Tests cover ordered pilot runs, hint gates and restoration, the private theory,
connection reveals, session expiry, lost responses, and responsive themes.
Screenshots and failure traces are written to the ignored `web/test-results/`.
These checks exercise functionality; they do not replace playtesting with people.

PostgreSQL tests use a fresh isolated schema and never migrate the supplied
database's public schema. Set `TEST_DATABASE_URL` to a disposable PostgreSQL
database, then run:

```sh
cd server
go test -race ./...
DUO_BROWSER_TEST=1 go test ./internal/http -run '^TestDuoBrowser$' -v
```

The second command runs two Playwright browser contexts against a real database
and restarts a separate API process during play. Its authentication, clock,
answer-inspection, and restart controls exist only in the Go test binary.
Without these environment variables, database/browser integration tests skip.

## Deploying

Both halves ship as one Vercel deployment. `vercel.json` declares two services —
`web` (Next.js) and `api` (the Go server, built from `server/Dockerfile`) — and
routes between them.

They share an origin, which removes a whole category of problem: no CORS, no
cookie-domain juggling, and no `NEXT_PUBLIC_API_URL` to keep in sync. The
client defaults to the empty string in production, so every request goes to the
origin it was served from, and a preview deployment calls its own API rather
than production's.

The route table matters. Next owns `/api/auth/*` and `/api/config`; the Go API
owns the rest. Rewrites are evaluated in order, so the specific Go prefixes
come first and the catch-all to `web` comes last. Routing into a service is
final — if the Go service 404s, Vercel does not fall through to Next.

Project settings must have **Root Directory set to the repository root**, not
`web`, or Vercel will never see `vercel.json`.

Environment variables, all on the one project:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `https://wordle.jerkeyray.com` |
| `AUTH_BASE_URL` | `https://wordle.jerkeyray.com` — where Go fetches the JWKS |
| `ALLOWED_ORIGINS` | `https://wordle.jerkeyray.com` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | the OAuth client |

`NEXT_PUBLIC_API_URL` should be **absent**. If it is set to a host that does not
exist, the site renders and then fails the moment someone presses Play, which
reads as the app being broken rather than a setting being wrong.
