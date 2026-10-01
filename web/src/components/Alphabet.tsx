"use client";

import type { SolveRecord } from "@/lib/api";

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

interface AlphabetProps {
  solves: SolveRecord[];
}

/**
 * Which letters you have a word for.
 *
 * A stamp album rather than a statistic. It turns the pool into something with
 * gaps you can see, and the gaps are the interesting part — nobody has a Q yet.
 */
export function Alphabet({ solves }: AlphabetProps) {
  const counts = new Map<string, number>();
  for (const s of solves) {
    const first = s.word[0];
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }

  const collected = LETTERS.filter((l) => counts.has(l)).length;

  return (
    <section className="alphabet-block">
      <div className="block-head">
        <span className="label">Your alphabet</span>
        <span className="label">{collected} of 26</span>
      </div>

      <div className="alphabet">
        {LETTERS.map((letter) => {
          const n = counts.get(letter) ?? 0;
          return (
            <span
              className="alphabet-letter"
              key={letter}
              data-has={n > 0 ? "true" : undefined}
              title={n > 0 ? `${n} word${n === 1 ? "" : "s"}` : "none yet"}
            >
              {letter}
              {n > 1 ? <span className="alphabet-count">{n}</span> : null}
            </span>
          );
        })}
      </div>
    </section>
  );
}
