"use client";

/**
 * Fetches the JWT that the Go API verifies.
 *
 * Better Auth keeps the session in an httpOnly cookie, which the Go API on a
 * different origin cannot read. /api/auth/token exchanges that cookie for a
 * short-lived JWT, which we send as a bearer token instead.
 *
 * Cached in memory only. Putting it in localStorage would trade the one real
 * security property of an httpOnly session — that a script cannot read it —
 * for saving a request every few minutes.
 */
let cached: { token: string; until: number } | null = null;

/**
 * The fetch currently in flight, if any.
 *
 * Caching only the result is not enough: the profile screen asks for four
 * things at once, and each would start its own token request before the first
 * one resolved. Callers share the in-flight promise instead.
 */
let inFlight: Promise<string | null> | null = null;

// Refreshed well before it expires; a request that fails on a stale token is a
// much worse trade than an occasional extra fetch.
const LIFETIME_MS = 4 * 60 * 1000;

export function getToken(): Promise<string | null> {
  if (cached && Date.now() < cached.until) return Promise.resolve(cached.token);
  if (inFlight) return inFlight;

  inFlight = fetchToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function fetchToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/token", { credentials: "include" });
    if (!res.ok) {
      cached = null;
      return null;
    }

    const body = (await res.json()) as { token?: string };
    if (!body.token) {
      cached = null;
      return null;
    }

    cached = { token: body.token, until: Date.now() + LIFETIME_MS };
    return body.token;
  } catch {
    cached = null;
    return null;
  }
}

/** Drops the cached token, so the next call re-reads the session. */
export function clearToken() {
  cached = null;
  inFlight = null;
}
