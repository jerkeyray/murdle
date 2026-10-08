# Development

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

Solo account history and streak activity use additive migration
`0006_player_activity_days.sql`. The API applies pending migrations under a
PostgreSQL advisory lock at startup. Deploy the API migration before switching
traffic to code that writes activity days, then release the matching web and API
versions together. The migration backfills every distinct date still recorded
in `solves`; dates erased when an older replay overwrote a result cannot be
reconstructed. Once activity-day writes begin, restoring an older API would
stop recording those dates correctly.

`/api/health` is a liveness check. `/api/ready` performs a bounded database ping
when PostgreSQL is configured. In-memory mode remains ready without a database.
Game creation is limited to 120 requests per minute per API instance by default;
friend and Duo invitations are limited to 10 per minute per authenticated player.
These in-memory limits are configurable with `GAME_CREATE_RATE_LIMIT`,
`FRIEND_RATE_LIMIT`, and `INVITE_RATE_LIMIT`, and are not coordinated across
instances.

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

## Clues, restoration, and scoring

Each word has one optional authored clue, available after three accepted
guesses. Repeating its request returns the same clue. The API never sends
unused clues or future answers during play.

A solve is worth 6 through 1 points according to its row; a loss earns 0.
Historical database scores are not recalculated.

The device remembers its active run and the words it has played.
Restoration reads server state before accepting more input. A lost response
can therefore be retried without blindly resubmitting a guess. Completed
boards are kept with the run and can be revisited, including lost boards.

**Solo sessions are in memory.** They expire after 30 days of inactivity and are
cleared on server restart. An expired session offers an explicit new start;
this is not offline play or cross-device synchronisation. Storage-blocked
browsers can play but cannot retain private notes between visits.

## Shared daily games

Open Friends from home or your profile. Copy/share your friend link, or add
someone by code. After a friend request is accepted, select that friend and
choose **Play together**. They accept a separate daily-game invitation.
Several friendships can each have their own word and streak.

Shared boards have six alternating guesses, one optional pass per person, and
one shared authored hint that either player can reveal after three accepted
guesses without using a turn. They reset at midnight in the inviter's timezone.
A solve extends the pair's streak; a missed or lost day breaks it. The starting
player rotates by calendar date. Ending a partnership keeps its results and
friendship; starting another requires another accepted invitation and resets
the shared streak.

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

## Content

`server/internal/words/dictionary.txt` is the permissive guess dictionary for
five- and six-letter guesses. `classic.json` is the answer bank: every entry
has a definition, note, two authored clues, a vocabulary difficulty
(`familiar`, `stretch` or `challenging`) and optionally pronunciation, part of
speech, origin and an example. An entry marked `retired` is never dealt but
stays guessable, and keeps its card for solves already recorded. The Go server
validates the whole bank at startup, so a bad entry fails the build.

Clues are held to rules the validator enforces: no word sharing the answer's
first four letters, nothing that restates the definition, no clue used for two
answers, and no talk of letter positions.

```sh
cd web
pnpm test:content
pnpm hints:review                   # list weak clues; apply edits with --from
pnpm entries:report                 # pronunciation / origin / example coverage
```

Read clues alongside the definition: a sentence can omit the answer and still
give it away. Verify factual claims, and use usage notes instead of speculative
etymology. Automated checks cannot establish editorial fairness.

Ship reviewed content, server, and client together. Restarting the API loads
the embedded content. PostgreSQL-backed games survive API restarts; games in
optional in-memory mode do not.

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

Tests cover hint gates and restoration, played-word exclusion,
session expiry, lost responses, and responsive themes.
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

## Operational limits

`/api/health` reports process liveness. `/api/ready` also checks PostgreSQL
when configured and is the Fly health-check endpoint. API logs include request
ID, route, status, and duration; request bodies, guesses, and answers are not
logged. In-memory rate limits default to 120 game creations per minute per
instance and 10 friend/duo invitations per minute per signed-in player. Override
with `GAME_CREATE_RATE_LIMIT`, `FRIEND_RATE_LIMIT`, and `INVITE_RATE_LIMIT`.
Limits are per API instance and reset with that process; they are an abuse
speed bump rather than a shared quota.

## Multiplayer performance and recovery

Routine `/api/duos/:id/days/:board` reads use a consistent read-only snapshot.
The current-board path executes four SQL statements (excluding transaction
begin/commit and account lookup), regardless of how many past boards exist.
Only expiry or daily board creation takes the duo write lock. Guesses and
passes are aggregated by board; current pair streaks walk consecutive dates
rather than transferring the entire history on every poll.

`/api/me/duos` returns summaries with an empty `recent` array. The Friends dialog
loads its seven recent results through `/api/duos/:id` when opened. Historical
board links read the requested board directly, including results older than
those seven. Successful moves use the mutation response directly; they do not
make a preflight or follow-up GET. An uncertain guess, pass, or hint is retried
with its persisted request ID and payload, including after refresh. Matching a
previous guess is not considered a receipt. Authentication, timeout, rate-limit,
and server failures retain the pending mutation.

Visible active pairs refresh every three seconds in both seats, including after
completion, so shared hints, next words, and daily rollover reach both players.
Hidden tabs pause, failures back off, and requests from obsolete subscriptions
cannot update the board. Presence heartbeats continue on duo boards and use
shared PostgreSQL timestamps, with writes throttled to once per 20 seconds and
an online window of 90 seconds. Friend presence and solo streak summaries are
queried in batches.

Apply additive migration `0009_multiplayer_reads_presence.sql` before activating
the updated API, and release the matching client with it. Older clients that
expect `recent` in the friends listing must be updated. No hosting changes or
persistent-event infrastructure are required. PostgreSQL-backed tests require
`TEST_DATABASE_URL`; tests use isolated schemas and never modify its public
schema. `PW_WEB_PORT`, `PW_API_PORT`, and `PW_NEXT_DIST_DIR` can isolate browser
fixtures from other development servers and builds.


### Friends hub and Add & play

Migration `0010_play_invitations.sql` adds combined invitation intent/timezone
and durable request receipts. Server startup applies it before serving requests;
roll out the server/migration before the updated web app. Existing friendships,
friend-only requests, and daily game APIs remain available.

`POST /api/me/play-invites` takes `requestId`, `inviteCode`, and `timezone`.
`POST /api/me/play-invites/:friendshipId/{accept|decline|cancel}` takes
`requestId`. A pending combined request has no duo; acceptance commits the
friendship, active duo, and first board together. Retries replay the original
response, and crossed combined requests produce one game. Codes and shared
links still require a submitted request and the other person's approval.

`GET /api/me/friends/:friendshipId` is restricted to accepted friends and returns
joined date, personal playing streak, distinct successful solo/shared words,
shared streak/best streak, total won shared boards, and the latest duo with
seven recent results across the friendship. Friend summaries add `sharedStreak`
and `playInvite`; personal collections and solo result recording are unchanged.

The Friends page lists invitations and games before accepted friends. Names
open a friend profile; Open board opens the shared game. New styles are scoped
to social pages. The home Friends badge includes incoming friendship requests
without counting a combined invitation twice.
