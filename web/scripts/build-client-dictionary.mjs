/**
 * Mirrors the server's guess list into web/public, so the keyboard can tell a
 * player whether a word counts before they submit it.
 *
 * Built from the Go server's own files rather than from the corpus, because
 * the server's effective dictionary is dictionary.txt plus every pack word:
 * slang often predates the corpora, and a word the game deals has to be
 * typeable. Generating from anything else would let the two lists disagree.
 *
 * The server stays the authority. This copy only decides how the Enter key
 * looks, never whether a guess may be sent, so a stale copy costs a hint and
 * not a move.
 *
 * Run with: pnpm dictionary
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const WORDS_DIR = path.join(here, "..", "..", "server", "internal", "words");
const OUT = path.join(here, "..", "public", "dictionary.txt");

const dictionary = await readFile(path.join(WORDS_DIR, "dictionary.txt"), "utf8");
const dictionaryExtra = await readFile(path.join(WORDS_DIR, "dictionary_extra.txt"), "utf8");
const packs = JSON.parse(await readFile(path.join(WORDS_DIR, "packs.json"), "utf8"));

const words = [
  ...new Set([
    ...dictionary.split("\n").map((w) => w.trim()).filter(Boolean),
    ...dictionaryExtra.split("\n").map((w) => w.trim()).filter(Boolean),
    ...packs.flatMap((p) => p.words.map((w) => w.word)),
  ]),
].sort();

await writeFile(OUT, words.join("\n") + "\n");
console.log(`wrote ${words.length} words to ${path.relative(process.cwd(), OUT)}`);
