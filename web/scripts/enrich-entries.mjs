/**
 * Adds pronunciation, part of speech, origin and an example sentence to the
 * word entries in classic.json, from reference data rather
 * than a model.
 *
 * Only fills fields that are missing, so it is safe to re-run; values
 * already present (including ones filled in by hand) are never overwritten.
 *
 *   node scripts/enrich-entries.mjs --report                # coverage per field
 *   node scripts/enrich-entries.mjs --source wiktionary     # fill from scripts/data/wiktionary.jsonl
 *   node scripts/enrich-entries.mjs --source wordnet        # then fill gaps from WordNet
 *   node scripts/enrich-entries.mjs --source tatoeba        # then examples for single-sense words
 *   node scripts/enrich-entries.mjs --from reviewed.json    # apply hand-filled entries
 *
 * --source writes scripts/data/enrich-review.json: every word still missing
 * a field, with the candidate senses alongside, ready to be filled in and
 * passed back with --from. A patch is [{ word, pronunciation?, partOfSpeech?,
 * origin?, example? }]; each field present is checked and applied on its own.
 */
import { readFile, writeFile } from "node:fs/promises";
import { pickExample, pickOrigin, pickPronunciation, pickSense } from "./wiktionary-lib.mjs";
import { loadWordNet, wordNetExample } from "./wordnet-lib.mjs";
import { AVOID, forms, loadTatoeba, pickSentence } from "./tatoeba-lib.mjs";

const WORDS = new URL("../../server/internal/words/", import.meta.url);
const DATA = new URL("data/", import.meta.url);
const classicPath = new URL("classic.json", WORDS);
const FIELDS = ["pronunciation", "partOfSpeech", "origin", "example"];
// Written with its field but not counted as one: the Tatoeba page an
// example came from, which its CC BY licence asks us to link.
const WRITTEN = [...FIELDS, "exampleSource"];
const PARTS = ["noun", "verb", "adjective", "adverb", "preposition", "conjunction", "interjection", "pronoun"];

// Examples someone has looked at and turned down. Committed, so a re-run
// never brings them back: [{ word, example }].
const rejected = new Set(JSON.parse(await readFile(new URL("../example-rejects.json", DATA), "utf8"))
  .map((r) => `${r.word}\t${r.example}`));

const classic = JSON.parse(await readFile(classicPath, "utf8"));
const entries = classic;
const byWord = new Map(entries.map((w) => [w.word, w]));

// Mirrors validateEnrichment in server/internal/words/classic.go.
function problem(word, field, value) {
  if (typeof value !== "string" || !value.trim()) return "empty";
  if (field === "pronunciation" && /[/[\]]/.test(value)) return "pronunciation must be bare IPA";
  if (field === "partOfSpeech" && !PARTS.includes(value)) return `unknown part of speech ${value}`;
  if (field === "origin" && value.length > 120) return "origin is too long";
  if (field === "example" && !value.toLowerCase().includes(word.slice(0, 3))) return "example does not use the word";
  if (field === "exampleSource" && !value.startsWith("https://")) return "example source must be a link";
  return null;
}

function apply(patch) {
  const bad = [];
  let filled = 0;
  for (const e of patch) {
    const target = byWord.get(e.word);
    if (!target) { bad.push(`${e.word}: not in any bank`); continue; }
    for (const f of WRITTEN) {
      if (e[f] == null || target[f]) continue;
      if (f === "exampleSource" && target.example !== e.example) continue;
      // The same bar for every source, not only Tatoeba: dictionaries carry
      // examples that read badly out of context too.
      if (f === "example" && (AVOID.test(e.example) || rejected.has(`${e.word}\t${e.example}`))) continue;
      const p = problem(e.word, f, e[f]);
      if (p) { bad.push(`${e.word}: ${p}`); continue; }
      target[f] = e[f].trim();
      filled++;
    }
  }
  return { filled, bad };
}

async function save() {
  await writeFile(classicPath, JSON.stringify(classic, null, 1) + "\n");
}

function report() {
  for (const f of FIELDS) {
    const n = entries.filter((w) => w[f]).length;
    console.log(`${f.padEnd(14)} ${String(n).padStart(5)} / ${entries.length}  (${(100 * n / entries.length).toFixed(1)}%)`);
  }
  const all = entries.filter((w) => FIELDS.every((f) => w[f])).length;
  console.log(`${"complete".padEnd(14)} ${String(all).padStart(5)} / ${entries.length}`);
}

async function fromWiktionary() {
  const records = new Map();
  for (const line of (await readFile(new URL("wiktionary.jsonl", DATA), "utf8")).split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (!records.has(r.word)) records.set(r.word, []);
    records.get(r.word).push(r);
  }
  const patch = [];
  const review = [];
  for (const w of entries) {
    const rs = records.get(w.word);
    if (!rs) { review.push({ word: w.word, definition: w.definition, missing: FIELDS.filter((f) => !w[f]), reason: "not in Wiktionary" }); continue; }
    const sense = pickSense(rs, w.definition);
    const out = { word: w.word, pronunciation: pickPronunciation(rs) };
    // Part of speech and example belong to one sense; only take them when
    // the sense is clearly ours. Origin is per etymology, which is usually
    // shared by every sense, so the best guess is safe enough to use.
    if (sense?.confident) out.partOfSpeech = sense.pos;
    if (sense?.senseClear) out.example = pickExample(sense.sense, w.word);
    if (sense) out.origin = pickOrigin(sense.record, sense.sense);
    patch.push(out);
    const missing = FIELDS.filter((f) => !w[f] && !out[f]);
    if (missing.length) {
      review.push({
        word: w.word,
        definition: w.definition,
        missing,
        reason: sense && !sense.confident ? "sense unclear" : "no data for these fields",
        found: Object.fromEntries(FIELDS.filter((f) => out[f]).map((f) => [f, out[f]])),
        candidates: (sense?.candidates ?? []).slice(0, 4).map((c) => ({ pos: c.pos, gloss: c.sense.glosses.at(-1), score: c.score, examples: c.sense.examples?.slice(0, 2) })),
      });
    }
  }
  const { filled, bad } = apply(patch);
  await save();
  await writeFile(new URL("enrich-review.json", DATA), JSON.stringify(review, null, 1) + "\n");
  console.log(`filled ${filled} fields from Wiktionary; ${review.length} words to review in scripts/data/enrich-review.json`);
  if (bad.length) console.error(bad.join("\n"));
}

// The fallback, for what Wiktionary left empty: part of speech where
// WordNet's senses make it clear, and examples, which WordNet has far more
// of. An example is only taken from a sense of the part of speech already
// chosen, and only when that sense clearly matches our definition.
async function fromWordNet() {
  const todo = entries.filter((w) => !w.partOfSpeech || !w.example);
  const wordnet = await loadWordNet(new Set(todo.map((w) => w.word)));
  const patch = [];
  for (const w of todo) {
    const records = wordnet.get(w.word);
    if (!records) continue;
    const out = { word: w.word };
    if (!w.partOfSpeech) {
      const sense = pickSense(records, w.definition);
      if (sense?.confident) out.partOfSpeech = sense.pos;
    }
    const pos = w.partOfSpeech ?? out.partOfSpeech;
    if (!w.example && pos) {
      const sense = pickSense(records.filter((r) => ({ adj: "adjective", adv: "adverb" })[r.pos] === pos || r.pos === pos), w.definition);
      if (sense?.senseClear) out.example = wordNetExample(sense.sense, w.word);
    }
    patch.push(out);
  }
  const { filled, bad } = apply(patch);
  await save();
  await writeReview();
  console.log(`filled ${filled} fields from WordNet`);
  if (bad.length) console.error(bad.join("\n"));
}

// Examples for words with one sense only. Tatoeba sentences are not tagged
// by sense, so a word qualifies only when WordNet knows exactly one sense of
// it, of the part of speech we chose, and Wiktionary lists no current sense
// under another part of speech.
async function fromTatoeba(file = new URL("tatoeba.tsv", DATA)) {
  const todo = entries.filter((w) => !w.example && w.partOfSpeech);
  const wordnet = await loadWordNet(new Set(todo.map((w) => w.word)));
  const wiktionary = new Map();
  for (const line of (await readFile(new URL("wiktionary.jsonl", DATA), "utf8")).split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (!wiktionary.has(r.word)) wiktionary.set(r.word, []);
    wiktionary.get(r.word).push(r);
  }
  const POS = { noun: "noun", verb: "verb", adj: "adjective", adv: "adverb" };
  const QUIET = ["obsolete", "archaic", "rare", "dialectal", "nonstandard", "historical"];
  const eligible = todo.filter((w) => {
    const synsets = wordnet.get(w.word) ?? [];
    if (synsets.length !== 1 || POS[synsets[0].pos] !== w.partOfSpeech) return false;
    return !(wiktionary.get(w.word) ?? []).some((r) => POS[r.pos] && POS[r.pos] !== w.partOfSpeech &&
      r.senses.some((s) => !s.tags?.some((t) => QUIET.includes(t))));
  });
  const wanted = new Map(eligible.map((w) => [w.word, forms(w.word, w.partOfSpeech)]));
  const sentences = await loadTatoeba(file, new Set([...wanted.values()].flatMap((f) => [...f])));
  const patch = [];
  for (const w of eligible) {
    const pick = pickSentence([...wanted.get(w.word)].flatMap((f) => sentences.get(f) ?? []));
    if (pick) patch.push({ word: w.word, example: pick.text, exampleSource: `https://tatoeba.org/en/sentences/show/${pick.id}` });
  }
  const { bad } = apply(patch);
  await save();
  await writeReview();
  console.log(`${eligible.length} single-sense words; examples found for ${patch.length}`);
  if (bad.length) console.error(bad.join("\n"));
}

// Rewrites the review list against the banks as they now stand, keeping
// the Wiktionary candidates gathered by the first pass.
async function writeReview() {
  const file = new URL("enrich-review.json", DATA);
  const previous = new Map(JSON.parse(await readFile(file, "utf8").catch(() => "[]")).map((r) => [r.word, r]));
  const review = entries.filter((w) => FIELDS.some((f) => !w[f])).map((w) => ({
    ...previous.get(w.word),
    word: w.word,
    definition: w.definition,
    missing: FIELDS.filter((f) => !w[f]),
  }));
  await writeFile(file, JSON.stringify(review, null, 1) + "\n");
  console.log(`${review.length} words to review in scripts/data/enrich-review.json`);
}

const args = process.argv.slice(2);
if (args.includes("--source")) {
  const source = args[args.indexOf("--source") + 1];
  if (source === "wiktionary") await fromWiktionary();
  else if (source === "wordnet") await fromWordNet();
  else if (source === "tatoeba") await fromTatoeba(args[args.indexOf("--source") + 2]);
  else throw new Error(`unknown source ${source}`);
  report();
} else if (args.includes("--from")) {
  let total = 0;
  for (const file of args.slice(args.indexOf("--from") + 1)) {
    const { filled, bad } = apply(JSON.parse(await readFile(file, "utf8")));
    total += filled;
    if (bad.length) console.error(bad.join("\n"));
  }
  await save();
  console.log(`filled ${total} fields`);
  report();
} else {
  report();
}
