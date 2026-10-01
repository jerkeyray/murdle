/**
 * Generates themed word packs with an LLM, gates them hard, and writes the
 * survivors to packs.pending.json for review.
 *
 * Nothing reaches a player unreviewed, and that is not ceremony. The notes are
 * the whole product — they are the reason the round ends in something other
 * than "you got it" — and a confidently invented etymology is worse than no
 * note at all. The model is good at the shape of these and cannot be trusted
 * on the facts, so a human reads them before they ship.
 *
 *   pnpm packs:generate                 # three packs
 *   pnpm packs:generate -- --count 6
 *   pnpm packs:generate -- --theme "words for being on a train"
 *   pnpm packs:generate -- --dry-run    # gate only, write nothing
 */
import { writeFile } from "node:fs/promises";
import { generateObject } from "ai";
import {
  PACKS_PATH,
  PENDING_PATH,
  checkPack,
  loadDictionary,
  loadJson,
  packSchema,
  wordsIn,
  WORDS_PER_PACK,
  WORD_LENGTH,
} from "./packs-lib.mjs";

// Through the AI Gateway as a plain provider/model string, so switching models
// is a one-line change and needs no provider package.
const MODEL = "anthropic/claude-sonnet-5-5";

const SYSTEM = `You write word packs for Wordle, a solo vocabulary and hidden-connection game.

A pack is ${WORDS_PER_PACK} ${WORD_LENGTH}-letter words that secretly share a theme. The theme is
hidden until the last word is solved, so the players spend the run guessing at the
connection as well as the words. The connection should be guessable in hindsight and
not obvious on word two.

Prefer literary and uncommon but useful English. Do not include novelty internet slang,
specialist jargon, or obscure spellings simply to raise difficulty. Order the five words:
approachable opener, two richer discoveries, a connecting word, final confirmation.
Rate word difficulty independently of connection difficulty. Avoid stacking repeated
letters, rare spellings, and crowded one-letter-different families in the same pack.
The connection must be specific and defensible for every word; no miscellaneous collections.
Do not announce the theme with the opening word.

Write two hints separately from each definition: broad context, then a narrower association.
Never include answer text, exact letters or positions, a near-definition, or the pack theme.
Consider what earlier answers already tell the player. Write a separate final connection
explanation for each word, withheld until the whole run ends.

Hard rules:
- Every word is exactly ${WORD_LENGTH} letters, lowercase a-z. No proper nouns, hyphens or accents.
- No plurals or verb forms used only to hit five letters. The word should be a word
  someone would actually reach for.
- Nothing cruel: no slurs, and nothing that makes a joke of violence or illness.

The note is the reason this game exists. It says where the word came from or what it
used to mean, in two or three sentences, and it must be TRUE. If you are not confident
in an etymology, choose a different word rather than guessing. A plausible invention is
the worst thing you can hand back.

Voice: dry, specific, unhurried. No exclamation marks, no "fun fact", no addressing the
reader as "you guys".`;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const count = Number(arg("count", "3"));
const theme = arg("theme", null);
const dryRun = process.argv.includes("--dry-run");

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error(
    "AI_GATEWAY_API_KEY is not set.\n" +
      "Get one from the AI Gateway tab in your Vercel dashboard, then either\n" +
      "export it or put it in web/.env.local as AI_GATEWAY_API_KEY=...",
  );
  process.exit(1);
}

const dictionary = await loadDictionary();
const existing = await loadJson(PACKS_PATH, []);
const pending = await loadJson(PENDING_PATH, []);

// New packs must not collide with what is already live *or* already waiting.
const existingIds = new Set([...existing, ...pending].map((p) => p.id));
const existingWords = wordsIn([...existing, ...pending]);

const accepted = [];
const rejected = [];

for (let i = 0; i < count; i++) {
  const avoid = [...existingIds].join(", ") || "none yet";

  const { object } = await generateObject({
    model: MODEL,
    schema: packSchema,
    system: SYSTEM,
    prompt: theme
      ? `Write a pack on this theme: ${theme}.\n\nExisting pack ids to avoid duplicating: ${avoid}.`
      : `Write a new pack on a theme of your choosing. Choose a precise connection and an intentional progression of challenging but approachable vocabulary.

Existing pack ids, whose themes you must not repeat: ${avoid}.`,
    // Enough freedom to find an angle, not so much that it invents etymology.
    temperature: 0.9,
  });

  const problems = checkPack(object, { dictionary, existingWords, existingIds });

  if (problems.length > 0) {
    rejected.push({ pack: object, problems });
    console.error(`\n✗ ${object.id} — rejected`);
    for (const p of problems) console.error(`    ${p}`);
    continue;
  }

  accepted.push(object);
  existingIds.add(object.id);
  for (const w of object.words) existingWords.add(w.word);

  console.log(`\n✓ ${object.id} — ${object.title}`);
  console.log(`    ${object.words.map((w) => w.word).join("  ")}`);
}

console.log(
  `\n${accepted.length} accepted, ${rejected.length} rejected out of ${count}.`,
);

if (dryRun) {
  console.log("Dry run: nothing written.");
} else if (accepted.length > 0) {
  await writeFile(PENDING_PATH, JSON.stringify([...pending, ...accepted], null, 2) + "\n");
  console.log(
    `Written to packs.pending.json. Read them with \`pnpm packs:review\` — ` +
      `check the etymologies before approving.`,
  );
}
