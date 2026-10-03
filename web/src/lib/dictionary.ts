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
// Keep feedback aligned with the server’s uncensored supplement. The server
// remains authoritative, so a full draft is always still submittable.
const BROAD_GUESSES = ["rapes", "raped", "rapist", "sexing", "sexual", "slangs", "slangy", "swears", "swore", "curse", "cursed", "curses", "damned", "damnit", "fucked", "fucker", "fucks", "shitty", "shit", "asshole", "bastard", "queers", "queer", "dykes", "dyke", "whored", "whores", "whore", "nudity", "nudes", "naked", "genital", "genitals"];
const SIX_LETTER_ANSWERS = "comets aurora nebula planet meteor chorus melody rhythm encore actors beacon harbor sailor voyage island author volume leafed margin phrase petals shovel trowel seeded pruned frosty flurry winter icicle sleigh pillow kettle drawer carpet window street subway market museum arcade ticket engine travel detour tarmac recipe ladles simmer pepper saucer breeze cloudy stormy sunset melted beetle weevil rabbit otters insect hammer chisel sawing sander planer reason debate proofs listen assent sports league racket umpire medals yellow orange violet indigo sienna minute second season spring autumn friend family smiles voices kindly meadow valley forest summit canyon weaver potter sketch writer design".split(" ");
let loading: Promise<Set<string> | null> | null = null;
const listeners = new Set<() => void>();

async function fetchWords(): Promise<Set<string> | null> {
  try {
    const res = await fetch("/dictionary.txt");
    if (!res.ok) return null;
    const text = await res.text();
    return new Set([...text.split("\n").map((w) => w.trim()).filter(Boolean), ...BROAD_GUESSES, ...SIX_LETTER_ANSWERS]);
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
