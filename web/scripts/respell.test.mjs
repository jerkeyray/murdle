import { test } from "node:test";
import assert from "node:assert/strict";
import { respell } from "../src/lib/respell.ts";

test("one syllable stays lowercase", () => {
  assert.equal(respell("təʊst"), "tohst");
  assert.equal(respell("ˈwɜːθ"), "wurth");
  assert.equal(respell("ˈpɹaɪs"), "prys");
});

test("the stressed syllable is in capitals", () => {
  assert.equal(respell("əˈbeɪt"), "uh-BAYT");
  assert.equal(respell("ˈsɜːkə"), "SUR-kuh");
  assert.equal(respell("liːˈɑːnə"), "lee-AH-nuh");
});

test("a short vowel keeps the consonant after it", () => {
  assert.equal(respell("ˈlʌki"), "LUK-ee");
  assert.equal(respell("ˈbænə"), "BAN-uh");
  assert.equal(respell("ˈfɪskəl"), "FIS-kuhl");
});

test("eye after a consonant is spelled y", () => {
  assert.equal(respell("ˈnaɪnti"), "NYN-tee");
  assert.equal(respell("ˈʌmpaɪə(ɹ)"), "UM-py-uh");
});

test("optional sounds are dropped and syllabic consonants get a vowel", () => {
  assert.equal(respell("sɪn(t)s"), "sins");
  assert.equal(respell("ˈlɪtl̩"), "LIT-uhl");
});

test("nothing in, nothing out", () => {
  assert.equal(respell(undefined), undefined);
  assert.equal(respell(""), undefined);
});
