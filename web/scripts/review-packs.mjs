/**
 * Reads pending packs so a human can check them, and promotes the good ones
 * into packs.json.
 *
 *   pnpm packs:review                       # print everything waiting
 *   pnpm packs:review -- --approve <id...>  # move those packs into packs.json
 *   pnpm packs:review -- --reject <id...>   # drop them
 *
 * The step exists for the notes. Everything else about a pack a script can
 * check; whether an etymology is true it cannot.
 */
import { writeFile } from "node:fs/promises";
import { PACKS_PATH, PENDING_PATH, loadJson, checkPack, loadDictionary, wordsIn } from "./packs-lib.mjs";

const live = await loadJson(PACKS_PATH, []);
const pending = await loadJson(PENDING_PATH, []);

function idsAfter(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return [];
  return process.argv.slice(i + 1).filter((a) => !a.startsWith("--"));
}

const approve = idsAfter("--approve");
const reject = idsAfter("--reject");

if (approve.length === 0 && reject.length === 0) {
  if (pending.length === 0) {
    console.log("Nothing pending.");
    process.exit(0);
  }

  for (const pack of pending) {
    console.log(`\n${"─".repeat(64)}`);
    console.log(`${pack.title}   [${pack.id}]`);
    console.log(`${pack.blurb} [connection: ${pack.connectionDifficulty}]\n`);
    for (const w of pack.words) {
      const tag = w.register === "slang" ? " (slang)" : "";
      console.log(`  ${w.word.toUpperCase()}${tag}`);
      console.log(`    ${w.definition}`);
      console.log(`    ${w.note}`);
      console.log(`    Difficulty: ${w.difficulty}`);
      console.log(`    Context: ${w.hints?.[0]}`);
      console.log(`    Association: ${w.hints?.[1]}`);
      console.log(`    Connection: ${w.connection}\n`);
    }
  }

  console.log(`${"─".repeat(64)}`);
  console.log(`${pending.length} pending.`);
  console.log("Check facts, clue leakage alongside earlier words, difficulty progression, and every connection. Then: pnpm packs:review -- --approve <id...>");
  process.exit(0);
}

const known = new Set(pending.map((p) => p.id));
for (const id of [...approve, ...reject]) {
  if (!known.has(id)) {
    console.error(`No pending pack with id "${id}".`);
    process.exit(1);
  }
}

const promoted = pending.filter((p) => approve.includes(p.id));
const remaining = pending.filter(
  (p) => !approve.includes(p.id) && !reject.includes(p.id),
);

const dictionary = await loadDictionary();
const existingWords = wordsIn(live);
const existingIds = new Set(live.map((p) => p.id));
for (const pack of promoted) {
  const problems = checkPack(pack, { dictionary, existingWords, existingIds });
  if (problems.length) {
    console.error(`${pack.id}:\n${problems.join("\n")}`);
    process.exit(1);
  }
  existingIds.add(pack.id);
  for (const word of pack.words) existingWords.add(word.word);
}

await writeFile(PACKS_PATH, JSON.stringify([...live, ...promoted], null, 2) + "\n");
await writeFile(PENDING_PATH, JSON.stringify(remaining, null, 2) + "\n");

console.log(
  `Approved ${promoted.length}, rejected ${reject.length}, ${remaining.length} still pending.`,
);
if (promoted.length > 0) {
  console.log("Restart the Go server to pick them up — packs.json is embedded at build time.");
}
