"use client";

import { AnimatePresence, motion } from "motion/react";
import { Board } from "@/components/Board";
import { Keyboard } from "@/components/Keyboard";
import { Settings } from "@/components/Settings";
import { Entry } from "@/components/Entry";
import { useGame } from "@/lib/useGame";

export default function Page() {
  const game = useGame("solo");
  const { round } = game;

  if (!round) {
    return (
      <div className="loading">
        <span className="label">{game.message ?? "Setting the type"}</span>
      </div>
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <span className="specimen">
          {/* Which word of the run this is. Padded so the header does not
              reflow between single and double digits. */}
          &#8470;&nbsp;{String(game.run?.started ?? 1).padStart(2, "0")}
        </span>
        <h1 className="wordmark">Murdle</h1>
        <Settings />
      </header>

      <div className="rule" />

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

      <div className="rule" />

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
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {game.message}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {game.finished ? (
          <Entry
            round={round}
            run={game.run}
            onNextWord={game.nextWord}
            onNewRun={game.newRun}
          />
        ) : null}
      </AnimatePresence>
    </main>
  );
}
