"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { setWordSaved, type Round, type Run } from "@/lib/api";

interface EntryProps {
  round: Round;
  run: Run | null;
  onNextWord: () => void;
  onNewRun: () => void;
}

/**
 * The end of a round, presented as a dictionary entry — because an entry is
 * what the round produced.
 *
 * When the round was the last of a themed run, the theme is revealed here too.
 * That reveal is the payoff for the whole run: the two of you have been
 * guessing at the connection as well as the words.
 */
export function Entry({ round, run, onNextWord, onNewRun }: EntryProps) {
  const won = round.state === "won";
  const points = round.scores[0] ?? 0;
  const entry = round.entry;
  const runComplete = run?.complete ?? false;

  // Optimistic, and reverted if the call fails. Keeping a word is a small
  // gesture made at the end of a round; waiting on a round trip to acknowledge
  // it would feel broken.
  const [kept, setKept] = useState(false);
  const [keepError, setKeepError] = useState(false);

  async function toggleKeep() {
    if (!round.answer) return;
    const next = !kept;
    setKept(next);
    setKeepError(false);
    try {
      await setWordSaved(round.answer, next);
    } catch {
      setKept(!next);
      // Almost always "not signed in", which is the only reason worth saying.
      setKeepError(true);
    }
  }

  return (
    <motion.div
      className="scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
    >
      <motion.div
        className="entry"
        role="dialog"
        aria-label="Round over"
        initial={{ y: 28, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 28, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      >
        <div className="entry-head">
          <span className="label">
            {won ? `Solved in ${round.solvedRow + 1}` : "Out of guesses"}
          </span>
          <span className="label">
            {won
              ? `${points} ${points === 1 ? "point" : "points"}`
              : "No points"}
          </span>
        </div>

        <div className="entry-word-row">
          <h2 className="entry-word">{round.answer}</h2>
          {entry?.register === "slang" ? (
            <span className="entry-tag">Slang</span>
          ) : null}
        </div>

        {entry ? (
          <>
            <p className="entry-definition">{entry.definition}</p>
            <div className="entry-rule" />
            <p className="entry-note">{entry.note}</p>
          </>
        ) : null}

        {/* The round replayed as marks — the part worth screenshotting. */}
        <div className="entry-grid" aria-hidden>
          {round.rows.map((row, i) => (
            <div className="entry-grid-row" key={i}>
              {row.marks.map((mark, j) => (
                <span className="pip" data-mark={mark} key={j} />
              ))}
            </div>
          ))}
        </div>

        <button
          className="keep"
          onClick={toggleKeep}
          aria-pressed={kept}
          aria-label={kept ? "Kept" : "Keep this word"}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden
               fill={kept ? "currentColor" : "none"}
               stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            <path d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z" />
          </svg>
          {kept ? "Kept" : "Keep"}
        </button>

        {keepError ? (
          <p className="form-error">Sign in to keep words.</p>
        ) : null}

        {runComplete && run?.pack ? (
          <motion.div
            className="reveal"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.35 }}
          >
            <span className="label">The thread</span>
            <h3 className="reveal-title">{run.pack.title}</h3>
            <p className="reveal-blurb">{run.pack.blurb}</p>
          </motion.div>
        ) : null}

        <div className="entry-actions">
          <button
            className="button"
            onClick={runComplete ? onNewRun : onNextWord}
            autoFocus
          >
            {runComplete ? "New run" : "Next word"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
