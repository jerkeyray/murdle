import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteLetter, typeInto } from "../src/lib/draft.ts";

const full = ["c", "r", "a", "n", "e"];

test("typing fills the selected box and moves on", () => {
  assert.deepEqual(typeInto([], 0, "C", 5), { draft: ["c", "", "", "", ""], cursor: 1 });
  assert.deepEqual(typeInto(["c", "r"], 2, "a", 5), { draft: ["c", "r", "a", "", ""], cursor: 3 });
});

test("typing into the last box leaves the cursor past the end, and a full word takes no more", () => {
  const last = typeInto(["c", "r", "a", "n"], 4, "e", 5);
  assert.deepEqual(last, { draft: full, cursor: 5 });
  assert.equal(typeInto(full, 5, "s", 5), null);
});

test("typing over a selected box replaces it", () => {
  assert.deepEqual(typeInto(full, 1, "i", 5), { draft: ["c", "i", "a", "n", "e"], cursor: 2 });
  // Including the last one, which is the case that used to feel wrong.
  assert.deepEqual(typeInto(full, 4, "y", 5), { draft: ["c", "r", "a", "n", "y"], cursor: 5 });
});

test("delete after typing removes the letter you just typed", () => {
  assert.deepEqual(deleteLetter(["c", "r", "a"], 3, 5), { draft: ["c", "r", "", "", ""], cursor: 2 });
  assert.deepEqual(deleteLetter(full, 5, 5), { draft: ["c", "r", "a", "n", ""], cursor: 4 });
});

test("delete on a selected box removes that box's letter, not the one before it", () => {
  // Select the last box of a full word and delete: the 5th letter goes.
  assert.deepEqual(deleteLetter(full, 4, 5), { draft: ["c", "r", "a", "n", ""], cursor: 4 });
  // Same in the middle.
  assert.deepEqual(deleteLetter(full, 1, 5), { draft: ["c", "", "a", "n", "e"], cursor: 1 });
});

test("delete on an empty selected box steps back to the previous letter", () => {
  const afterLast = deleteLetter(full, 4, 5).draft; // last box now empty and selected
  assert.deepEqual(deleteLetter(afterLast, 4, 5), { draft: ["c", "r", "a", "", ""], cursor: 3 });
  assert.deepEqual(deleteLetter(["c", "", "a", "", ""], 1, 5), { draft: ["", "", "a", "", ""], cursor: 0 });
});

test("nothing to delete at the start", () => {
  assert.equal(deleteLetter([], 0, 5), null);
  assert.equal(deleteLetter(["", "x", "", "", ""], 0, 5), null);
});
