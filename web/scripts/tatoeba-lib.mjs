/**
 * Example sentences from Tatoeba (tatoeba.org, CC BY 2.0 FR), for words the
 * dictionaries left without one.
 *
 * Tatoeba sentences carry no sense labels: a sentence with "crane" in it may
 * be about the bird or the machine. So this is only used for words with a
 * single sense (see enrich-entries.mjs), where any natural use of the word
 * is the use our definition describes.
 */
import { readFile } from "node:fs/promises";

/** The forms a sentence may use the word in, for its part of speech. */
export function forms(word, pos) {
  const out = new Set([word]);
  if (pos === "noun") out.add(/(?:s|x|z|ch|sh)$/.test(word) ? word + "es" : word + "s");
  if (pos === "verb") {
    out.add(word + "s");
    if (/(?:s|x|z|ch|sh|o)$/.test(word)) out.add(word + "es");
    if (word.endsWith("e")) { out.add(word + "d"); out.add(word.slice(0, -1) + "ing"); }
    else { out.add(word + "ed"); out.add(word + "ing"); }
    // Doubling, as in "plan" -> "planned"; harmless when it does not apply.
    const last = word.at(-1);
    if (/[^aeiou][aeiou][bdgklmnprt]$/.test(word)) { out.add(word + last + "ed"); out.add(word + last + "ing"); }
    if (/[^aeiou]y$/.test(word)) { out.add(word.slice(0, -1) + "ies"); out.add(word.slice(0, -1) + "ied"); }
  }
  return out;
}

// Kept off a word game's entry card regardless of the word: grim or crude
// sentences, and the regional politics and identity debates the corpus
// leans heavily on.
export const AVOID = new RegExp("\\b(?:" + [
  "kill\\w*", "murder\\w*", "suicide", "rape\\w*", "die", "died", "dead", "corpse", "gun\\w*", "shot",
  "hate\\w*", "stupid", "idiot\\w*", "sex\\w*", "drunk\\w*", "hangover", "feces", "faeces", "urine", "tampon\\w*",
  "algeria\\w*", "berber\\w*", "kabyl\\w*", "separatis\\w*", "islam\\w*", "muslim\\w*", "jew\\w*", "christian\\w*",
  "israel\\w*", "palestin\\w*", "nazi\\w*", "hitler", "trump", "terroris\\w*", "racis\\w*",
].join("|") + ")\\b", "i");
const NAMES = /\b(?:Tom|Mary|John|Ken|Bob|Jack|Tony)\b/;

/**
 * Loads only the sentences that use one of the wanted forms, as
 * Map<form, [{ id, text }]>. `wanted` is a Set of lowercase forms.
 */
export async function loadTatoeba(file, wanted) {
  const out = new Map();
  for (const line of (await readFile(file, "utf8")).split("\n")) {
    const [id, lang, text] = line.split("\t");
    if (lang !== "eng" || !text) continue;
    for (const m of text.matchAll(/[A-Za-z]+/g)) {
      const raw = m[0];
      const form = raw.toLowerCase();
      if (!wanted.has(form)) continue;
      // Capitalised mid-sentence is a name ("Mr. Baker"), not the word.
      if (m.index > 0 && raw[0] !== form[0]) continue;
      // Part of a compound ("bidet-toilet") is not the word on its own.
      if (text[m.index - 1] === "-" || text[m.index + raw.length] === "-") continue;
      if (!out.has(form)) out.set(form, []);
      out.get(form).push({ id, text });
    }
  }
  return out;
}

/**
 * The best sentence for a word: a complete sentence of comfortable length,
 * nothing grim, and preferring ones that are not about Tom and Mary, who
 * appear in a large share of the corpus. Deterministic, so re-runs agree.
 */
export function pickSentence(candidates) {
  const usable = candidates.filter(({ text }) =>
    text.length >= 25 && text.length <= 110 && /^[A-Z"]/.test(text) && /[.!?"]$/.test(text) && !AVOID.test(text) && !/[;:()]/.test(text));
  usable.sort((a, b) => cost(a) - cost(b) || Number(a.id) - Number(b.id));
  return usable[0];
}

function cost({ text }) {
  return Math.abs(text.length - 60) + (NAMES.test(text) ? 40 : 0);
}
