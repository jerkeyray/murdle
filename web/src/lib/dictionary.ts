"use client";

/**
 * A copy of the guess list, used only to tell the player whether what they
 * have typed is a word before they send it.
 *
 * The server remains the authority on every guess. This is deliberately
 * advisory: if the list has not arrived, or has drifted from the server's,
 * the keyboard falls back to "looks submittable" rather than refusing. A
 * player must never be blocked from sending a guess the server would accept.
 *
 * Fetched once, lazily, and cached by the browser. It is about 31KB over the
 * wire, which is cheaper than it looks for a page people reopen daily, and it
 * is never on the path that puts the board on screen.
 */
let words: Set<string> | null = null;
let loading: Promise<Set<string> | null> | null = null;
const listeners = new Set<() => void>();

async function fetchWords(): Promise<Set<string> | null> {
  try {
    const res = await fetch("/dictionary.txt");
    if (!res.ok) return null;
    const text = await res.text();
    return new Set(text.split("\n").map((w) => w.trim()).filter(Boolean));
  } catch {
    // Offline, blocked, or missing. The Enter key simply stops predicting.
    return null;
  }
}

/** Starts the download if it has not started. Safe to call repeatedly. */
export function loadDictionary(): void {
  if (words || loading) return;
  loading = fetchWords().then((set) => {
    words = set;
    loading = null;
    for (const fn of listeners) fn();
    return set;
  });
}

/**
 * Whether the word is known to be valid.
 *
 * Returns null when there is no opinion — the list has not loaded — which
 * callers must treat as "allow", not as "reject".
 */
export function isKnownWord(word: string): boolean | null {
  if (!words) return null;
  return words.has(word.toLowerCase());
}

/** Whether an opinion is available yet. Snapshot for useSyncExternalStore. */
export function dictionaryReady(): boolean {
  return words !== null;
}

/** The server renders before any fetch has happened. */
export function serverDictionaryReady(): boolean {
  return false;
}

export function subscribeDictionary(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
