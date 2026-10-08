"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Board, MARK_LABEL } from "@/components/Board";
import { BackButton } from "@/components/BackButton";
import { Keyboard } from "@/components/Keyboard";
import { Entry } from "@/components/Entry";
import { Dialog } from "@/components/Dialog";
import { ProfileButton } from "@/components/ProfileButton";
import { useGame } from "@/lib/useGame";
import type { Round } from "@/lib/api";
import { Loader } from "@/components/Loader";
import type { GameConfig } from "@/lib/session";

export default function PlayPage() {
  return <Suspense fallback={<main className="loading"><Loader label="Setting the type" /></main>}><ConfiguredPlayScreen /></Suspense>;
}

function ConfiguredPlayScreen() {
  const search = useSearchParams();
  const wordLength = search.get("length") === "6" ? 6 : 5;
  const difficulty = search.get("difficulty") === "learning" ? "learning" : "mixed";
  return <PlayScreen key={`${wordLength}:${difficulty}`} config={{wordLength, difficulty}} />;
}

function PlayScreen({config}: {config: GameConfig}) {
  const game = useGame(config);
  const { round, run } = game;
  const [dismissedRound, setDismissedRound] = useState<string | null>(null);
  const [selected, setSelected] = useState<Round | null>(null);
  const [panel, setPanel] = useState<"hints" | null>(null);
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

  const advance = () => {
    setPanel(null);setSelected(null);setDismissedRound(round.id);
    void game.newRun();
  };

  const finished = game.finished;
  const activeEntry = selected ?? (finished && dismissedRound !== round.id ? round : null);
  const hintsUsed = round.hintsUsed;
  const hintAvailable = hintsUsed === 0 && round.rows.length >= 3;

  return <main className="app game-app">
    <header className="topbar">
      <BackButton href="/" />
      <div className="game-heading">
        <h1 className="wordmark">Wordle</h1>
        {/* Not shown: which word you are on is obvious from the strip of solved
            words. It stays for screen readers, who get none of that. */}
        <p className="sr-only" role="status">Word {run.started} of {run.length}</p>
      </div>
      <ProfileButton />
    </header>
    <div className="board-area">
      <div className="board-stage">
      <Board rows={round.rows} draft={game.draft} wordLength={round.wordLength} maxRows={round.maxRows} revealingRow={game.revealingRow} shake={game.shake} onDraftTileSelect={game.selectDraftTile} draftCursor={game.draftCursor} />
      {!finished && <button className="icon-button hint-button game-hint" disabled={game.busy || game.revealingRow !== null || (round.state !== "playing" && !hintsUsed)} onClick={() => setPanel("hints")} aria-label={hintsUsed ? "Clue used" : "Clue"} title={hintsUsed ? "Clue used" : "Clue"}>
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
      <button className="button" disabled={game.busy} onClick={advance}>Next word</button>
    </div> : <>
      <Keyboard letterStates={game.letterStates} onKey={game.typeLetter} onBackspace={game.backspace} disabled={game.inputDisabled} />
      {/* Centred rather than stretched edge to edge, so the thing you press on
          every guess sits under the thumb instead of spanning the screen. */}
      <div className="play-actions">
        <button className="button keyboard-submit" data-state={game.enterState} disabled={game.inputDisabled || game.enterState === "incomplete"} onClick={game.submit}>Submit</button>
      </div>
    </>}
    {game.message && <div className="toast" role="status">{game.message}</div>}
    {error && <Dialog title="Game interrupted" onClose={() => { void game.retry(); }}>{error}</Dialog>}
    {!game.error && !panel && activeEntry && <Entry key={activeEntry.id} round={activeEntry} onClose={() => { setSelected(null); setDismissedRound(round.id); }} action={activeEntry.id === round.id ? advance : undefined} actionLabel="Next word" busy={game.busy} />}
    {!game.error && panel === "hints" && <Dialog title="Clue" onClose={() => setPanel(null)} className="clue-dialog">
      <section className="hint-panel">
        {round.hints.length > 0 && <ol className="hint-list">{round.hints.slice(0, 1).map((hint) => <li key={hint.tier}><p>{hint.text}</p></li>)}</ol>}
        {round.state === "playing" && hintsUsed === 0 && <div className="hint-next">
          <p>{hintAvailable ? "A small nudge, without giving away a letter." : "Available after 3 guesses."}</p>
          <button className="button" disabled={!hintAvailable || game.busy} onClick={game.requestHint}>{game.busy ? "Opening…" : "Reveal clue"}</button>
        </div>}
      </section>
    </Dialog>}
  </main>;
}
