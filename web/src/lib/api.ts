/**
 * Typed client for the Go game API.
 *
 * The server is the source of truth for everything that matters: it holds the
 * answer, it decides whether a guess is a word, and it scores the marks. The
 * client never computes a mark itself — that would mean shipping the answer to
 * the browser, which is exactly what we are avoiding.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type Mark = "absent" | "present" | "hit";
export type Mode = "solo" | "shared";
export type RoundState = "playing" | "won" | "lost";

export interface Row {
  seat: number;
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
  title: string;
  blurb: string;
}

export interface Run {
  id: string;
  mode: Mode;
  length: number;
  started: number;
  finished: number;
  complete: boolean;
  totals: number[];
  /** Leading seat on a finished run, or -1 for a draw or one still running. */
  winner: number;
  /** Only ever present once the run is complete. */
  pack?: Pack;
}

export interface Round {
  id: string;
  mode: Mode;
  state: RoundState;
  wordLength: number;
  maxRows: number;
  seats: number;
  firstSeat: number;
  /** Whose turn it is, or -1 once the round is over. */
  turnSeat: number;
  rows: Row[];
  hintsUsed: number[];
  /** Row index the round was solved on, or -1. */
  solvedRow: number;
  scores: number[];
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
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    // A dead server and a flaky connection look identical from here, and the
    // player can act on neither, so say the one true thing.
    throw new ApiError("offline", "Can't reach the game server", 0);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(
      body?.code ?? "unknown",
      body?.message ?? `Request failed (${res.status})`,
      res.status,
    );
  }

  return res.json() as Promise<T>;
}

export function createRun(opts: {
  mode: Mode;
  excludePacks?: string[];
}): Promise<Run> {
  return request<Run>("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      mode: opts.mode,
      excludePacks: opts.excludePacks ?? [],
    }),
  });
}

/** Deals the next word of a run. */
export function startRunRound(
  runId: string,
): Promise<{ round: Round; run: Run }> {
  return request(`/api/runs/${runId}/rounds`, { method: "POST" });
}

export function createRound(opts: {
  mode: Mode;
  firstSeat?: number;
  exclude?: string[];
}): Promise<Round> {
  return request<Round>("/api/rounds", {
    method: "POST",
    body: JSON.stringify({
      mode: opts.mode,
      firstSeat: opts.firstSeat ?? 0,
      exclude: opts.exclude ?? [],
    }),
  });
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
  seat: number,
  guess: string,
): Promise<{ round: Round; run?: Run }> {
  const body = await request<Round | { round: Round; run: Run }>(
    `/api/rounds/${id}/guesses`,
    { method: "POST", body: JSON.stringify({ seat, guess }) },
  );

  return "round" in body ? body : { round: body };
}

export function useHint(
  id: string,
  seat: number,
): Promise<{ tier: number; round: Round }> {
  return request(`/api/rounds/${id}/hints`, {
    method: "POST",
    body: JSON.stringify({ seat }),
  });
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
