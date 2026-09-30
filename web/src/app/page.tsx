"use client";

import { AnimatePresence, motion } from "motion/react";
import { Board } from "@/components/Board";
import { Keyboard } from "@/components/Keyboard";
import { Settings } from "@/components/Settings";
import { useGame } from "@/lib/useGame";

export default function Page() {
  const game = useGame("solo");
  const { round } = game;

  if (!round) {
    return (
      <div className="loading">
        {game.message ?? "Loading"}
      </div>
    );
  }

  const won = round.state === "won";

  return (
    <main className="app">
      <header className="topbar">
        <h1 className="wordmark">Murdle</h1>
        <Settings />
      </header>

      <div className="board-area">
        <Board
          rows={round.rows}
          draft={game.draft}
          wordLength={round.wordLength}
          maxRows={round.maxRows}
          revealingRow={game.revealingRow}
          shake={game.shake}
        />
      </div>

      <Keyboard
        letterStates={game.letterStates}
        onKey={game.typeLetter}
        onEnter={game.submit}
        onBackspace={game.backspace}
        disabled={game.inputDisabled}
      />

      <AnimatePresence>
        {game.message && !game.finished ? (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {game.message}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {game.finished ? (
          <motion.div
            className="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              className="result"
              role="dialog"
              aria-label="Round over"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            >
              <p className="result-eyebrow">
                {won
                  ? `Solved in ${round.solvedRow + 1}`
                  : "Out of guesses"}
              </p>
              <h2 className="result-word">{round.answer}</h2>

              <p className="result-meta">
                {won
                  ? `Worth ${round.scores[0]} ${round.scores[0] === 1 ? "point" : "points"}.`
                  : "No points this round."}
              </p>

              <p className="result-pending">
                The learn card lands here — what it means, where it came from,
                and a sentence worth stealing.
              </p>

              <div className="result-actions">
                <button
                  className="button button--primary"
                  onClick={game.newRound}
                  autoFocus
                >
                  New word
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
