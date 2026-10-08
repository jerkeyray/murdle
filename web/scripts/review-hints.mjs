/**
 * Lists Classic entries whose clues probably need an editorial pass, and
 * applies a reviewed batch back to classic.json.
 *
 *   node scripts/review-hints.mjs              writes scripts/data/hint-review.json
 *   node scripts/review-hints.mjs --from file  applies the reviewed "hints"
 *
 * Tier one should set the scene (where you would meet the word) and tier two
 * should narrow it, without either reading as the definition. The validator
 * already rejects root leaks and restated definitions; this flags the softer
 * cases a script cannot judge: a terse first clue, which tends to be a
 * synonym, and a first clue much shorter than the second, which usually means
 * the sharper clue is shown first.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { BANK_PATH, hintProblem } from "./bank-lib.mjs";

const bankPath = BANK_PATH;
const reviewPath = new URL("data/hint-review.json", import.meta.url);
const bank = JSON.parse(await readFile(bankPath, "utf8"));

const from = process.argv.indexOf("--from");
if (from !== -1) {
  const reviewed = JSON.parse(await readFile(process.argv[from + 1], "utf8"));
  const byWord = new Map(bank.map((entry) => [entry.word, entry]));
  let applied = 0;
  for (const item of reviewed) {
    const entry = byWord.get(item.word);
    if (!entry || !Array.isArray(item.hints) || item.hints.length !== 2) continue;
    const problem = item.hints.map((h) => hintProblem(entry.word, entry.definition, h)).find(Boolean);
    if (problem) {
      console.error(`${item.word}: ${problem}, skipped`);
      continue;
    }
    if (item.hints.join() === entry.hints.join()) continue;
    entry.hints = item.hints;
    applied++;
  }
  await writeFile(bankPath, JSON.stringify(bank, null, 1) + "\n");
  console.log(`applied ${applied} reviewed clue pairs`);
} else {
  const flagged = [];
  for (const entry of bank) {
    if (entry.retired) continue;
    const [first, second] = entry.hints;
    const reasons = [];
    if (first.length < 25) reasons.push("first clue is terse");
    if (first.length < second.length * 0.6) reasons.push("second clue may be the gentler one");
    if (reasons.length) flagged.push({ word: entry.word, definition: entry.definition, reasons, hints: entry.hints });
  }
  await mkdir(new URL("data/", import.meta.url), { recursive: true });
  await writeFile(reviewPath, JSON.stringify(flagged, null, 1) + "\n");
  console.log(`${flagged.length} of ${bank.length} entries flagged; edit "hints" in ${reviewPath.pathname} and apply with --from`);
}
