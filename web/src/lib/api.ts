/**
 * Typed client for the Go game API.
 *
 * The server is the source of truth for everything that matters: it holds the
 * answer, it decides whether a guess is a word, and it scores the marks. The
 * client never computes a mark itself — that would mean shipping the answer to
 * the browser, which is exactly what we are avoiding.
 */

import { clearToken, getToken } from "@/lib/token";

/**
 * Where the Go API lives.
 *
 * In production it is a service in the same Vercel project, reached through
 * the rewrites in vercel.json — so the right answer is the empty string, and
 * every request goes to the origin it was served from. That also means a
 * preview deployment calls its own API rather than production's.
 *
 * Defaulting rather than requiring an environment variable is deliberate: a
 * stale NEXT_PUBLIC_API_URL pointing at a host that does not exist is a
 * failure that only shows up when someone presses Play, and it reads as the
 * app being broken rather than as a setting being wrong.
 *
 * Local development is the exception, because the two run as separate
 * processes on different ports.
 */
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:8080");

/**
 * The player's own calendar date.
 *
 * A streak is a question about their day, not the server's — just after
 * midnight in Delhi it is still yesterday in UTC — so the client, which is the
 * only thing that knows what day it is where the phone is, says so.
 */
function localDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export type Mark = "absent" | "present" | "hit";
export type RoundState = "playing" | "won" | "lost";

export interface Row {
  guess: string;
  marks: Mark[];
}

/** What the round taught you. Present only once the round is over. */
export interface Entry {
  word: string;
  register: "standard" | "slang";
  definition: string;
  note: string;
}

/** The theme reveal. Present only on a completed run. */
export interface Pack {
  id: string;
  connections: { word: string; explanation: string }[];
  title: string;
  blurb: string;
}

export interface Run {
  id: string;
  /** Words in the run. */
  length: number;
  started: number;
  currentRoundId?: string;
  completedWords: Round[];
  newCycle: boolean;
  finished: number;
  complete: boolean;
  points: number;
  /** Only ever present once the run is complete. */
  pack?: Pack;
}

export interface Round {
  id: string;
  state: RoundState;
  wordLength: number;
  maxRows: number;
  rows: Row[];
  hintsUsed: number;
  hints: { tier: number; text: string }[];
  /** Row index the board was solved on, or -1. */
  solvedRow: number;
  points: number;
  /** Only ever present once the round has finished. */
  answer?: string;
  /** Rides along with `answer`, for the same reason. */
  entry?: Entry;
}

/**
 * An error the player caused and can do something about — a short guess, a
 * non-word, a tap out of turn. `code` matches the server's error codes so the
 * UI can branch without string-matching prose.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly current?: Duo,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Signing in is optional. A token makes the round count towards your
  // history; without one you still get a perfectly good game.
  const token = await getToken();

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Wordle-Date": localDate(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // A dead server and a flaky connection look identical from here, and the
    // player can act on neither, so say the one true thing.
    throw new ApiError("offline", "Can't reach the game server", 0);
  }

  if (!res.ok) {
    if (res.status === 401) clearToken();
    const body = await res.json().catch(() => null);
    throw new ApiError(
      body?.code ?? "unknown",
      body?.message ?? `Request failed (${res.status})`,
      res.status,
      body?.current,
    );
  }

  // Saving a word and answering a friend request both reply 204 with no body,
  // and res.json() throws on an empty one.
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export function createRun(opts: { excludePacks?: string[] } = {}): Promise<Run> {
  return request<Run>("/api/runs", {
    method: "POST",
    body: JSON.stringify({ excludePacks: opts.excludePacks ?? [] }),
  });
}

export const getRun = (id: string) => request<Run>(`/api/runs/${id}`);

/** Deals the next word of a run. */
export function startRunRound(
  runId: string,
): Promise<{ round: Round; run: Run }> {
  return request(`/api/runs/${runId}/rounds`, { method: "POST" });
}

export function getRound(id: string): Promise<Round> {
  return request<Round>(`/api/rounds/${id}`);
}

/**
 * Submits a guess.
 *
 * The server answers with a bare round normally, and with `{ round, run }` on
 * the guess that ends a round inside a run — that is when the run totals
 * change, and when a final round makes the theme available.
 */
export async function submitGuess(
  id: string,
  guess: string,
): Promise<{ round: Round; run?: Run }> {
  const body = await request<Round | { round: Round; run: Run }>(
    `/api/rounds/${id}/guesses`,
    { method: "POST", body: JSON.stringify({ guess }) },
  );

  return "round" in body ? body : { round: body };
}

/** Requests an explicit authored tier; repeating it does not consume another hint. */
export function revealHint(
  id: string, tier: number,
): Promise<{ tier: number; text: string; round: Round }> {
  return request(`/api/rounds/${id}/hints`, { method: "POST", body: JSON.stringify({ tier }) });
}

/**
 * Best-known state per letter, for colouring the keyboard.
 *
 * A letter only ever improves: once you have seen it as a hit somewhere, a
 * later row marking that same letter absent (because a duplicate ran out of
 * budget) must not downgrade the key.
 */
const MARK_RANK: Record<Mark, number> = { absent: 0, present: 1, hit: 2 };

export function letterStates(rows: Row[]): Record<string, Mark> {
  const states: Record<string, Mark> = {};

  for (const row of rows) {
    row.guess.split("").forEach((letter, i) => {
      const mark = row.marks[i];
      const current = states[letter];
      if (!current || MARK_RANK[mark] > MARK_RANK[current]) {
        states[letter] = mark;
      }
    });
  }

  return states;
}

/* --------------------------------------------------------------------------
   Profile, collection and friends. All require a signed-in player.
   -------------------------------------------------------------------------- */

export interface Profile {
  displayName: string;
  /** True until a nickname has been chosen. */
  needsName: boolean;
  seatColor: string;
  /** Short code a friend types to find you. */
  inviteCode: string;
  streak: { current: number; longest: number; playedToday: boolean };
  wordsLearned: number;
}

export interface SolveRecord {
  word: string;
  packId: string;
  solved: boolean;
  solvedRow: number | null;
  guesses: number;
  points: number;
  playedOn: string;
  entry?: Entry;
}

export interface FriendRecord {
  id: string;
  displayName: string;
  status: "pending" | "accepted" | "blocked";
  /** True when they asked you, which is what decides accept versus waiting. */
  incoming: boolean;
  online: boolean;
  dayStreak: number;
}

export interface DuoDay {
  duoId: string;
  /** The rules, as the server holds them — never a second copy in the UI. */
  wordLength: number;
  maxRows: number;
  date: string;
  deadline: string;
  state: "playing" | "won" | "lost" | "expired" | "closed";
  currentPlayer: string;
  version: number;
  rows: (Row & { playerId: string })[];
  passed: string[];
  streak: number;
  answer?: string;
  entry?: Entry;
}
export interface Duo {
  id: string;
  friendshipId: string;
  inviterId: string;
  viewerId: string;
  members: { id: string; name: string }[];
  timezone: string;
  status: "pending" | "active" | "declined" | "cancelled" | "ended";
  version: number;
  today?: DuoDay;
  recent: DuoDay[];
}
export interface DuoMutation {
  requestId: string;
  version: number;
  guess?: string;
  friendshipId?: string;
  timezone?: string;
}
export const getCapabilities = () => request<{ sharedGames: boolean }>("/api/capabilities");
export const getDuos = () => request<Duo[]>("/api/me/duos");
export const getDuo = (id: string, date = "today") => request<Duo>(`/api/duos/${id}/days/${date}`);
export const heartbeat = () => request<void>("/api/me/presence", { method: "POST" });
export const inviteDuo = (mutation: DuoMutation) => request<Duo>("/api/me/duos", { method: "POST", body: JSON.stringify(mutation) });
export const mutateDuo = (id: string, action: "accept" | "decline" | "cancel" | "end" | "guesses" | "pass", mutation: DuoMutation, date?: string) =>
  request<Duo>(`/api/duos/${id}/${date ? `days/${date}/` : ""}${action}`, { method: "POST", body: JSON.stringify(mutation) });

export const getProfile = () => request<Profile>("/api/me");

export const setDisplayName = (name: string) =>
  request<{ displayName: string }>("/api/me/name", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
export const getSolves = () => request<SolveRecord[]>("/api/me/solves");
export const getSavedWords = () => request<SolveRecord[]>("/api/me/saved");
export const getFriends = () => request<FriendRecord[]>("/api/me/friends");

export async function setWordSaved(word: string, saved: boolean): Promise<void> {
  await request<void>(`/api/me/saved/${word}`, {
    method: saved ? "PUT" : "DELETE",
  });
}

export const addFriend = (inviteCode: string) =>
  request<FriendRecord>("/api/me/friends", {
    method: "POST",
    body: JSON.stringify({ inviteCode }),
  });

export async function respondToFriend(id: string, accept: boolean): Promise<void> {
  await request<void>(`/api/me/friends/${id}/respond`, {
    method: "POST",
    body: JSON.stringify({ accept }),
  });
}
