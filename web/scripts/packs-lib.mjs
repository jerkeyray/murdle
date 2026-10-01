/**
 * Shared pieces of the pack pipeline: paths, the schema, and the hard gates
 * that run before and after the model.
 *
 * The gates matter more than the prompt. A model asked for five-letter words
 * will hand back six-letter ones often enough that trusting it is not an
 * option, and a word the game serves but the dictionary rejects would be the
 * worst bug this game has.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WORDS_DIR = path.join(HERE, "..", "..", "server", "internal", "words");
export const PACKS_PATH = path.join(WORDS_DIR, "packs.json");
export const PENDING_PATH = path.join(WORDS_DIR, "packs.pending.json");
export const DICTIONARY_PATH = path.join(WORDS_DIR, "dictionary.txt");

export const WORDS_PER_PACK = 5;
export const WORD_LENGTH = 5;

export const packWordSchema = z.object({
  word: z.string().describe("Exactly five letters, lowercase a-z only."),
  register: z.enum(["standard", "slang"]),
  difficulty: z.enum(["familiar", "stretch", "challenging"]),
  hints: z.array(z.string().min(12)).length(2).describe("Two separately authored clues: broad context, then a narrower association. No answer text, letters, positions, direct definitions, or pack theme."),
  connection: z.string().min(15).describe("Explain precisely how this word fits the final connection. Revealed only after the run."),
  definition: z
    .string()
    .describe("One short sentence. Plain, and a little dry."),
  note: z
    .string()
    .describe(
      "Two or three sentences on where the word came from or what it used to mean. " +
        "The part worth reading. Must be factually true — no invented etymology.",
    ),
});

export const packSchema = z.object({
  id: z.string().describe("kebab-case slug."),
  title: z.string().describe("Two or three words. The theme, revealed at the end."),
  connectionDifficulty: z.enum(["easy", "medium", "hard"]),
  legacyTitles: z.array(z.string()).optional(),
  blurb: z.string().describe("One line. Dry, funny, no exclamation marks."),
  words: z.array(packWordSchema).length(WORDS_PER_PACK),
});

export async function loadJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

export async function loadDictionary() {
  const raw = await readFile(DICTIONARY_PATH, "utf8");
  return new Set(raw.split("\n").map((w) => w.trim()).filter(Boolean));
}

/**
 * Words we will not serve regardless of what the model says. Kept as whole
 * words rather than substrings — substring matching on a five-letter word list
 * produces more false positives than it prevents.
 */
const BLOCKLIST = new Set(["rapes", "nazis", "kikes", "spics", "chink", "wetba"]);

/**
 * Checks a pack against everything that must be true before a player sees it.
 *
 * Returns a list of problems; empty means it passed. Slang is allowed to be
 * absent from the dictionary — it usually is, and the Go pool folds pack words
 * into the guess list at load time — but a word claiming to be standard and
 * missing from the dictionary is a sign the model invented it.
 */
export function checkPack(pack, { dictionary, existingWords, existingIds }) {
  const problems = [];
  const parsed = packSchema.safeParse(pack);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const seen = new Set();

  if (!/^[a-z0-9-]+$/.test(pack.id)) {
    problems.push(`id "${pack.id}" is not a kebab-case slug`);
  }
  if (existingIds.has(pack.id)) {
    problems.push(`id "${pack.id}" already exists`);
  }
  if (pack.words.length !== WORDS_PER_PACK) {
    problems.push(`has ${pack.words.length} words, want ${WORDS_PER_PACK}`);
  }

  for (const entry of pack.words) {
    const w = entry.word?.toLowerCase().trim() ?? "";

    if (!new RegExp(`^[a-z]{${WORD_LENGTH}}$`).test(w)) {
      problems.push(`"${w}" is not ${WORD_LENGTH} lowercase letters`);
      continue;
    }
    if (BLOCKLIST.has(w)) {
      problems.push(`"${w}" is on the blocklist`);
    }
    if (seen.has(w)) {
      problems.push(`"${w}" appears twice in this pack`);
    }
    seen.add(w);

    if (existingWords.has(w)) {
      problems.push(`"${w}" is already in another pack`);
    }
    if (entry.register === "standard" && !dictionary.has(w)) {
      problems.push(
        `"${w}" is marked standard but is not in the dictionary — likely invented`,
      );
    }
    if (!entry.definition?.trim()) problems.push(`"${w}" has no definition`);
    if (!entry.note?.trim()) problems.push(`"${w}" has no note`);
    if (entry.hints[0].trim() === entry.hints[1].trim()) problems.push(`"${w}" repeats its hint`);
    for (const hint of entry.hints) {
      if (hint.toLowerCase().includes(w)) problems.push(`"${w}" appears in its own hint`);
      if (/\b(first|last|second|third|fourth|fifth) letter|\b(starts|ends) with\b/i.test(hint)) problems.push(`"${w}" has a structural giveaway`);
    }
  }

  return problems;
}

/** Every word already committed to a pack, so themes never repeat one. */
export function wordsIn(packs) {
  return new Set(packs.flatMap((p) => p.words.map((w) => w.word)));
}
