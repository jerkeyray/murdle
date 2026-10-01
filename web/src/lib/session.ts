import type { Run } from "./api";

export const ACTIVE_KEY = "wordle.active";
const PACKS_KEY = "wordle.packs";
const LEGACY_PREFIX = ["mur", "dle."].join("");

export function readLocal(key: string): string | null {
  try {
    const current = window.localStorage.getItem(key);
    if (current !== null || !key.startsWith("wordle.")) return current;

    const legacyKey = LEGACY_PREFIX + key.slice("wordle.".length);
    const legacy = window.localStorage.getItem(legacyKey);
    if (legacy !== null) {
      window.localStorage.setItem(key, legacy);
      window.localStorage.removeItem(legacyKey);
    }
    return legacy;
  } catch { return null; }
}
export function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    window.dispatchEvent(new Event("wordle-storage"));
  } catch { /* Playing is available even when storage is blocked. */ }
}
export function activeRun(): string | null {
  const id = readLocal(ACTIVE_KEY);
  return id && /^[a-z0-9]+$/.test(id) ? id : null;
}
export function playedPacks(): string[] {
  try {
    const value: unknown = JSON.parse(readLocal(PACKS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
export function rememberRun(run: Run) {
  writeLocal(ACTIVE_KEY, run.id);
  if (run.complete && run.pack) {
    const seen = run.newCycle ? [] : playedPacks();
    writeLocal(PACKS_KEY, JSON.stringify([...new Set([...seen, run.pack.id])]));
  }
}
export function subscribeSession(fn: () => void) {
  window.addEventListener("storage", fn);
  window.addEventListener("wordle-storage", fn);
  return () => {
    window.removeEventListener("storage", fn);
    window.removeEventListener("wordle-storage", fn);
  };
}
