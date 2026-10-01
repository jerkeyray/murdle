"use client";

import { useEffect, useState } from "react";
import { getSavedWords, setWordSaved, type Round } from "@/lib/api";
import { shareRound } from "@/lib/shareCard";
import { Dialog } from "./Dialog";
import { Board } from "./Board";

export function Entry({ round, onClose, action, actionLabel, busy = false }: {
  round: Round; onClose: () => void; action?: () => void; actionLabel?: string; busy?: boolean;
}) {
  const [kept, setKept] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keepError, setKeepError] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareLabel, setShareLabel] = useState("");
  useEffect(() => {
    let cancelled = false;
    getSavedWords().then((words) => {
      if (!cancelled) setKept(words.some((word) => word.word === round.answer));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [round.answer]);
  async function toggleKeep() {
    if (!round.answer || saving) return;
    setSaving(true); setKeepError("");
    try { await setWordSaved(round.answer, !kept); setKept(!kept); }
    catch { setKeepError("Could not save this word. Sign in to keep words, or try again."); }
    finally { setSaving(false); }
  }
  async function onShare() {
    if (sharing) return;
    setSharing(true);
    try {
      // "Saved" on a desktop, where the share sheet does not exist and the
      // image lands in downloads instead.
      const how = await shareRound(round);
      setShareLabel(how === "downloaded" ? "Saved as an image" : "Shared");
    } catch {
      setShareLabel("Could not make the image");
    } finally {
      setSharing(false);
    }
  }

  return (
    <Dialog title="Word entry" onClose={onClose}>
      <div className="entry-head">
        <p>{round.state === "won" ? `Solved in ${round.solvedRow + 1}` : "Out of guesses"}</p>
        <p>{round.points} {round.points === 1 ? "point" : "points"}</p>
      </div>
      <h2 className="entry-word">{round.answer}</h2>
      {round.hintsUsed > 0 && <p className="assisted">Assisted · {round.hintsUsed} {round.hintsUsed === 1 ? "hint" : "hints"}</p>}
      {round.entry && <>
        <p className="entry-definition">{round.entry.definition}</p>
        <details className="word-history"><summary>Read more</summary><p className="entry-note">{round.entry.note}</p></details>
      </>}
      <details className="board-review"><summary>Inspect finished board</summary>
        <Board rows={round.rows} draft="" wordLength={round.wordLength} maxRows={round.maxRows} revealingRow={null} shake={false} />
      </details>
      <div className="entry-tools">
        <button className="text-button" disabled={saving} onClick={toggleKeep} aria-pressed={kept}>{kept ? "Kept in your lexicon" : "Keep this word"}</button>
        <button className="text-button" disabled={sharing} onClick={onShare}>
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 15V3m0 0L8 7m4-4 4 4" /><path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
          </svg>
          {sharing ? "Making the image…" : shareLabel || "Share this word"}
        </button>
      </div>
      {keepError && <p role="status" className="form-error">{keepError}</p>}
      <div className="entry-actions">
        <button className="button button--quiet" onClick={onClose}>Back to board</button>
        {action && <button className="button" disabled={busy} onClick={action}>{busy ? "Please wait…" : actionLabel}</button>}
      </div>
    </Dialog>
  );
}
