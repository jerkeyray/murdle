/**
 * Cuts the kaikki.org Wiktionary dump down to the words we serve.
 *
 * The full English dump is several gigabytes; we need a few thousand
 * entries. Streams the dump from stdin and writes only matching English
 * records, trimmed to the fields enrich-entries.mjs reads:
 *
 *   curl -L -C - -o english.jsonl.gz https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz
 *   gunzip -c english.jsonl.gz | node scripts/extract-wiktionary.mjs
 *
 * Wiktionary content is CC BY-SA 4.0; see scripts/data/README.md.
 */
import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";

const WORDS = new URL("../../server/internal/words/", import.meta.url);
const OUT = new URL("data/wiktionary.jsonl", import.meta.url);

const classic = JSON.parse(await readFile(new URL("classic.json", WORDS), "utf8"));
const packs = JSON.parse(await readFile(new URL("packs.json", WORDS), "utf8"));
const wanted = new Set([...classic.map((w) => w.word), ...packs.flatMap((p) => p.words.map((w) => w.word))]);

const kept = [];
let read = 0, bad = 0;
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  read++;
  if (read % 200000 === 0) process.stderr.write(`\r${read} read, ${kept.length} kept`);
  // Cheap prefilter before parsing. Nested synonyms and links carry "word"
  // keys of their own, so any of our words appearing as one passes here and
  // the real check is on the parsed record.
  if (![...line.matchAll(/"word": ?"([a-z]{5,6})"/g)].some((m) => wanted.has(m[1]))) continue;
  let e;
  try { e = JSON.parse(line); } catch { bad++; continue; }
  if (e.lang_code !== "en" || !wanted.has(e.word)) continue;
  kept.push(JSON.stringify({
    word: e.word,
    pos: e.pos,
    sounds: (e.sounds ?? []).filter((s) => s.ipa).map((s) => ({ ipa: s.ipa, tags: s.tags })),
    etymologyNumber: e.etymology_number,
    etymology: e.etymology_text,
    etymologyTemplates: (e.etymology_templates ?? []).map((t) => ({ name: t.name, args: t.args, expansion: t.expansion })),
    senses: (e.senses ?? []).map((s) => ({
      glosses: s.glosses,
      tags: s.tags,
      attested: s.attestations?.[0]?.date,
      // Usage examples only; dated quotations are long and often archaic.
      examples: (s.examples ?? []).filter((x) => x.text && x.type === "example").map((x) => x.text),
    })),
  }));
}
await writeFile(OUT, kept.join("\n") + "\n");
process.stderr.write(`\n${read} records read (${bad} unparsable); ${kept.length} kept for ${new Set(kept.map((k) => JSON.parse(k).word)).size} of ${wanted.size} words\n`);
