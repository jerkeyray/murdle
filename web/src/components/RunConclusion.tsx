"use client";

import type { Run } from "@/lib/api";
import { Dialog } from "./Dialog";

export function RunConclusion({ run, theory, onClose, onNewRun, busy }: {
  run: Run; theory: string; onClose: () => void; onNewRun: () => void; busy: boolean;
}) {
  if (!run.pack) return null;
  const assisted = run.completedWords.filter((r) => r.hintsUsed > 0).length;
  return <Dialog title="The connection" onClose={onClose}>
    <h2 className="conclusion-title">{run.pack.title}</h2>
    <p className="entry-definition">{run.pack.blurb}</p>
    <p className="run-result">{run.completedWords.filter((r) => r.state === "won").length} of {run.length} solved · {run.points} points{assisted > 0 ? ` · ${assisted} assisted` : " · Unassisted"}</p>
    <section className="theory-comparison">
      <h3>Your theory</h3>
      <p>{theory.trim() || "You left the connection unwritten."}</p>
      <span className="hint">Your interpretation may differ. There is no score for matching the wording.</span>
    </section>
    <ol className="connection-list">
      {run.pack.connections.map((item) => <li key={item.word}><strong>{item.word}</strong><p>{item.explanation}</p></li>)}
    </ol>
    <div className="entry-actions">
      <button className="button button--quiet" onClick={onClose}>Review words</button>
      <button className="button" disabled={busy} onClick={onNewRun}>{busy ? "Please wait…" : "New run"}</button>
    </div>
  </Dialog>;
}
