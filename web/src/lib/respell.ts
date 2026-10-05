/**
 * Turns an IPA transcription into a sounds-like spelling a reader can say
 * without learning IPA: "ˈsɜːkə" -> "SUR-kuh", "təʊst" -> "tohst".
 *
 * The sound-to-letters key follows Wikipedia's pronunciation respelling key
 * (Help:Pronunciation respelling key), so the mapping is fixed rather than
 * guessed per word. Syllables are split at the transcription's stress marks
 * and otherwise between vowels; the stressed syllable is in capitals.
 */

// Longest first, so "eɪ" wins over "e" and "tʃ" over "t".
const VOWELS: [string, string][] = [
  ["aɪə", "eye-uh"], ["aʊə", "ow-uh"],
  ["ɪə", "eer"], ["ɛə", "air"], ["eə", "air"], ["ɛː", "air"], ["ʊə", "oor"],
  ["eɪ", "ay"], ["aɪ", "eye"], ["ɔɪ", "oy"], ["aʊ", "ow"], ["əʊ", "oh"], ["oʊ", "oh"],
  ["ɑː", "ah"], ["ɔː", "aw"], ["ɜː", "ur"], ["iː", "ee"], ["uː", "oo"],
  ["æ", "a"], ["ɛ", "e"], ["e", "e"], ["ɪ", "i"], ["ᵻ", "i"], ["ɨ", "i"], ["i", "ee"],
  ["ɒ", "o"], ["ʌ", "u"], ["ʊ", "uu"], ["u", "oo"], ["ʉ", "oo"],
  ["ə", "uh"], ["ɐ", "uh"], ["ɚ", "er"], ["ɝ", "ur"], ["ɜ", "ur"],
  ["a", "a"], ["ɑ", "ah"], ["ɔ", "aw"], ["o", "oh"],
];

const CONSONANTS: [string, string][] = [
  ["tʃ", "ch"], ["dʒ", "j"], ["θ", "th"], ["ð", "dh"], ["ʃ", "sh"], ["ʒ", "zh"], ["ŋ", "ng"],
  ["j", "y"], ["ɹ", "r"], ["r", "r"], ["ɡ", "g"], ["g", "g"], ["x", "kh"], ["ʍ", "wh"], ["ɾ", "t"], ["ɫ", "l"],
  ...["b", "d", "f", "h", "k", "l", "m", "n", "p", "s", "t", "v", "w", "z"].map((c): [string, string] => [c, c]),
];

// Open-syllable vowels spelled so they cannot be misread: "BIH-luh", not "BI-luh".
const OPEN: Record<string, string> = { i: "ih", u: "uh", e: "eh" };

// Short vowels, which hold on to the consonant after them: "LUK-ee", not
// "LUH-kee".
const CHECKED = new Set(["æ", "ɛ", "e", "ɪ", "ɒ", "ʌ", "ʊ"]);

// Two-consonant onsets English allows, kept together when splitting syllables.
const ONSETS = new Set(["pl", "pr", "bl", "br", "tr", "dr", "kl", "kr", "gl", "gr", "fl", "fr", "thr", "sp", "st", "sk", "sm", "sn", "sl", "sw", "tw", "kw", "shr", "spr", "str", "skr", "spl"]);

type Sound = { ipa: string; out: string; vowel: boolean; stress?: boolean };

function tokens(ipa: string): Sound[] {
  // Optional sounds such as the (t) in "sɪn(t)s" are left out, and so are
  // glottal stops and diacritics, which nothing in the respelling shows. A
  // syllabic consonant ("ˈlɪtl̩") is read with a schwa before it: "LIT-uhl".
  const text = ipa
    .replace(/\([^)]*\)/g, "")
    .replace(/[ʔʰ̥̃̚]/g, "")
    .replace(/(.)̩/g, "ə$1");
  const out: Sound[] = [];
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === "ˈ" || ch === "ˌ") {
      out.push({ ipa: ch, out: "", vowel: false, stress: true });
      i++;
      continue;
    }
    const v = VOWELS.find(([k]) => text.startsWith(k, i));
    const c = v ? undefined : CONSONANTS.find(([k]) => text.startsWith(k, i));
    const hit = v ?? c;
    if (hit) { out.push({ ipa: hit[0], out: hit[1], vowel: !!v }); i += hit[0].length; }
    else i++; // Anything unknown is skipped rather than shown raw.
  }
  return out;
}

export function respell(ipa: string | undefined): string | undefined {
  if (!ipa) return undefined;
  const sounds = tokens(ipa);
  // Syllables: a list of sounds, plus whether it carries primary stress.
  const syllables: { sounds: Sound[]; stressed: boolean }[] = [{ sounds: [], stressed: false }];
  for (let i = 0; i < sounds.length; i++) {
    const s = sounds[i];
    if (s.stress) {
      if (syllables.at(-1)!.sounds.length) syllables.push({ sounds: [], stressed: false });
      syllables.at(-1)!.stressed = s.ipa === "ˈ";
      continue;
    }
    const current = syllables.at(-1)!;
    if (s.vowel && current.sounds.some((x) => x.vowel)) {
      // A second vowel in this syllable: split, moving the consonants that
      // can begin a syllable over to the new one.
      const tail: Sound[] = [];
      while (current.sounds.length && !current.sounds.at(-1)!.vowel) tail.unshift(current.sounds.pop()!);
      let keep = tail.length ? 1 : 0;
      for (let n = tail.length; n >= 2; n--) {
        if (ONSETS.has(tail.slice(-n).map((x) => x.out).join(""))) { keep = n; break; }
      }
      const before = current.sounds.findLast((x) => x.vowel);
      if (keep > 0 && keep === tail.length && before && CHECKED.has(before.ipa)) keep--;
      current.sounds.push(...tail.slice(0, tail.length - keep));
      syllables.push({ sounds: [...tail.slice(tail.length - keep), s], stressed: false });
      continue;
    }
    current.sounds.push(s);
  }
  const parts = syllables.filter((syl) => syl.sounds.length).map((syl) => {
    const last = syl.sounds.at(-1)!;
    let text = syl.sounds.map((x) => (x === last && x.vowel && OPEN[x.out]) || x.out).join("");
    // "eye" after a consonant reads as part of a longer word: "NYN", "py".
    text = text.replace(/([bcdfghjklmnprstvwz])eye/g, "$1y");
    return { text, stressed: syl.stressed };
  });
  if (parts.length === 1) return parts[0].text;
  return parts.map((p) => (p.stressed ? p.text.toUpperCase() : p.text)).join("-");
}
