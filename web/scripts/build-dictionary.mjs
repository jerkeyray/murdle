/**
 * Regenerates the guess dictionary embedded in the Go server.
 *
 * The guess list is deliberately permissive: its only job is to decide whether
 * something a player typed is a real word. The curated answer list is a
 * separate, much smaller file.
 *
 * Source is the `word-list` package, which ships SCOWL — the corpus behind
 * aspell and hunspell. It replaced macOS's /usr/share/dict/words (Webster's
 * Second International, 1934), which was a headword list: it had "call" but
 * not "calls", "woman" but not "women", and rejected 3.7% of ordinary words
 * while accepting 1934 curiosities like "aalii".
 *
 * Run with: pnpm dictionary
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import wordListPath from "word-list";

const WORD_LENGTH = 5;
const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "server",
  "internal",
  "words",
  "dictionary.txt",
);

const raw = await readFile(wordListPath, "utf8");

const words = [
  ...new Set(
    raw
      .split("\n")
      .map((w) => w.trim().toLowerCase())
      // Plain a-z only: no proper nouns, accents, apostrophes or hyphens,
      // none of which the keyboard can produce.
      .filter((w) => new RegExp(`^[a-z]{${WORD_LENGTH}}$`).test(w)),
  ),
].sort();

await writeFile(OUT, words.join("\n") + "\n");
console.log(`wrote ${words.length} ${WORD_LENGTH}-letter words to ${OUT}`);
