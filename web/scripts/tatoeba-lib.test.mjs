import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { forms, loadTatoeba, pickSentence } from "./tatoeba-lib.mjs";

test("forms follow the part of speech", () => {
  assert.deepEqual([...forms("abate", "verb")].sort(), ["abate", "abated", "abates", "abating"]);
  assert.deepEqual([...forms("bunch", "noun")].sort(), ["bunch", "bunches"]);
  assert.deepEqual([...forms("tangy", "adjective")], ["tangy"]);
});

test("names and compounds are not the word", async () => {
  const file = path.join(tmpdir(), `tatoeba-${process.pid}.tsv`);
  await writeFile(file, [
    "1\teng\tMr. Baker opened the shop early today.\tCK",
    "2\teng\tThe bidet-toilet has not spread far.\tCK",
    "3\teng\tShe bought a small bidet for the bathroom.\tCK",
  ].join("\n"));
  const found = await loadTatoeba(file, new Set(["baker", "bidet"]));
  assert.equal(found.get("baker"), undefined);
  assert.deepEqual(found.get("bidet").map((s) => s.id), ["3"]);
});

test("grim, political and fragmentary sentences are skipped", () => {
  assert.equal(pickSentence([
    { id: "1", text: "If there's anything we Algerians abhor, it's this." },
    { id: "2", text: "He abhorred the man he killed in the war." },
    { id: "3", text: "abhor it" },
    { id: "4", text: "I abhor cruelty in all its forms." },
  ]).id, "4");
});

test("sentences without the corpus regulars win ties", () => {
  assert.equal(pickSentence([
    { id: "1", text: "Tom thinks the sauce is far too tangy for him." },
    { id: "2", text: "This sauce is far too tangy for my taste, I think." },
  ]).id, "2");
});
