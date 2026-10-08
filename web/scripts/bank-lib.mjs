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

/**
 * The figures quoted in the README and shown on the about page, worked out the
 * same way the Go server's Stats does: playable answers only, retired entries
 * counted separately, the guess dictionary being the union of both word lists
 * and every answer.
 */
export async function bankFigures() {
  const bank = JSON.parse(await readFile(BANK_PATH, "utf8"));
  const live = bank.filter((w) => !w.retired);
  const count = (test) => live.filter(test).length;
  const lines = (name) => readFile(path.join(WORDS_DIR, name), "utf8").then((t) => t.split("\n").filter(Boolean));
  const guessable = new Set([...(await lines("dictionary.txt")), ...(await lines("dictionary_extra.txt")), ...bank.map((w) => w.word)]);
  const lengths = [5, 6].map((length) => {
    const here = live.filter((w) => w.word.length === length);
    return {
      length,
      total: here.length,
      familiar: here.filter((w) => w.difficulty === "familiar").length,
      stretch: here.filter((w) => w.difficulty === "stretch").length,
      challenging: here.filter((w) => w.difficulty === "challenging").length,
    };
  });
  return {
    answers: live.length,
    retired: bank.length - live.length,
    dictionary: guessable.size,
    slang: count((w) => w.register === "slang"),
    lengths,
    coverage: {
      pronunciation: count((w) => w.pronunciation),
      partOfSpeech: count((w) => w.partOfSpeech),
      origin: count((w) => w.origin),
      example: count((w) => w.example),
      exampleFromTatoeba: count((w) => w.exampleSource),
    },
  };
}
