"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, getSavedWords, setWordSaved, type Round } from "@/lib/api";
import { shareRound } from "@/lib/shareCard";
import { Dialog } from "./Dialog";
import { Board } from "./Board";

export function Entry({ round, onClose, action, actionLabel, busy = false }: {
  round: Round; onClose: () => void; action?: () => void; actionLabel?: string; busy?: boolean;
}) {
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [kept, setKept] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keepError, setKeepError] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareLabel, setShareLabel] = useState("");
  useEffect(() => {
    let cancelled = false;
    getSavedWords().then((words) => {
      if (!cancelled) setKept(words.some((word) => word.word === round.answer));
    }).catch((err) => { if (!cancelled && err instanceof ApiError && err.status === 401) setNeedsSignIn(true); });
    return () => { cancelled = true; };
  }, [round.answer]);
  async function toggleKeep() {
    if (!round.answer || saving) return;
    if (needsSignIn) { setSaveLabel("Sign in to save words to your collection."); return; }
    setSaving(true); setKeepError(""); setShareLabel("");
    try { await setWordSaved(round.answer, !kept); setKept(!kept); setSaveLabel(kept ? "Removed from saved words" : "Word saved"); }
    catch (err) { if (err instanceof ApiError && err.status === 401) { setNeedsSignIn(true); setSaveLabel("Sign in to save words to your collection."); } else setKeepError("Could not save this word. Please try again."); }
    finally { setSaving(false); }
  }
  async function onShare() {
    if (sharing) return;
    setSharing(true); setShareLabel("");
    try {
      // "Saved" on a desktop, where the share sheet does not exist and the
      // image lands in downloads instead.
      const how = await shareRound(round);
      setShareLabel(how === "cancelled" ? "" : how === "downloaded" ? "Image downloaded" : "Shared");
    } catch {
      setShareLabel("Could not make the image");
    } finally {
      setSharing(false);
    }
  }

  return (
    <Dialog title="Word entry" onClose={onClose} className="entry-dialog">
      <div className="entry-word-row">
        <h2 className="entry-word">{round.answer}</h2>
        <div className="entry-tools">
          <button className="icon-button entry-icon-button" disabled={saving} onClick={toggleKeep} aria-pressed={kept} aria-label={kept ? "Remove from saved words" : "Save this word"} title={kept ? "Remove from saved words" : "Save this word"}>
            <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden fill={kept ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3.8L6 21V4.75Z" />
            </svg>
          </button>
          <button className="icon-button entry-icon-button" disabled={sharing} onClick={onShare} aria-label={sharing ? "Creating share image" : shareLabel || "Share this word"} title={sharing ? "Creating share image" : shareLabel || "Share this word"}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15V3m0 0L8 7m4-4 4 4" /><path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
            </svg>
          </button>

        </div>
      </div>
      {round.hintsUsed > 0 && <p className="assisted">Assisted · {round.hintsUsed} {round.hintsUsed === 1 ? "hint" : "hints"}</p>}
      {round.entry && <>
        <p className="entry-definition">{round.entry.definition}</p>
        <p className="entry-note">{round.entry.note}</p>
      </>}
      <details className="board-review"><summary>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 5 7 7-7 7" /></svg>
        View board
      </summary>
        <Board rows={round.rows} draft="" wordLength={round.wordLength} maxRows={round.maxRows} revealingRow={null} shake={false} />
      </details>
      {(saveLabel || shareLabel) && <p className="entry-feedback" role="status">{shareLabel || saveLabel}{needsSignIn && saveLabel && <><br /><Link href="/sign-in?returnTo=%2Fplay">Sign in</Link></>}</p>}
      {keepError && <p role="status" className="form-error">{keepError}</p>}
      <div className="entry-actions">
        {action ? <button className="button" disabled={busy} onClick={action}>{busy ? "Please wait…" : actionLabel}</button> : <button className="button" onClick={onClose}>Done</button>}
      </div>
    </Dialog>
  );
}
