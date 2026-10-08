/**
 * Shared pieces of the answer-bank pipeline: where the word files live, and the
 * checks that mirror the Go validator so a bad clue is caught while editing
 * rather than as a startup panic.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WORDS_DIR = path.join(HERE, "..", "..", "server", "internal", "words");
export const BANK_PATH = path.join(WORDS_DIR, "classic.json");
export const DICTIONARY_PATH = path.join(WORDS_DIR, "dictionary.txt");

export async function loadDictionary() {
  const raw = await readFile(DICTIONARY_PATH, "utf8");
  return new Set(raw.split("\n").map((w) => w.trim()).filter(Boolean));
}

const normalizeHint = (s) => s.toLowerCase().replace(/[^a-z]+/g, " ").trim();

/**
 * Mirrors hintProblem in server/internal/words/classic.go: a clue must not
 * share the answer's first four letters with any word, nor restate the
 * definition, or it announces the answer instead of nudging toward it.
 */
export function hintProblem(word, definition, hint) {
  const h = normalizeHint(hint);
  const d = normalizeHint(definition);
  if (h.split(" ").some((token) => token.startsWith(word.slice(0, 4)))) return "has a hint that shares its root";
  if (d && (h.includes(d) || (d.includes(h) && h.length * 5 >= d.length * 3))) return "has a hint that restates the definition";
  return "";
}
