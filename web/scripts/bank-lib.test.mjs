import { test } from "node:test";
import assert from "node:assert/strict";
import { hintProblem } from "./bank-lib.mjs";

test("hints that share the root or restate the definition are rejected", () => {
  assert.match(hintProblem("ample", "More than enough.", "Related to amplify."), /root/);
  assert.match(hintProblem("drake", "A male duck.", "A male duck."), /definition/);
  assert.equal(hintProblem("drake", "A male duck.", "The male of a mallard."), "");
});
