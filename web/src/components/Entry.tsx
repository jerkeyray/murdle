"use client";

import { motion } from "motion/react";
import type { Round } from "@/lib/api";

interface EntryProps {
  round: Round;
  wordNumber: number;
  onNewRound: () => void;
}

/**
 * The end of a round, presented as a dictionary entry — because an entry is
 * what the round produced.
 *
 * The definition, etymology and example sentence arrive with the word pipeline
 * in Phase 3. Until they exist the frame says so plainly; filling the space
 * with placeholder prose would only have to be thrown away, and would teach
 * the player nothing in the meantime.
 */
export function Entry({ round, wordNumber, onNewRound }: EntryProps) {
  const won = round.state === "won";
  const points = round.scores[0] ?? 0;

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
            &#8470;&nbsp;{String(wordNumber).padStart(3, "0")}
          </span>
        </div>

        <h2 className="entry-word">{round.answer}</h2>

        {/* The round replayed as marks. Real content, and the thing worth
            screenshotting. */}
        <div className="entry-grid" aria-hidden>
          {round.rows.map((row, i) => (
            <div className="entry-grid-row" key={i}>
              {row.marks.map((mark, j) => (
                <span className="pip" data-mark={mark} key={j} />
              ))}
            </div>
          ))}
        </div>

        <div className="entry-rule" />

        <p className="entry-pending">
          <em>Definition, origin and a sentence worth stealing</em> land here
          once the word pipeline is built.
        </p>

        <div className="entry-rule" />

        <span className="label">
          {won
            ? `${points} ${points === 1 ? "point" : "points"}`
            : "No points"}
        </span>

        <div className="entry-actions">
          <button className="button" onClick={onNewRound} autoFocus>
            Next word
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
