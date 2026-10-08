import type { Run } from "./api";

export const ACTIVE_KEY = "wordle.active";
// Classic answers already played, for players with no account to hold them.
const WORDS_KEY = "wordle.words";
const LEGACY_PREFIX = ["mur", "dle."].join("");
const pendingMemory = new Map<string, string>();

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
export type GameDifficulty = "mixed" | "learning" | "hard";
export function parseDifficulty(value: unknown): GameDifficulty {
  return value === "learning" || value === "hard" ? value : "mixed";
}
export type GameConfig = { wordLength: 5 | 6; difficulty: GameDifficulty };
// The "classic" segment is from when games had a mode. Keeping it means a game
// already in progress still resumes.
export function configKey(config: GameConfig) { return `${ACTIVE_KEY}.classic.${config.wordLength}.${config.difficulty}`; }
export function activeRunFor(config: GameConfig): string | null {
  const id = readLocal(configKey(config));
  return id && /^[a-z0-9]+$/.test(id) ? id : null;
}
export function clearActiveRunFor(config: GameConfig) {
  writeLocal(configKey(config), null);
}
function pendingCreateKey(config: GameConfig) {
  return `wordle.pending.create.classic.${config.wordLength}.${config.difficulty}`;
}
function pendingNextKey(runID: string, expectedRoundID: string) {
  return `wordle.pending.next.${runID}.${expectedRoundID || "initial"}`;
}
export function pendingRunRequestFor(config: GameConfig, payload: { excludeWords: string[] } & GameConfig) {
  const key = pendingCreateKey(config);
  try {
    const inMemory = pendingMemory.get(key);
    if (inMemory) return JSON.parse(inMemory) as { requestId: string; payload: typeof payload };
    const raw = readLocal(key);
    if (raw) {
      const pending = JSON.parse(raw) as { requestId?: string; payload?: typeof payload };
      if (pending.requestId && /^[0-9a-f-]{36}$/i.test(pending.requestId) && pending.payload) {
        pendingMemory.set(key, JSON.stringify(pending));
        return pending as { requestId: string; payload: typeof payload };
      }
    }
  } catch { /* replace malformed local state with a fresh request */ }
  const pending = { requestId: crypto.randomUUID(), payload };
  pendingMemory.set(key, JSON.stringify(pending));
  writeLocal(key, JSON.stringify(pending));
  return pending;
}
export function clearPendingRunRequestFor(config: GameConfig) {
  const key = pendingCreateKey(config);
  pendingMemory.delete(key);
  writeLocal(key, null);
}
function requestIDFor(key: string): string {
  const existing = pendingMemory.get(key) ?? readLocal(key);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) {
    pendingMemory.set(key, existing);
    return existing;
  }
  const id = crypto.randomUUID();
  pendingMemory.set(key, id);
  writeLocal(key, id);
  return id;
}
export function pendingNextRoundRequestFor(runID: string, expectedRoundID: string) { return requestIDFor(pendingNextKey(runID, expectedRoundID)); }
export function clearPendingNextRoundRequestFor(runID: string, expectedRoundID: string) {
  const key = pendingNextKey(runID, expectedRoundID);
  pendingMemory.delete(key);
  writeLocal(key, null);
}
export function playedWords(): string[] {
  try {
    const value: unknown = JSON.parse(readLocal(WORDS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
export const DEFAULT_GAME_CONFIG: GameConfig = { wordLength: 5, difficulty: "mixed" };
/**
 * The saved game setup. Older saves also carried a game type; it is ignored,
 * so someone who chose Themed lands on Classic with their length and
 * vocabulary intact.
 */
export function savedGameConfig(): GameConfig {
  try {
    const saved = JSON.parse(readLocal("wordle.mode") ?? "null") as Partial<GameConfig> | null;
    if (saved && (saved.wordLength === 5 || saved.wordLength === 6)) {
      return { wordLength: saved.wordLength, difficulty: parseDifficulty(saved.difficulty) };
    }
  } catch { /* Five letters is the default when storage is unavailable or stale. */ }
  return DEFAULT_GAME_CONFIG;
}
/** Forgets what the removed themed mode left in storage. */
export function clearRetiredKeys() {
  try {
    const stale = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && (key === "wordle.packs" || key === ACTIVE_KEY || key.startsWith(`${ACTIVE_KEY}.themed.`) || key.startsWith("wordle.pending.create.themed."))) stale.push(key);
    }
    stale.forEach((key) => window.localStorage.removeItem(key));
  } catch { /* Nothing to clean when storage is blocked. */ }
}
export function rememberRun(run: Run, config: GameConfig) {
  writeLocal(configKey(config), run.id);
  // A Classic run is one word; once it is over the answer is known and goes on
  // the list the next deal avoids. A new cycle means the pool was spent, so the
  // list starts again rather than excluding everything forever.
  if (run.complete) {
    const answers = run.completedWords.map((r) => r.answer).filter((a): a is string => !!a);
    const seen = run.newCycle ? [] : playedWords();
    writeLocal(WORDS_KEY, JSON.stringify([...new Set([...seen, ...answers])]));
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
