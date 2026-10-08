/**
 * Builds the list of words worth adding to the answer bank next.
 *
 * A candidate is a five- or six-letter guess-dictionary word that WordNet knows
 * as a common word (not only as a capitalised name), is not already an answer,
 * and is not just an inflected form of a word we could use instead. Each is
 * ranked by how often it turns up in Tatoeba's English sentences, which is a
 * rough but cheap stand-in for how familiar it is:
 *
 *   50+ uses   familiar    (everyday; low priority, the bank has plenty)
 *   10-49      stretch
 *   1-9        challenging
 *   0          rare        (often archaic or technical; needs a human look)
 *
 *   node scripts/candidates.mjs            writes scripts/data/candidates.json
 *   node scripts/candidates.mjs --report   prints counts only
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { BANK_PATH, loadDictionary } from "./bank-lib.mjs";

const OUT = new URL("data/candidates.json", import.meta.url);
const TATOEBA = new URL("data/tatoeba.tsv", import.meta.url);
const POS = { n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb" };

const dictionary = await loadDictionary();
const bank = new Set(JSON.parse(await readFile(BANK_PATH, "utf8")).map((w) => w.word));
const wanted = (w) => /^[a-z]{5,6}$/.test(w) && dictionary.has(w) && !bank.has(w);

// lemma -> { pos: Set, senses, common } from the WordNet data files. `common`
// is true if any sense is written in lower case, which separates "nile" the
// place from "pilot" the word.
const dir = path.join(path.dirname(createRequire(import.meta.url).resolve("wordnet-db/package.json")), "dict");
const lemmas = new Map();
for (const file of ["noun", "verb", "adj", "adv"]) {
  for (const line of (await readFile(path.join(dir, `data.${file}`), "utf8")).split("\n")) {
    if (!line || line.startsWith("  ")) continue;
    const parts = line.split(" | ")[0].split(" ");
    const pos = POS[parts[2]];
    const count = parseInt(parts[3], 16);
    for (let i = 0; i < count; i++) {
      const raw = parts[4 + 2 * i].replace(/\(\w+\)$/, "");
      const word = raw.toLowerCase();
      if (!/^[a-z]{5,6}$/.test(word)) continue;
      const entry = lemmas.get(word) ?? { pos: new Set(), senses: 0, common: false };
      entry.pos.add(pos);
      entry.senses++;
      if (raw === word) entry.common = true;
      lemmas.set(word, entry);
    }
  }
}

const uses = new Map();
for (const line of (await readFile(TATOEBA, "utf8")).split("\n")) {
  const text = line.split("\t")[2];
  if (!text) continue;
  for (const m of text.toLowerCase().matchAll(/[a-z]+/g)) {
    if (m[0].length >= 5 && m[0].length <= 6) uses.set(m[0], (uses.get(m[0]) ?? 0) + 1);
  }
}

// A plural or past form of something we already have, or could have, is a dull
// answer and a worse lesson than the base word.
function inflected(word) {
  const bases = [];
  if (word.endsWith("ies")) bases.push(word.slice(0, -3) + "y");
  if (word.endsWith("es")) bases.push(word.slice(0, -2));
  if (word.endsWith("s") && !word.endsWith("ss")) bases.push(word.slice(0, -1));
  if (word.endsWith("ed")) bases.push(word.slice(0, -2), word.slice(0, -1));
  if (word.endsWith("ing")) bases.push(word.slice(0, -3), word.slice(0, -3) + "e");
  return bases.some((b) => b.length >= 3 && (lemmas.has(b) || dictionary.has(b)));
}

const tier = (n) => (n >= 50 ? "familiar" : n >= 10 ? "stretch" : n >= 1 ? "challenging" : "rare");
const rows = [];
for (const [word, info] of lemmas) {
  if (!wanted(word) || !info.common || inflected(word)) continue;
  const n = uses.get(word) ?? 0;
  rows.push({ word, length: word.length, uses: n, tier: tier(n), pos: [...info.pos], senses: info.senses });
}
rows.sort((a, b) => b.uses - a.uses || a.word.localeCompare(b.word));

const table = {};
for (const r of rows) {
  const key = `${r.length}-letter`;
  table[key] ??= {};
  table[key][r.tier] = (table[key][r.tier] ?? 0) + 1;
}
console.log(`${rows.length} candidates`);
console.table(table);
if (!process.argv.includes("--report")) {
  await writeFile(OUT, JSON.stringify(rows, null, 1) + "\n");
  console.log(`wrote ${OUT.pathname}`);
}
