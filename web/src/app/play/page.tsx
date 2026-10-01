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

export default function PlayPage() {
  const game = useGame();
  const { round, run } = game;
  const [dismissedRound, setDismissedRound] = useState<string | null>(null);
  const [selected, setSelected] = useState<Round | null>(null);
  const [panel, setPanel] = useState<"theory" | "hints" | "conclusion" | null>(null);
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
  const error = game.error && <section className="game-error" role="alert">
    <p>{game.error}</p>
    <button className="button" disabled={game.busy} onClick={game.expired ? newRun : game.retry}>{game.expired ? "Start a new run" : "Retry"}</button>
    <Link href="/">Back home</Link>
  </section>;
  if (!round || !run) return <main className="loading">{error || <p role="status">Setting the type…</p>}</main>;

  const finished = game.finished;
  const activeEntry = selected ?? (finished && dismissedRound !== round.id ? round : null);
  const hintsUsed = round.hintsUsed;
  const nextHint = hintsUsed + 1;
  const hintAvailable = nextHint <= 2 && round.rows.length >= nextHint * 2;
  const openConclusion = () => { setDismissedRound(round.id); setPanel("conclusion"); };

  return <main className="app game-app">
    <header className="topbar">
      <BackButton href="/" />
      <h1 className="wordmark">Wordle</h1>
      <ProfileButton />
    </header>
    <div className="run-progress">
      <ol aria-label={`Word ${run.started} of ${run.length}`}>{Array.from({ length: run.length }, (_, i) => <li key={i} data-complete={i < run.finished} aria-current={i === run.started - 1 ? "step" : undefined}><span className="sr-only">Word {i + 1}{i < run.finished ? ", complete" : i === run.started - 1 ? ", current" : ", upcoming"}</span></li>)}</ol>
    </div>
    {run.completedWords.length > 0 && <section className="word-strip" aria-label="Words discovered">
      {run.completedWords.map((word) => <button key={word.id} onClick={() => setSelected(word)} aria-label={`Read ${word.answer}, ${word.state === "won" ? "solved" : "revealed"}`}>{word.answer}<span aria-hidden>{word.state === "won" ? " ·" : " ○"}</span></button>)}
    </section>}
    <div className="rule" />
    <div className="board-area"><Board rows={round.rows} draft={game.draft} wordLength={round.wordLength} maxRows={round.maxRows} revealingRow={game.revealingRow} shake={game.shake} /></div>
    <div className="sr-only" role="status" aria-live="polite">{game.revealingRow === null && round.rows.length > 0 ? round.rows.at(-1)?.guess.split("").map((letter, i) => `${letter}: ${MARK_LABEL[round.rows.at(-1)!.marks[i]]}`).join("; ") : ""}</div>
    <div className="game-tools">
      <button className="text-button" disabled={game.busy || game.revealingRow !== null || (round.state !== "playing" && !hintsUsed)} onClick={() => setPanel("hints")}>{hintsUsed ? `Hint · ${hintsUsed}/2` : "Hint"}</button>
      <button className="text-button" disabled={!run.finished} onClick={() => setPanel("theory")}>My theory{game.theory ? " · saved" : ""}</button>
    </div>
    <div className="rule" />
    {finished ? <div className="finished-actions">
      <button className="button button--quiet" onClick={() => setSelected(round)}>Word entry</button>
      <button className="button" disabled={game.busy} onClick={run.complete ? openConclusion : advance}>{run.complete ? "Uncover the connection" : "Next word"}</button>
    </div> : <Keyboard letterStates={game.letterStates} onKey={game.typeLetter} onEnter={game.submit} onBackspace={game.backspace} disabled={game.inputDisabled} />}
    {game.message && <div className="toast" role="status">{game.message}</div>}
    {error && <Dialog title="Game interrupted" onClose={() => { void game.retry(); }}>{error}</Dialog>}
    {!game.error && !panel && activeEntry && <Entry key={activeEntry.id} round={activeEntry} onClose={() => { setSelected(null); setDismissedRound(round.id); }} action={activeEntry.id === round.id ? (run.complete ? openConclusion : advance) : undefined} actionLabel={run.complete ? "Uncover the connection" : "Next word"} busy={game.busy} />}
    {!game.error && panel === "theory" && <Dialog title="My theory" onClose={() => setPanel(null)}>
      <label htmlFor="theory">What connects these words?</label>
      <textarea id="theory" maxLength={280} value={game.theory} onChange={(e) => game.updateTheory(e.target.value)} placeholder="An idea, a pattern, a possibility…" />
      <p className="hint">Saved on this device as you type. Private, optional, and unscored.</p>
      <button className="button" onClick={() => setPanel(null)}>Back to the words</button>
    </Dialog>}
    {!game.error && panel === "hints" && <Dialog title="A small nudge" onClose={() => setPanel(null)}>
      <p>Clues suggest a direction. The deduction is still yours.</p>
      <ol className="hint-list">{round.hints.map((hint) => <li key={hint.tier}><strong>{hint.tier === 1 ? "Context" : "Association"}</strong><p>{hint.text}</p></li>)}</ol>
      {round.state === "playing" && nextHint <= 2 && <>
        <p className="hint">{hintAvailable ? "Using a hint marks this word as assisted. Your points stay the same." : `The next hint unlocks after ${nextHint * 2} accepted guesses.`}</p>
        <button className="button" disabled={!hintAvailable || game.busy} onClick={game.requestHint}>{game.busy ? "Opening…" : nextHint === 1 ? "Reveal context" : "Reveal association"}</button>
      </>}
      {hintsUsed === 2 && <p className="hint">Both hints revealed. No letters are given away.</p>}
    </Dialog>}
    {!game.error && panel === "conclusion" && <RunConclusion run={run} theory={game.theory} onClose={() => setPanel(null)} onNewRun={newRun} busy={game.busy} />}
  </main>;
}
