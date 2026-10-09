/**
 * Keeps the figures in README.md equal to the answer bank.
 *
 *   node scripts/sync-readme.mjs           rewrite the block between the markers
 *   node scripts/sync-readme.mjs --check   exit 1 if the README is out of date
 *
 * Everything between the bank-stats markers is generated; edit this script, not
 * the block. `make test` runs the check, so a change to the bank cannot land
 * with stale numbers in the README.
 */
import { readFile, writeFile } from "node:fs/promises";
import { bankFigures } from "./bank-lib.mjs";

const README = new URL("../../README.md", import.meta.url);
const START = "<!-- bank-stats:start -->";
const END = "<!-- bank-stats:end -->";
const n = (x) => x.toLocaleString("en-GB");

const f = await bankFigures();
const [five, six] = f.lengths;
const row = (name, key) => `| ${name} | ${n(five[key])} | ${n(six[key])} |`;
const block = `${START}
**${n(f.answers)} answers** to play, and **${n(f.dictionary)} words** accepted as guesses.

| Difficulty | 5 letters | 6 letters |
| --- | ---: | ---: |
${row("Familiar", "familiar")}
${row("Stretch", "stretch")}
${row("Challenging", "challenging")}
| **Total** | **${n(five.total)}** | **${n(six.total)}** |
${END}`;

const text = await readFile(README, "utf8");
const from = text.indexOf(START);
const to = text.indexOf(END);
if (from < 0 || to < 0) throw new Error("README.md is missing the bank-stats markers");
const next = text.slice(0, from) + block + text.slice(to + END.length);

if (process.argv.includes("--check")) {
  if (next !== text) {
    console.error("README.md figures are out of date with the word bank. Run: pnpm readme:sync");
    process.exit(1);
  }
  console.log("README figures match the word bank.");
} else {
  await writeFile(README, next);
  console.log(next === text ? "README already up to date." : "README figures updated.");
}
