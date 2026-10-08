/**
 * Slices candidates.json into batches for drafting.
 *
 *   node scripts/make-batches.mjs --length 6 --tier challenging --count 200 [--size 40] [--shuffle]
 *
 * --shuffle orders by a hash of the word instead of by usage. The rare tier has
 * no usage to rank by, so without it a batch is just the start of the alphabet.
 *
 * Writes scripts/data/batches/in-<length>-<tier>-<n>.json, each a list of
 * { word, uses, pos } for one drafter to turn into entries. Words that already
 * have a batch file are skipped, so running it again hands out the next slice.
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const length = Number(arg("length", 6));
const tier = arg("tier", "challenging");
const count = Number(arg("count", 200));
const size = Number(arg("size", 40));
const dir = new URL("data/batches/", import.meta.url);
await mkdir(dir, { recursive: true });

const handedOut = new Set();
for (const file of await readdir(dir)) {
  if (file.startsWith("in-")) for (const r of JSON.parse(await readFile(new URL(file, dir), "utf8"))) handedOut.add(r.word);
}
const bank = new Set(JSON.parse(await readFile(new URL("../../server/internal/words/classic.json", import.meta.url), "utf8")).map((w) => w.word));
const hash = (w) => [...w].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
let pool = JSON.parse(await readFile(new URL("data/candidates.json", import.meta.url), "utf8"))
  .filter((c) => c.length === length && c.tier === tier && !handedOut.has(c.word) && !bank.has(c.word));
if (process.argv.includes("--shuffle")) pool.sort((a, b) => hash(a.word) - hash(b.word));
pool = pool.slice(0, count);

const existing = (await readdir(dir)).filter((f) => f.startsWith(`in-${length}-${tier}-`)).length;
for (let i = 0; i * size < pool.length; i++) {
  const name = `in-${length}-${tier}-${String(existing + i + 1).padStart(2, "0")}.json`;
  await writeFile(new URL(name, dir), JSON.stringify(pool.slice(i * size, (i + 1) * size).map(({ word, uses, pos }) => ({ word, uses, pos })), null, 1) + "\n");
  console.log(name);
}
console.log(`${pool.length} words in ${Math.ceil(pool.length / size)} batches`);
