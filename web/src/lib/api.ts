import type { CollectionPage, Duo, DuoMutation, FriendRecord, HomeSummary, Mark, Profile, Round, Row, Run } from "./contracts";
export type { Mark, RoundState, Row, Entry, Pack, Run, Round, Profile, HomeSummary, SolveRecord, CollectionPage, FriendRecord, DuoDay, Duo, DuoMutation } from "./contracts";

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

async function request<T>(path: string, init?: RequestInit, retry = 0): Promise<T> {
  // Signing in is optional. A token makes the round count towards your
  // history; without one you still get a perfectly good game.
  let token: string | null;
  try {
    token = await getToken(init?.signal ?? undefined);
  } catch (err) {
    if (init?.signal?.aborted) throw init.signal.reason ?? new DOMException("Request cancelled", "AbortError");
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError("timeout", "The request took too long. Please try again.", 0);
    }
    throw new ApiError("offline", "Can't reach the game server", 0);
  }

  let res: Response | undefined;
  for (let attempt = 0; attempt <= retry; attempt++) {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(init?.signal?.reason);
    if (init?.signal?.aborted) abortFromCaller();
    else init?.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = window.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), 20_000);
    try {
      res = await fetch(`${API_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Wordle-Date": localDate(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init?.headers,
        },
      });
      break;
    } catch {
      if (init?.signal?.aborted) throw init.signal.reason ?? new DOMException("Request cancelled", "AbortError");
      if (controller.signal.aborted) throw new ApiError("timeout", "The request took too long. Please try again.", 0);
      if (attempt === retry) throw new ApiError("offline", "Can't reach the game server", 0);
      await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
    } finally {
      window.clearTimeout(timer);
      init?.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  if (!res) throw new ApiError("offline", "Can't reach the game server", 0);

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

export function createRun(opts: { requestId: string; excludePacks?: string[]; excludeWords?: string[]; mode?: "classic" | "themed"; wordLength?: 5 | 6; difficulty?: "mixed" | "learning" }): Promise<{ round: Round; run: Run }> {
  return request<{ round: Round; run: Run }>("/api/runs?deal=1", {
    method: "POST",
    body: JSON.stringify({ excludePacks: opts.excludePacks ?? [], excludeWords: opts.excludeWords ?? [], mode: opts.mode, wordLength: opts.wordLength, difficulty: opts.difficulty, requestId: opts.requestId }),
  }, 2);
}

export const getRun = (id: string) => request<Run>(`/api/runs/${id}`);

/** Deals the next word of a run. */
export function startRunRound(
  runId: string,
  expectedRoundId: string,
  requestId: string,
): Promise<{ round: Round; run: Run }> {
  return request(`/api/runs/${runId}/rounds`, {
    method: "POST",
    body: JSON.stringify({ expectedRoundId, requestId }),
  }, 2);
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
    { method: "POST", body: JSON.stringify({ guess, requestId: crypto.randomUUID() }) },
    2,
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

export const getCapabilities = (signal?:AbortSignal) => request<{ sharedGames: boolean }>("/api/capabilities",{signal});
export const getDuos = (signal?:AbortSignal) => request<Duo[]>("/api/me/duos",{signal});
export const getDuo = (id: string, date = "today", signal?:AbortSignal) => request<Duo>(`/api/duos/${id}/days/${date}`,{signal});
export const heartbeat = (signal?:AbortSignal) => request<void>("/api/me/presence", { method: "POST",signal });
export const inviteDuo = (mutation: DuoMutation) => request<Duo>("/api/me/duos", { method: "POST", body: JSON.stringify(mutation) });
export const mutateDuo = (id: string, action: "accept" | "decline" | "cancel" | "end" | "next" | "guesses" | "pass" | "hint", mutation: DuoMutation, date?: string) =>
  request<Duo>(`/api/duos/${id}/${date ? `days/${date}/` : ""}${action}`, { method: "POST", body: JSON.stringify(mutation) });

export const getProfile = (signal?:AbortSignal) => request<Profile>("/api/me",{signal});
export const getHomeSummary = () => request<HomeSummary>("/api/me/home");

export const setDisplayName = (name: string) =>
  request<{ displayName: string }>("/api/me/name", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
function collectionQuery(options: {limit?:number;cursor?:string;q?:string;length?:number}) {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit",String(options.limit));
  if (options.cursor) params.set("cursor",options.cursor);
  if (options.q) params.set("q",options.q);
  if (options.length) params.set("length",String(options.length));
  return params.size ? `?${params}` : "";
}
export const getSolves = (options: {limit?:number;cursor?:string;q?:string;length?:number} = {}) => request<CollectionPage>(`/api/me/solves${collectionQuery(options)}`);
export const getSavedWords = (options: {limit?:number;cursor?:string;q?:string;length?:number} = {}) => request<CollectionPage>(`/api/me/saved${collectionQuery(options)}`);
export const getSavedStatus = (word:string) => request<{saved:boolean}>(`/api/me/saved/status/${encodeURIComponent(word)}`);
export const getFriends = (signal?:AbortSignal) => request<FriendRecord[]>("/api/me/friends",{signal});

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
