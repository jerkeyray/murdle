"use client";

import { useEffect, useState } from "react";
import { BackButton } from "@/components/BackButton";
import { getWordStats, type WordStats } from "@/lib/api";

const number = (n: number) => n.toLocaleString("en-GB");
const percent = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : "–");

const DIFFICULTIES = [
  { key: "familiar", name: "Familiar", note: "nearly everyone knows it" },
  { key: "stretch", name: "Stretch", note: "many recognise it, few use it" },
  { key: "challenging", name: "Challenging", note: "most educated adults could not define it" },
] as const;

/**
 * About the words, reached by the question mark on the home screen.
 *
 * Every number here comes from the server's own word bank, so it is what the
 * game is dealing right now and cannot drift. Only the prose is written by hand.
 */
export default function AboutPage() {
  const [stats, setStats] = useState<WordStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getWordStats()
      .then((s) => { if (!cancelled) { setStats(s); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [attempt]);

  return (
    <main className="sheet about">
      <header className="sheet-head">
        <BackButton href="/" />
        <h1 className="sheet-title">About the words</h1>
      </header>

      {failed && <div className="about-card about-failed" role="alert">
        <p>The word figures could not be loaded just now.</p>
        <button className="button button--quiet" onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}>Try again</button>
      </div>}
      {!stats && !failed && <p className="about-quiet about-loading" role="status">Counting…</p>}

      {stats && <>
        <section className="about-hero" aria-label="Totals">
          <p className="about-big">{number(stats.answers)}</p>
          <p className="about-quiet">answers, each with a definition, a note and two clues</p>
          <p className="about-quiet">You can guess from {number(stats.dictionary)} words.</p>
        </section>

        <section aria-labelledby="about-levels">
          <div className="block-head"><h2 id="about-levels" className="label">How hard</h2></div>
          <div className="about-card">
            {stats.lengths.map((l) => <div className="about-length" key={l.length}>
              <div className="about-length-head"><strong>{l.length} letters</strong><span>{number(l.total)}</span></div>
              <div className="about-bar" role="img" aria-label={`${l.length}-letter words: ${l.familiar} familiar, ${l.stretch} stretch, ${l.challenging} challenging`}>
                {DIFFICULTIES.map((d) => <span key={d.key} className={`about-seg about-seg--${d.key}`} style={{ flexGrow: l[d.key] }} />)}
              </div>
              <ul className="about-counts">
                {DIFFICULTIES.map((d) => <li key={d.key}><span className={`about-dot about-seg--${d.key}`} aria-hidden />{d.name} {number(l[d.key])}</li>)}
              </ul>
            </div>)}
            <dl className="about-legend">
              {DIFFICULTIES.map((d) => <div key={d.key}><dt>{d.name}</dt><dd>{d.note}</dd></div>)}
            </dl>
            <p className="about-quiet">{number(stats.slang)} of the answers are slang. Vocabulary settings change the mix: Learning drops the familiar words, Hard keeps only stretch and challenging ones.</p>
          </div>
        </section>

        <section aria-labelledby="about-sources">
          <div className="block-head"><h2 id="about-sources" className="label">Where it comes from</h2></div>
          <div className="about-card">
            <dl className="about-sources">
              <div><dt>Definition, note, clues, difficulty</dt><dd>Written by AI. No lexicographer has read every entry.</dd></div>
              <div><dt>Pronunciation</dt><dd>Wiktionary · {percent(stats.coverage.pronunciation, stats.answers)} of words</dd></div>
              <div><dt>Part of speech</dt><dd>Wiktionary, then WordNet · {percent(stats.coverage.partOfSpeech, stats.answers)}</dd></div>
              <div><dt>Origin</dt><dd>Wiktionary · {percent(stats.coverage.origin, stats.answers)}</dd></div>
              <div><dt>Example sentence</dt><dd>Wiktionary, WordNet or Tatoeba · {percent(stats.coverage.example, stats.answers)}</dd></div>
              <div><dt>Words you may guess</dt><dd>SCOWL, the list behind aspell</dd></div>
            </dl>
            <p className="about-quiet">The AI-written parts can be wrong. Treat an origin in a note as a good-faith claim, and expect the difficulty labels to be a model&rsquo;s judgement rather than something measured from players.</p>
          </div>
        </section>
      </>}

      <section aria-labelledby="about-credits">
        <div className="block-head"><h2 id="about-credits" className="label">Credits</h2></div>
        <div className="about-card">
          <ul className="about-credits">
            <li><a href="https://en.wiktionary.org" rel="noreferrer">Wiktionary</a> via <a href="https://kaikki.org" rel="noreferrer">kaikki.org</a>: pronunciations, origins and some examples, under <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noreferrer">CC BY-SA 4.0</a>.</li>
            <li><a href="https://tatoeba.org" rel="noreferrer">Tatoeba</a>: example sentences, under <a href="https://creativecommons.org/licenses/by/2.0/fr/" rel="noreferrer">CC BY 2.0 FR</a>.</li>
            <li><a href="https://wordnet.princeton.edu" rel="noreferrer">WordNet</a>: parts of speech and examples, &copy; Princeton University.</li>
            <li><a href="http://wordlist.aspell.net/" rel="noreferrer">SCOWL</a>: the list of words you can guess.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
