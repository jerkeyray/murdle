import { test } from "node:test";
import assert from "node:assert/strict";
import { PACKS_PATH, loadJson, loadDictionary, checkPack } from "./packs-lib.mjs";
const packs = await loadJson(PACKS_PATH, []);
const dictionary = await loadDictionary();
const options = { dictionary, existingWords: new Set(), existingIds: new Set() };
test("all live content meets structural gates", () => {
  const seen = { dictionary, existingWords: new Set(), existingIds: new Set() };
  for (const pack of packs) {
    assert.deepEqual(checkPack(pack, seen), [], pack.id);
    seen.existingIds.add(pack.id);
    pack.words.forEach((w) => seen.existingWords.add(w.word));
  }
});
test("rejects missing clues, giveaways, and missing connection explanations", () => {
  for (const mutate of [
    p => { p.words[0].hints = []; },
    p => { p.words[0].hints[0] = `Consider the word ${p.words[0].word} here.`; },
    p => { p.words[0].hints[0] = "The first letter is a vowel."; },
    p => { delete p.words[0].connection; },
    p => { delete p.connectionDifficulty; },
  ]) {
    const pack = structuredClone(packs[0]); mutate(pack);
    assert.ok(checkPack(pack, options).length > 0);
  }
});
