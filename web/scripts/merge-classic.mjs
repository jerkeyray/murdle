/**
 * Merges a batch of Classic entries into server/internal/words/classic.json.
 *
 * Applies the same rules as validateClassic in the Go server, so a bad entry
 * is reported here, by word, rather than as a startup panic later. Entries for
 * words already in the bank are skipped, not overwritten: an existing entry may
 * have been edited by hand since it was written.
 *
 * Run with: node scripts/merge-classic.mjs [--dry] <batch.json> [...more]
 * --dry reports what would be added or rejected without writing.
 */
import { readFile, writeFile } from "node:fs/promises";
import { hintProblem } from "./bank-lib.mjs";

const WORDS = new URL("../../server/internal/words/", import.meta.url);
const bankPath = new URL("classic.json", WORDS);
const bank = JSON.parse(await readFile(bankPath, "utf8"));
const dictionary = new Set((await readFile(new URL("dictionary.txt", WORDS), "utf8")).split("\n").filter(Boolean));
const taken = new Set(bank.map((w) => w.word));
// Every clue already in use, so two answers never share one.
const clueOwner = new Map(bank.flatMap((w) => w.hints.map((h) => [normalize(h), w.word])));
const STRUCTURAL = /\b(first|last|second|third|fourth|fifth|sixth) letter\b|\b(starts?|ends?) with (the )?(letter|vowel|consonant)\b/i;
function normalize(s) { return s.toLowerCase().replace(/[^a-z]+/g, " ").trim(); }

function problems(w) {
  const out = [];
  if (!/^[a-z]{5,6}$/.test(w.word ?? "")) out.push("not five or six lowercase letters");
  if (!dictionary.has(w.word)) out.push("not in the guess dictionary");
  if (!w.definition?.trim()) out.push("no definition");
  if (!w.note?.trim()) out.push("no note");
  if (!["standard", "slang"].includes(w.register)) out.push(`register ${w.register}`);
  if (!["familiar", "stretch", "challenging"].includes(w.difficulty)) out.push(`difficulty ${w.difficulty}`);
  if (!Array.isArray(w.hints) || w.hints.length !== 2 || w.hints[0] === w.hints[1]) out.push("needs two different hints");
  for (const h of w.hints ?? []) {
    if ((h ?? "").trim().length < 12) out.push(`short hint: ${h}`);
    if ((h ?? "").toLowerCase().includes(w.word)) out.push(`hint gives it away: ${h}`);
    if (STRUCTURAL.test(h ?? "")) out.push(`hint is about spelling: ${h}`);
    const problem = hintProblem(w.word, w.definition ?? "", h ?? "");
    if (problem) out.push(`${problem}: ${h}`);
    const other = clueOwner.get(normalize(h ?? ""));
    if (other && other !== w.word) out.push(`hint already used for ${other}: ${h}`);
  }
  return out;
}

let added = 0, skipped = 0;
const failed = [];
const dry = process.argv.includes("--dry");
for (const file of process.argv.slice(2).filter((a) => a !== "--dry")) {
  const batch = JSON.parse(await readFile(file, "utf8"));
  // A batch file is either a bare list of entries or { entries, rejected }.
  for (const entry of Array.isArray(batch) ? batch : batch.entries) {
    const w = { word: entry.word, register: entry.register ?? "standard", definition: entry.definition, note: entry.note, hints: entry.hints, difficulty: entry.difficulty };
    if (taken.has(w.word)) { skipped++; continue; }
    const p = problems(w);
    if (p.length) { failed.push(`${w.word}: ${p.join("; ")}`); continue; }
    bank.push(w); taken.add(w.word); w.hints.forEach((h) => clueOwner.set(normalize(h), w.word)); added++;
  }
}
bank.sort((a, b) => a.word.localeCompare(b.word));
if (!dry) await writeFile(bankPath, JSON.stringify(bank, null, 1) + "\n");
console.log(`added ${added}, skipped ${skipped} already present, ${failed.length} rejected; bank now ${bank.length}`);
if (failed.length) { console.error(failed.join("\n")); process.exitCode = 1; }
