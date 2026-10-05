/**
 * Princeton WordNet 3.1 (via the wordnet-db package), shaped like the
 * Wiktionary records so pickSense can score both the same way.
 *
 * WordNet is the fallback: its usage examples are short and modern where
 * Wiktionary's are often dated quotations, and every synset has one clear
 * part of speech.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const POS = { n: "noun", v: "verb", a: "adj", s: "adj", r: "adv" };

/** Map of lemma -> records, for the given words only. */
export async function loadWordNet(words) {
  const dir = path.dirname(createRequire(import.meta.url).resolve("wordnet-db/package.json"));
  const out = new Map();
  for (const file of ["noun", "verb", "adj", "adv"]) {
    const text = await readFile(path.join(dir, "dict", `data.${file}`), "utf8");
    for (const line of text.split("\n")) {
      if (!line || line.startsWith("  ")) continue; // licence header
      const [head, rest = ""] = line.split(" | ");
      const parts = head.split(" ");
      const pos = POS[parts[2]];
      const count = parseInt(parts[3], 16);
      // Adjective lemmas can carry a position marker, as in "galore(ip)".
      const lemmas = Array.from({ length: count }, (_, i) => parts[4 + 2 * i].replace(/\(\w+\)$/, "").toLowerCase());
      const examples = [...rest.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim());
      const gloss = rest.split(/;\s*"/)[0].trim();
      for (const lemma of lemmas) {
        if (!words.has(lemma)) continue;
        if (!out.has(lemma)) out.set(lemma, []);
        out.get(lemma).push({ word: lemma, pos, senses: [{ glosses: [gloss], examples }] });
      }
    }
  }
  return out;
}

/**
 * WordNet examples are fragments as often as sentences ("abate the noise").
 * Keep the ones long enough to show the word in use, and give them a capital
 * and a full stop so they sit alongside Wiktionary's.
 */
export function wordNetExample(sense, word) {
  const x = (sense.examples ?? []).find((e) => e.split(/\s+/).length >= 4 && e.length <= 140 && e.toLowerCase().includes(word.slice(0, 3)));
  if (!x) return undefined;
  const s = x[0].toUpperCase() + x.slice(1);
  return /[.!?]$/.test(s) ? s : s + ".";
}
