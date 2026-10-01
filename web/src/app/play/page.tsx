"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { Board } from "@/components/Board";
import { Keyboard } from "@/components/Keyboard";
import { Entry } from "@/components/Entry";
import { ProfileButton } from "@/components/ProfileButton";
import { useGame } from "@/lib/useGame";

export default function PlayPage() {
  const game = useGame();
  const { round, run } = game;

  if (!round) {
    return (
      <div className="loading">
        <span className="label">{game.message ?? "Setting the type"}</span>
      </div>
    );
  }

  const wordNumber = run ? Math.max(run.started, 1) : 1;

  return (
    <main className="app">
      <header className="topbar">
        <Link href="/" className="specimen specimen--link">
          &#8470;&nbsp;{String(wordNumber).padStart(2, "0")}
        </Link>
        <h1 className="wordmark">Murdle</h1>
        <ProfileButton />
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
