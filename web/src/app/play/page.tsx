"use client";

import Link from "next/link";
import { useState } from "react";
import { Board, MARK_LABEL } from "@/components/Board";
import { BackButton } from "@/components/BackButton";
import { Keyboard } from "@/components/Keyboard";
import { Entry } from "@/components/Entry";
import { Dialog } from "@/components/Dialog";
import { RunConclusion } from "@/components/RunConclusion";
import { ProfileButton } from "@/components/ProfileButton";
import { useGame } from "@/lib/useGame";
import type { Round } from "@/lib/api";
import { Loader } from "@/components/Loader";

export default function PlayPage() {
  const game = useGame();
  const { round, run } = game;
  const [dismissedRound, setDismissedRound] = useState<string | null>(null);
  const [selected, setSelected] = useState<Round | null>(null);
  const [panel, setPanel] = useState<"hints" | "conclusion" | null>(null);
  const advance = async () => {
    setPanel(null); setSelected(null);
    if (round) setDismissedRound(round.id);
    await game.nextWord();
  };
  const newRun = async () => {
    setPanel(null); setSelected(null);
    if (round) setDismissedRound(round.id);
    await game.newRun();
  };
  // Built like the sign-in gate: a mark, a card, and the way out underneath.
  // Bare on the page, the message and the button were touching and the whole
  // thing floated in an empty screen with nothing to say which app it was.
  const error = game.error && <section className="game-error" role="alert">
    <p className="gate-mark" aria-hidden>Wordle</p>
    <div className="gate-card">
      <p className="game-error-line">{game.error}</p>
      <button className="button" disabled={game.busy} onClick={game.expired ? newRun : game.retry}>{game.expired ? "Start a new run" : "Retry"}</button>
    </div>
    <p className="hint gate-foot"><Link href="/">Back home</Link></p>
  </section>;
  if (!round || !run) return <main className="loading">{error || <Loader label="Setting the type" />}</main>;

  const finished = game.finished;
  const activeEntry = selected ?? (finished && dismissedRound !== round.id ? round : null);
  const hintsUsed = round.hintsUsed;
  const nextHint = hintsUsed + 1;
  // Mirrors game.HintUnlocksAfter on the server: 2*tier + 1 accepted guesses.
  const hintUnlocksAfter = (tier: number) => tier * 2 + 1;
  const hintAvailable = nextHint <= 2 && round.rows.length >= hintUnlocksAfter(nextHint);
  const openConclusion = () => { setDismissedRound(round.id); setPanel("conclusion"); };

  return <main className="app game-app">
    <header className="topbar">
      <BackButton href="/" />
      <div className="game-heading"><h1 className="wordmark">Wordle</h1><p className="game-progress" role="status">Word {run.started} of {run.length}</p></div>
      <ProfileButton />
    </header>
    <div className="board-area">
      <div className="board-stage">
      <Board rows={round.rows} draft={game.draft} wordLength={round.wordLength} maxRows={round.maxRows} revealingRow={game.revealingRow} shake={game.shake} />
      {!finished && <button className="icon-button hint-button game-hint" disabled={game.busy || game.revealingRow !== null || (round.state !== "playing" && !hintsUsed)} onClick={() => setPanel("hints")} aria-label={hintsUsed ? `Hint · ${hintsUsed} of 2 used` : "Hint"} title={hintsUsed ? `Hint · ${hintsUsed}/2` : "Hint"}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M9 18h6M10 21h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.8 1 .9 1.6l.1.6h5.2l.1-.6c.1-.6.4-1.2.9-1.6A6 6 0 0 0 12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
        {hintsUsed > 0 && <span className="hint-count" aria-hidden>{hintsUsed}</span>}
      </button>}
      </div>
    </div>
    <div className="sr-only" role="status" aria-live="polite">{game.revealingRow === null && round.rows.length > 0 ? round.rows.at(-1)?.guess.split("").map((letter, i) => `${letter}: ${MARK_LABEL[round.rows.at(-1)!.marks[i]]}`).join("; ") : ""}</div>
    {finished ? <div className="finished-actions">
      <button className="button button--quiet" onClick={() => setSelected(round)}>Word entry</button>
      <button className="button" disabled={game.busy} onClick={run.complete ? openConclusion : advance}>{run.complete ? "Uncover the connection" : "Next word"}</button>
    </div> : <>
      <Keyboard letterStates={game.letterStates} onKey={game.typeLetter} onBackspace={game.backspace} disabled={game.inputDisabled} />
      <button className="button keyboard-submit" data-state={game.enterState} disabled={game.inputDisabled || game.enterState === "incomplete"} onClick={game.submit}>Submit</button>
    </>}
    {game.message && <div className="toast" role="status">{game.message}</div>}
    {error && <Dialog title="Game interrupted" onClose={() => { void game.retry(); }}>{error}</Dialog>}
    {!game.error && !panel && activeEntry && <Entry key={activeEntry.id} round={activeEntry} onClose={() => { setSelected(null); setDismissedRound(round.id); }} action={activeEntry.id === round.id ? (run.complete ? openConclusion : advance) : undefined} actionLabel={run.complete ? "Uncover the connection" : "Next word"} busy={game.busy} />}
    {!game.error && panel === "hints" && <Dialog title="A small nudge" onClose={() => setPanel(null)}>
      <p>Clues suggest a direction. The deduction is still yours.</p>
      <ol className="hint-list">{round.hints.map((hint) => <li key={hint.tier}><strong>{hint.tier === 1 ? "Context" : "Association"}</strong><p>{hint.text}</p></li>)}</ol>
      {round.state === "playing" && nextHint <= 2 && <>
        <p className="hint">{hintAvailable ? "Using a hint marks this word as assisted. Your points stay the same." : `The next hint unlocks after ${hintUnlocksAfter(nextHint)} accepted guesses.`}</p>
        <button className="button" disabled={!hintAvailable || game.busy} onClick={game.requestHint}>{game.busy ? "Opening…" : nextHint === 1 ? "Reveal context" : "Reveal association"}</button>
      </>}
      {hintsUsed === 2 && <p className="hint">Both hints revealed. No letters are given away.</p>}
    </Dialog>}
    {!game.error && panel === "conclusion" && <RunConclusion run={run} onClose={() => setPanel(null)} onNewRun={newRun} busy={game.busy} />}
  </main>;
}
