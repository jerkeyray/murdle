/**
 * Turns Wiktionary records (as cut down by extract-wiktionary.mjs) into the
 * entry fields: pronunciation, part of speech, origin and example.
 *
 * Wiktionary lists every sense a word has ever had, and our entries mean one
 * of them. The work here is choosing that sense: part of speech and example
 * come from it, so a wrong pick puts a noun example under a verb definition.
 * When the pick is not clear, the field is left out and the word goes to
 * review instead.
 */

const POS = {
  noun: "noun", verb: "verb", adj: "adjective", adv: "adverb", prep: "preposition",
  conj: "conjunction", intj: "interjection", pron: "pronoun",
};

const QUIET_TAGS = ["obsolete", "archaic", "rare", "dialectal", "nonstandard", "historical"];

const STOP = new Set(("a an the of to or and in on at by for with from as is be been being that this " +
  "which who whom what something someone one ones its it their his her into out up about over such " +
  "used especially usually often very more most some any not no").split(" "));

export function tokens(text) {
  return new Set((text.toLowerCase().match(/[a-z]+/g) ?? [])
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map((t) => t.replace(/(ies|es|s|ed|ing|ly)$/, "")));
}

/**
 * Pronunciation: British (Received Pronunciation, or tagged UK), to match the
 * British spelling in our entries. Falls back to an untagged pronunciation,
 * then General American, so a word with only a US transcription still has one.
 */
export function pickPronunciation(records) {
  const sounds = records.flatMap((r) => r.sounds ?? []).filter((s) => /^\/[^/]+\/$/.test(s.ipa));
  const pick = sounds.find((s) => s.tags?.includes("Received-Pronunciation") || s.tags?.includes("UK"))
    ?? sounds.find((s) => !s.tags?.length)
    ?? sounds.find((s) => s.tags?.includes("General-American") || s.tags?.includes("US"));
  // Syllable dots, the non-syllabic mark (noʊ̯m) and tie bars (t͡ʃ) are used
  // on some entries and not others, and the tie bar renders as a stray mark
  // in the app's font; drop them so every pronunciation reads alike.
  return pick?.ipa.slice(1, -1).replaceAll(".", "").replaceAll("\u032F", "").replaceAll("\u0361", "");
}

/**
 * Scores every sense against our definition and returns the best one with
 * how sure we are. `confident` is the gate for filling part of speech and
 * example without review.
 */
export function pickSense(records, definition) {
  // Many entries cover two senses ("A sharp expression of disapproval; or
  // to scold"). The first clause is the primary one, and the one to match.
  const primary = definition.trim().split(/;|,\s+(?:or|also)\s+|\.\s/)[0];
  const ours = tokens(primary);
  // "To scold" is a verb; "To one side" and "To a great depth" are not.
  const verbish = /^to\s(?!(?:a|an|the|one|some|any|no|this|that|great|such)\s)/i.test(primary);
  const nounish = /^(?:a|an|the)\s/i.test(primary);
  const candidates = [];
  for (const r of records) {
    const pos = POS[r.pos];
    if (!pos) continue;
    for (const s of r.senses ?? []) {
      if (!s.glosses?.length) continue;
      const theirs = tokens(s.glosses.join(" "));
      let overlap = 0;
      for (const t of ours) if (theirs.has(t)) overlap++;
      let score = overlap;
      // A definition written "To ..." is a verb in our banks, and Wiktionary
      // writes verb glosses the same way; that agreement is strong evidence.
      // "A ..." and "The ..." mark a noun the same way.
      if (verbish === (pos === "verb")) score += 1;
      if (nounish && pos === "noun") score += 1;
      if (s.tags?.some((t) => QUIET_TAGS.includes(t))) score *= 0.5;
      candidates.push({ pos, sense: s, record: r, score, overlap });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const rival = candidates.find((c) => c.pos !== best.pos);
  const onlyPos = !candidates.some((c) => c.pos !== best.pos && !c.sense.tags?.some((t) => QUIET_TAGS.includes(t)));
  const confident = onlyPos || (best.score >= 2 && (!rival || best.score >= rival.score + 1));
  // Part of speech can be clear while the sense is not (a crane is a bird
  // and a machine, both nouns). An example needs the sense itself: real
  // overlap with our definition, ahead of every other sense.
  const senseClear = confident && best.overlap >= 1 && !candidates.some((c) => c !== best && c.overlap >= best.overlap);
  return { ...best, confident, senseClear, candidates };
}

/** One usage example from the chosen sense, if it is short and uses the word. */
export function pickExample(sense, word) {
  return (sense.examples ?? [])
    .map((x) => x.replace(/\s+/g, " ").trim())
    // A sentence, not a list of phrases such as "a scaly fish a scaly stem".
    .find((x) => x.length >= 20 && x.length <= 140 && /^[A-Z“"']/.test(x) && /[.!?”"]$/.test(x) && x.toLowerCase().includes(word.slice(0, 3)));
}

const CHAIN = new Set(["inh", "inh+", "der", "der+", "uder", "bor", "bor+", "lbor", "slbor", "ubor", "obor", "learned borrowing"]);
const FORMATION = new Set(["af", "affix", "suffix", "suf", "prefix", "pre", "compound", "com", "confix", "blend", "clipping", "surf"]);
// Templates after which the etymology has moved on from this word's own
// line of descent: cognates, doublets, "compare", collapsed detail.
const OFF_LINE = new Set(["cog", "ncog", "noncog", "doublet", "dbt", "col-top", "see"]);
const HEDGED = /^(?:possibly|probably|perhaps|apparently|uncertain|unknown|of (?:uncertain|unknown|obscure)|origin (?:uncertain|unknown)|unclear)/i;
const PERIOD = /^from (early |mid |late )?(\d+(?:st|nd|rd|th)) c\.$/;

/** "Late Latin abbattere" from a template's expansion, without its gloss. */
function etymon(t) {
  return t.expansion
    .replace(/^(?:inherited|borrowed|learned borrowing|semi-learned borrowing|unadapted borrowing|derived) from /i, "")
    // Everything from the gloss on: "Latin inhalāre (“to breathe in”)". The
    // gloss may itself contain parentheses, so cut rather than match pairs.
    .split(/\s+[(“]/)[0]
    // Alternative spellings: "Anglo-Norman voiz, voys, voice" -> the first.
    .split(",")[0]
    .replace(/\s+/g, " ").trim();
}

/**
 * "Anglo-Norman abatre, from Latin battere; in English since the 14th century."
 *
 * Built from the etymology's structured templates rather than its prose,
 * which carries alternative spellings and asides. Middle English is dropped
 * when the chain goes further back (nearly every word passes through it),
 * reconstructed forms are never shown, and the line names only the nearest
 * source and the oldest attested one. Hedged etymologies ("Possibly ...")
 * are left out entirely rather than shown as settled.
 */
export function pickOrigin(record, sense) {
  const prose = (record.etymology ?? "").split("\n").find((l) => l && !/^(?:Etymology tree|PIE word)$/.test(l)) ?? "";
  if (!prose || HEDGED.test(prose.replace(/^the \w+ is /i, ""))) return undefined;
  const chain = [];
  let formation;
  for (const t of record.etymologyTemplates ?? []) {
    if (OFF_LINE.has(t.name)) break;
    if (FORMATION.has(t.name) && !chain.length && !formation) formation = etymon(t);
    if (!CHAIN.has(t.name)) continue;
    const term = String(t.args?.["3"] ?? "");
    const text = etymon(t);
    if (term.startsWith("*") || /^Proto-/.test(text) || term === "-" || !term) continue;
    // Some entries state a step twice ({{inh}} and {{inh+}} for the same word).
    if (!chain.includes(text)) chain.push(text);
  }
  while (chain.length > 1 && /^Middle English /.test(chain[0])) chain.shift();
  let line = chain.length > 1 ? `${chain[0]}, from ${chain.at(-1)}` : chain[0] ?? formation;
  if (!line || line.length > 90) return undefined;
  const period = sense?.attested?.match(PERIOD);
  if (period) line += `; in English since the ${period[1] ?? ""}${period[2]} century`;
  return line;
}
