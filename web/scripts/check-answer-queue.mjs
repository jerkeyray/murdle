/**
 * Checks the editorial queue used to grow the five-letter answer bank.
 * Candidates are intentionally not playable yet: every word needs a
 * definition, two non-giveaway clues and a review before promotion.
 */
import { readFile } from "node:fs/promises";
import { DICTIONARY_PATH } from "./packs-lib.mjs";

const queuePath = new URL("../../server/internal/words/five-letter-candidates.json", import.meta.url);
const queue = JSON.parse(await readFile(queuePath, "utf8"));
const dictionary = new Set((await readFile(DICTIONARY_PATH, "utf8")).split("\n").filter(Boolean));
const seen = new Set();
const errors = [];

if (queue.targetLiveAnswers !== 1000 || queue.existingLiveAnswers + queue.candidates.length !== 1000) {
  errors.push("queue does not meet the 1,000-answer target");
}
for (const item of queue.candidates) {
  if (!/^[a-z]{5}$/.test(item.word)) errors.push(`${item.word}: must be five lowercase letters`);
  if (!dictionary.has(item.word)) errors.push(`${item.word}: absent from the guess dictionary`);
  if (seen.has(item.word)) errors.push(`${item.word}: duplicated`);
  seen.add(item.word);
  if (item.status !== "needs-editorial") errors.push(`${item.word}: unexpected review state`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${queue.candidates.length} five-letter candidates queued; ${queue.existingLiveAnswers} live + queue = ${queue.targetLiveAnswers} target answers.`);
}
