/**
 * Prints the figures quoted in the README's "The words" section, so they can be
 * refreshed after the bank changes instead of being counted by hand.
 *
 *   pnpm bank:stats
 */
import { readFile } from "node:fs/promises";
import { BANK_PATH, DICTIONARY_PATH } from "./bank-lib.mjs";

const bank = JSON.parse(await readFile(BANK_PATH, "utf8"));
const live = bank.filter((w) => !w.retired);
const count = (rows, test) => rows.filter(test).length;
const lengths = [5, 6];

console.log(`entries ${bank.length}, playable ${live.length}, retired ${bank.length - live.length}`);
console.log("\nplayable answers by length and difficulty");
for (const n of lengths) {
  const row = ["familiar", "stretch", "challenging"].map((d) => count(live, (w) => w.word.length === n && w.difficulty === d));
  console.log(`  ${n}-letter  ${row.join(" / ")}  = ${row.reduce((a, b) => a + b, 0)}`);
}
console.log(`\nslang ${count(live, (w) => w.register === "slang")}, standard ${count(live, (w) => w.register === "standard")}`);

console.log("\nfield coverage (playable answers)");
for (const field of ["pronunciation", "partOfSpeech", "origin", "example"]) {
  const n = count(live, (w) => w[field]);
  console.log(`  ${field.padEnd(14)} ${n} (${((100 * n) / live.length).toFixed(0)}%)`);
}
console.log(`  example from Tatoeba ${count(live, (w) => w.exampleSource)}`);

const dictionary = (await readFile(DICTIONARY_PATH, "utf8")).split("\n").filter(Boolean);
console.log(`\nguess dictionary (before supplement) ${dictionary.length}: ${lengths.map((n) => `${n}-letter ${count(dictionary, (w) => w.length === n)}`).join(", ")}`);
