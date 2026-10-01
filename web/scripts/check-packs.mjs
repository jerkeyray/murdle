import { PACKS_PATH, loadJson, checkPack, loadDictionary } from "./packs-lib.mjs";
const packs = await loadJson(PACKS_PATH, []);
const dictionary = await loadDictionary();
const existingWords = new Set();
const existingIds = new Set();
let errors = 0;
for (const pack of packs) {
  const problems = checkPack(pack, { dictionary, existingWords, existingIds });
  for (const problem of problems) { console.error(`${pack.id}: ${problem}`); errors++; }
  existingIds.add(pack.id);
  for (const word of pack.words) existingWords.add(word.word);
}
if (!packs.length) throw new Error("No packs loaded");
if (errors) process.exitCode = 1;
else console.log(`${packs.length} packs, ${existingWords.size} words: structural checks passed. Human clue/fact review and player testing are separate requirements.`);
