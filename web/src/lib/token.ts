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
import { waitForSignal } from "./cancellation";

let cached: { token: string | null; until: number } | null = null;

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

// How long a definite "no session" is believed. Without this a signed-out
// player paid a full round trip to the auth endpoint before every request —
// every guess included — just to hear "no" again. Signing in always arrives by
// a full-page redirect, which starts this module fresh, so the only cost is a
// sign-in in another tab taking a couple of minutes to be noticed here.
const SIGNED_OUT_MS = 2 * 60 * 1000;

export function getToken(signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (cached && Date.now() < cached.until) return Promise.resolve(cached.token);
  if (!inFlight) {
    const flight = fetchToken().finally(() => { if (inFlight === flight) inFlight = null; });
    inFlight = flight;
  }
  return waitForSignal(inFlight, signal);
}

async function fetchToken(signal?: AbortSignal): Promise<string | null> {
  try {
    const timeout = AbortSignal.timeout(20_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const res = await fetch("/api/auth/token", { credentials: "include", signal: requestSignal });
    if (res.status === 401) {
      cached = { token: null, until: Date.now() + SIGNED_OUT_MS };
      return null;
    }
    // Anything else that fails is not an answer about the session, so it is not
    // remembered: a blip must not leave someone signed out for two minutes.
    if (!res.ok) {
      cached = null;
      throw new Error("Could not load the session");
    }

    const body = (await res.json()) as { token?: string };
    if (!body.token) {
      cached = null;
      return null;
    }

    cached = { token: body.token, until: Date.now() + LIFETIME_MS };
    return body.token;
  } catch (err) {
    cached = null;
    if (signal?.aborted) throw signal.reason ?? new DOMException("Request cancelled", "AbortError");
    if (err instanceof DOMException && err.name === "TimeoutError") throw err;
    throw err;
  }
}

/** Drops the cached token, so the next call re-reads the session. */
export function clearToken() {
  cached = null;
  inFlight = null;
}
