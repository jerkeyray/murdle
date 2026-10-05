"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getSavedStatus, setWordSaved, type Round } from "@/lib/api";
import { shareRound } from "@/lib/shareCard";
import { Dialog } from "./Dialog";
import { WordExtras, WordMeta } from "./WordFacts";
import { safeReturnTo } from "@/lib/returnTo";

export function Entry({ round, onClose, action, actionLabel, busy = false }: {
  round: Round; onClose: () => void; action?: () => void; actionLabel?: string; busy?: boolean;
}) {
  const router = useRouter();
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [kept, setKept] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keepError, setKeepError] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareLabel, setShareLabel] = useState("");
  useEffect(() => {
    let cancelled = false;
    getSavedStatus(round.answer ?? "").then((status) => {
      if (!cancelled) setKept(status.saved);
    }).catch((err) => { if (!cancelled && err instanceof ApiError && err.status === 401) setNeedsSignIn(true); });
    return () => { cancelled = true; };
  }, [round.answer]);
  async function toggleKeep() {
    if (!round.answer || saving) return;
    const signIn = () => router.push(`/sign-in?returnTo=${encodeURIComponent(safeReturnTo(window.location.pathname + window.location.search))}`);
    if (needsSignIn) { signIn(); return; }
    setSaving(true); setKeepError(""); setShareLabel("");
    try { await setWordSaved(round.answer, !kept); setKept(!kept); }
    catch (err) { if (err instanceof ApiError && err.status === 401) { setNeedsSignIn(true); signIn(); } else setKeepError("Could not save this word. Please try again."); }
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
          <button className="icon-button entry-icon-button" disabled={saving} onClick={toggleKeep} aria-pressed={kept} aria-label={kept ? "Remove from saved words" : needsSignIn ? "Sign in to save this word" : "Save this word"} title={kept ? "Remove from saved words" : needsSignIn ? "Sign in to save this word" : "Save this word"}>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden fill={kept ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3.8L6 21V4.75Z" />
            </svg>
          </button>
          <button className="icon-button entry-icon-button" disabled={sharing} onClick={onShare} aria-label={sharing ? "Creating share image" : shareLabel || "Share this word"} title={sharing ? "Creating share image" : shareLabel || "Share this word"}>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15V3m0 0L8 7m4-4 4 4" /><path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
            </svg>
          </button>

        </div>
      </div>
      <WordMeta entry={round.entry} />
      {round.entry && <>
        <p className="entry-definition">{round.entry.definition}</p>
        <WordExtras entry={round.entry} />
        <p className="entry-note">{round.entry.note}</p>
      </>}
      {shareLabel && <p className="entry-feedback" role="status">{shareLabel}</p>}
      {keepError && <p role="status" className="form-error">{keepError}</p>}
      <div className="entry-actions">
        {action ? <button className="button" disabled={busy} onClick={action}>{busy ? "Please wait…" : actionLabel}</button> : <button className="button" onClick={onClose}>Done</button>}
      </div>
    </Dialog>
  );
}
