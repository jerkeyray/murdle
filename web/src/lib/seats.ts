"use client";

import type { Mode } from "@/lib/api";

/**
 * Who is sitting where, for a shared board.
 *
 * Kept on the device rather than in the database on purpose: this is two
 * people and one phone, and needing an account each before you can pass it
 * back and forth would ruin the thing it is for.
 */
export interface Seats {
  names: [string, string];
}

const KEY = "murdle.seats";
const DEFAULTS: Seats = { names: ["You", "Her"] };

export function loadSeats(): Seats {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Seats>;
    const [a, b] = parsed.names ?? [];
    return { names: [a?.trim() || DEFAULTS.names[0], b?.trim() || DEFAULTS.names[1]] };
  } catch {
    return DEFAULTS;
  }
}

const listeners = new Set<() => void>();

export function saveSeats(seats: Seats) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(seats));
  } catch {
    /* private mode; the names just will not be remembered */
  }
  cached = seats;
  for (const listener of listeners) listener();
}

/**
 * localStorage read through useSyncExternalStore rather than copied into state
 * by an effect, which is the pattern that hook exists to replace.
 *
 * The snapshot has to be cached: getSnapshot must return a stable reference
 * between changes, and parsing the JSON afresh each call would hand React a
 * new object every render and spin forever.
 */
let cached: Seats | null = null;

export function subscribeSeats(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSeats(): Seats {
  cached ??= loadSeats();
  return cached;
}

/** Server render and hydration see the defaults; the real names arrive right
 *  after, which is what useSyncExternalStore is for. */
export function getServerSeats(): Seats {
  return DEFAULTS;
}

/** Narrows a route segment to a mode, so a bad URL cannot reach the API. */
export function parseMode(raw: string | undefined): Mode | null {
  return raw === "solo" || raw === "shared" ? raw : null;
}
