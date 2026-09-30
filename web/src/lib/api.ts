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

export function submitGuess(
  id: string,
  seat: number,
  guess: string,
): Promise<Round> {
  return request<Round>(`/api/rounds/${id}/guesses`, {
    method: "POST",
    body: JSON.stringify({ seat, guess }),
  });
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
