"use client";

import { AnimatePresence, motion } from "motion/react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { Board } from "@/components/Board";
import { Keyboard } from "@/components/Keyboard";
import { Settings } from "@/components/Settings";
import { Entry } from "@/components/Entry";
import { TurnBand } from "@/components/TurnBand";
import { useGame } from "@/lib/useGame";
import { getSeats, getServerSeats, parseMode, subscribeSeats } from "@/lib/seats";

export default function PlayPage() {
  const params = useParams<{ mode: string }>();
  const router = useRouter();
  const mode = parseMode(params.mode);

  // Names live in localStorage, which the server cannot read, so they arrive
  // just after hydration.
  const { names } = useSyncExternalStore(
    subscribeSeats,
    getSeats,
    getServerSeats,
  );

  useEffect(() => {
    if (!mode) router.replace("/");
  }, [mode, router]);

  const game = useGame(mode ?? "solo");
  const { round, run } = game;

  if (!mode || !round) {
    return (
      <div className="loading">
        <span className="label">{game.message ?? "Setting the type"}</span>
      </div>
    );
  }

  const duel = round.mode === "duel";

  // Which word of the run this is. In a duel two boards share a word, so this
  // counts words rather than boards — the specimen number and the turn band
  // must not disagree about where you are.
  const seats = run?.seats ?? 1;
  const wordNumber = run ? Math.floor((Math.max(run.started, 1) - 1) / seats) + 1 : 1;
  // A board belongs to one player for its whole life, so this is who is
  // holding the phone right now.
  const seat = round.seat;

  return (
    <main className="app">
      <header className="topbar">
        <Link href="/" className="specimen specimen--link">
          &#8470;&nbsp;{String(wordNumber).padStart(2, "0")}
        </Link>
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
          // Only tint when there is someone to tell apart.
          activeSeat={duel ? seat : null}
        />
      </div>

      <div className="rule" />

      {duel ? (
        <TurnBand
          seat={seat}
          name={names[seat] ?? `Player ${seat + 1}`}
          word={wordNumber}
          of={run?.wordCount ?? 5}
        />
      ) : null}

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
            names={names}
            onNextBoard={game.nextWord}
            onNewRun={game.newRun}
          />
        ) : null}
      </AnimatePresence>
    </main>
  );
}
