"use client";

import { useSyncExternalStore } from "react";

/**
 * One row, spelled out.
 *
 * Three rows of near-invisible tiles were decoration pretending to be a board.
 * A single row in a solid fill, set in the same serif as the wordmark, is the
 * signature instead: one confident shape rather than eighteen that whisper.
 *
 * The fill is the colour that already means "right letter, right place", so a
 * whole row of it says "solved" in the game's own grammar rather than inventing
 * a decorative colour that means nothing.
 */
// This is a tiny invitation to the kind of word the game is for, rather than
// generic interface copy such as “learn” or “begin”.
const WORDS = ["mirth", "quill", "lumen", "verse", "sable", "brisk", "vivid", "waltz"];

/**
 * Read as an external store rather than computed in render: the server and the
 * browser can disagree about the date across midnight, and a hydration mismatch
 * is not worth a flourish. The server sees nothing, so the empty row filling in
 * on the client is the load animation.
 */
const neverChanges = () => () => {};
const wordForToday = () => WORDS[Math.floor(Date.now() / 86_400_000) % WORDS.length];
const noWordOnServer = () => null;

export function HomeRow() {
  const word = useSyncExternalStore(neverChanges, wordForToday, noWordOnServer);

  return (
    <div className="home-row" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className="home-tile"
          data-filled={word ? true : undefined}
          style={{ animationDelay: `${i * 55}ms` }}
        >
          {word?.[i] ?? ""}
        </span>
      ))}
    </div>
  );
}
