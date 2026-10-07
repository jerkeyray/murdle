"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, getDuo, letterStates, mutateDuo, type Duo, type DuoMutation } from "@/lib/api";
import { useVisiblePolling } from "@/lib/useVisiblePolling";
import { readLocal, writeLocal } from "@/lib/session";
import { lettersPhrase } from "@/lib/letters";
import { deleteLetter, typeInto } from "@/lib/draft";
import { Board, MARK_LABEL } from "@/components/Board";
import { Keyboard } from "@/components/Keyboard";
import { BackButton } from "@/components/BackButton";
import { Loader } from "@/components/Loader";
import { WordExtras, WordMeta } from "@/components/WordFacts";
import { dictionaryReady, isKnownWord, loadDictionary, serverDictionaryReady, subscribeDictionary } from "@/lib/dictionary";
import { Presence } from "@/components/Presence";
import type { EnterState } from "@/lib/useGame";

// `board` is how the board is addressed ("2026-10-05", then "2026-10-05.1").
// Retry records written before boards had a sequence carry only `date`, which
// is the same string for a day's first board.
type Pending = { action: "guesses" | "pass" | "hint"; board?: string; date?: string; mutation: DuoMutation };
export default function DuoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <DuoBoard key={id} id={id} />;
}

function DuoBoard({id}: {id: string}) {
  const [duo, setDuo] = useState<Duo | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [draftCursor, setDraftCursor] = useState(0);
  const [error, setError] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [closedDate, setClosedDate] = useState<string | null>(null);
  const dayKey = useRef("");
  const current = useRef<{ date: string; seq: number } | null>(null);
  const pending = useRef<Pending | null>(null);
  const lock = useRef(false);
  const snapshot = useRef<Duo | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const accept = useCallback((d: Duo) => {
    const previous = snapshot.current;
    if (previous && (d.version < previous.version || previous.today && d.today &&
      (d.today.date < previous.today.date || d.today.date === previous.today.date &&
      (d.today.seq < previous.today.seq || d.today.seq === previous.today.seq && d.today.version < previous.today.version)))) return;
    snapshot.current = d;
    const key = `wordle.duo.${d.viewerId}.${id}.${d.today?.board}`;
    const prior = current.current;
    // A slow response must never put an earlier board back over a newer one.
    if (prior && d.today && (d.today.date < prior.date || d.today.date === prior.date && d.today.seq < prior.seq)) return;
    if (dayKey.current !== key) {
      // A new day closes the one you were playing. A new board on the same day
      // is the next word, started by either friend, and just replaces the
      // finished one.
      if (prior && d.today && d.today.date !== prior.date) setClosedDate(prior.date);
      dayKey.current = key;
      current.current = d.today ? { date: d.today.date, seq: d.today.seq } : null;
      setDraft((readLocal(key) ?? "").replace(/[^a-z]/g, "").slice(0, d.today?.wordLength ?? 0).split(""));
      setDraftCursor(0);
      pending.current = null;
      try { const value = JSON.parse(readLocal(key + ".pending") ?? "null") as Pending | null; if (value && (value.board ?? value.date) === d.today?.board) pending.current = value; } catch { /* Ignore incomplete local state. */ }
      setHasPending(!!pending.current);
    }
    setDuo(d);
    setReconnecting(false); setSignedOut(false);
  }, [id]);
  const clearPending = useCallback((request: Pending, spentGuess: boolean) => {
    if (pending.current !== request) return;
    pending.current = null;
    writeLocal(dayKey.current + ".pending", null);
    setHasPending(false);
    if (spentGuess) { setDraft([]); setDraftCursor(0); writeLocal(dayKey.current, null); }
  }, []);
  const sendPending = useCallback(async (signal: AbortSignal | undefined = lifetime.current?.signal) => {
    const request = pending.current;
    if (!request) return;
    try {
      const result = await mutateDuo(id, request.action, request.mutation, request.board ?? request.date, signal);
      if (signal?.aborted) return;
      clearPending(request, request.action === "guesses");
      accept(result);
      setError("");
    } catch (e) {
      if (signal?.aborted) throw e;
      // Auth, rate-limit and timeout errors leave the outcome unresolved.
      if (e instanceof ApiError && e.status > 0 && e.status < 500 && ![401, 408, 429].includes(e.status)) {
        clearPending(request, false);
        if (e.current) accept(e.current);
      }
      if (e instanceof ApiError && e.status === 401) setSignedOut(true);
      throw e;
    }
  }, [id, accept, clearPending]);
  const load = useCallback(async (signal?:AbortSignal) => {
    try {
      const latest = await getDuo(id, new URLSearchParams(window.location.search).get("date") ?? "today", signal);
      if (signal?.aborted) return;
      accept(latest);
      // Resend the exact persisted mutation: its receipt is authoritative even
      // if an identical guess already appeared in an earlier row.
      if (pending.current && !lock.current) {
        lock.current = true;
        try { await sendPending(signal); } finally { lock.current = false; }
      }
    } catch (e) {
      if(signal?.aborted)return;
      setReconnecting(true);
      if (e instanceof ApiError && e.status === 401) setSignedOut(true);
      if (e instanceof ApiError && (e.status === 404 || e.status === 422)) setError(e.message);
      throw e;
    }
  }, [id, accept, sendPending]);
  const day = duo?.today;
  const wordLength = day?.wordLength ?? 0;
  const yourTurn = day?.state === "playing" && day.currentPlayer === duo?.viewerId && duo?.status === "active";
  // Either friend can reveal a hint or start the next board, so both seats
  // refresh promptly. Hidden tabs and failures still pause/back off.
  useVisiblePolling(load, duo?.status === "active" || hasPending ? 3_000 : 30_000);
  useEffect(() => { loadDictionary(); }, []);
  const enabled = !!yourTurn && !busy && !signedOut && !closedDate && !hasPending;
  // The same Enter treatment as the solo board. Unknown words still submit;
  // the server decides, here as there.
  const dictionaryReady_ = useSyncExternalStore(subscribeDictionary, dictionaryReady, serverDictionaryReady);
  const draftWord = draft.join("");
  const draftComplete = draft.length === wordLength && draft.every(Boolean);
  const enterState: EnterState = !enabled
    ? "idle"
    : !draftComplete
      ? "incomplete"
      : dictionaryReady_ && isKnownWord(draftWord) === false
        ? "unknown"
        : "word";
  const updateDraft = useCallback((next: string[]) => { setDraft(next); if (dayKey.current) writeLocal(dayKey.current, next.join("")); }, []);
  const type = useCallback((letter: string) => {
    if (!enabled) return;
    const typed = typeInto(draft, draftCursor, letter, wordLength);
    if (!typed) return;
    updateDraft(typed.draft);
    setDraftCursor(typed.cursor);
  }, [enabled, updateDraft, draft, draftCursor, wordLength]);
  const backspace = useCallback(() => {
    if (!enabled) return;
    const deleted = deleteLetter(draft, draftCursor, wordLength);
    if (!deleted) return;
    updateDraft(deleted.draft);
    setDraftCursor(deleted.cursor);
  }, [enabled, updateDraft, draft, draftCursor, wordLength]);
  const selectDraftTile = useCallback((index: number) => {
    if (enabled && index >= 0 && index < wordLength) setDraftCursor(index);
  }, [enabled, wordLength]);

  const submit = useCallback(async (action: "guesses" | "pass" | "hint" = "guesses") => {
    if (lock.current || !duo?.today) return;
    if (!pending.current && action !== "hint" && !yourTurn) return;
    if (!pending.current && action === "guesses" && !draftComplete) { setError(`Enter ${lettersPhrase(duo.today.wordLength)}`); return; }
    lock.current = true; setBusy(true); setError("");
    try {
      if (!pending.current) {
        pending.current = { action, board: duo.today.board, mutation: { requestId: crypto.randomUUID(), version: duo.today.version, ...(action === "guesses" ? { guess: draftWord } : {}) } };
        writeLocal(dayKey.current + ".pending", JSON.stringify(pending.current));
        setHasPending(true);
      }
      await sendPending();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit. Your move will be checked automatically.");
    } finally { lock.current = false; setBusy(false); }
  }, [duo, yourTurn, draftComplete, draftWord, sendPending]);
  // Starts another board today. Either friend can, once the last one is over.
  // If the other friend already did, the server hands back that board instead
  // of making a third, so a double tap lands everyone on the same game.
  const startNext = useCallback(async () => {
    if (lock.current || !duo) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await mutateDuo(id, "next", { requestId: crypto.randomUUID(), version: duo.version });
      accept(result);
    } catch (e) {
      if (e instanceof ApiError && e.current) accept(e.current);
      setError(e instanceof Error ? e.message : "Could not start the next word. Try again.");
    } finally { lock.current = false; setBusy(false); }
  }, [duo, id, accept]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLElement && e.target.closest("input,textarea,[contenteditable],dialog")) return;
      if (e.key === "Enter") { e.preventDefault(); if (enabled) void submit(); }
      else if (e.key === "Backspace") { e.preventDefault(); backspace(); }
      else if (/^[a-z]$/i.test(e.key)) type(e.key);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [enabled, submit, backspace, type]);
  const other = duo?.members.find(m => m.id !== duo.viewerId);
  const status = day?.state === "won" ? "Solved together" : day?.state === "lost" ? "Out of guesses" : day?.state === "expired" ? "Day finished" : day?.state === "closed" || duo?.status === "ended" ? "Daily game ended" : yourTurn ? "Your turn" : `${other?.name || "Friend"}’s turn`;

  return <main className="app game-app duo-app">
    <Presence enabled={!!duo && !signedOut} />
    <header className="topbar"><BackButton href="/friends" /><h1 className="wordmark">Wordle</h1><span aria-hidden="true" /></header>
    {signedOut ? <section className="game-error"><p>Sign in to open your shared board.</p><Link className="button button--link" href={`/sign-in?returnTo=${encodeURIComponent(`/duos/${id}`)}`}>Sign in</Link></section> : !duo ? <section className="game-error">{error ? <p role="status">{error}</p> : <Loader label={reconnecting ? "Reconnecting" : "Loading"} />}</section> : !day ? <section className="game-error"><p>{duo.status === "pending" ? "This invitation is waiting for acceptance." : "This daily game has ended."}</p></section> : <>
      <div className="duo-members">{duo.members.map((m, seat) => {
        const active = m.id === day.currentPlayer && day.state === "playing";
        return <span className="duo-member" key={m.id} data-seat={seat} data-current={active} aria-current={active ? "step" : undefined}><i aria-hidden>{m.name.slice(0, 1).toUpperCase()}</i><span>{m.id === duo.viewerId ? "You" : m.name}</span></span>;
      })}</div>
      <div className="rule" />
      <div className="board-area"><div className="board-stage"><Board rows={day.rows} authors={day.rows.map(r => duo.members.find(m => m.id === r.playerId)?.name || "Friend")} authorSeats={day.rows.map(r => duo.members.findIndex(m => m.id === r.playerId))} draft={draft} wordLength={day.wordLength} maxRows={day.maxRows} revealingRow={null} shake={false} onDraftTileSelect={yourTurn ? selectDraftTile : undefined} draftCursor={draftCursor} />{yourTurn && !day.passed.includes(duo.viewerId) && !closedDate && <button className="icon-button duo-pass" disabled={busy || hasPending} onClick={() => void submit("pass")} aria-label="Pass this turn to your friend" title="Pass this turn to your friend. Once per board.">Pass</button>}{day.state === "playing" && day.rows.length >= 3 && !day.hint && !closedDate && <button className="icon-button duo-hint" disabled={busy || hasPending} onClick={() => void submit("hint")} aria-label="Reveal a shared hint" title="Reveal one shared hint. It does not use a turn.">Hint</button>}</div></div>
      {day.hint && <aside className="duo-hint-reveal" aria-label="Shared hint"><span className="label">Shared hint</span><p>{day.hint.text}</p></aside>}
      <div className="sr-only" role="status" aria-live="polite">{day.rows.at(-1)?.guess.split("").map((letter, i) => `${letter}: ${MARK_LABEL[day.rows.at(-1)!.marks[i]]}`).join("; ")}</div>
      {day.state !== "playing" ? <div className="game-tools"><span role="status">{reconnecting ? "Reconnecting…" : status}</span></div> : null}
      {error && <div className="duo-error" role="alert">{error}</div>}
      {closedDate ? <section className="duo-result"><p>{closedDate} has finished.</p><button className="button" onClick={() => { setClosedDate(null); updateDraft([]); setDraftCursor(0); }}>Today’s word</button></section> : day.state === "playing" ? yourTurn ? <><div className="rule" /><Keyboard letterStates={letterStates(day.rows)} onKey={type} onBackspace={backspace} disabled={!enabled} /><div className="play-actions"><button className="button keyboard-submit" data-state={enterState} disabled={!enabled || enterState === "incomplete"} onClick={() => void submit()}>Submit</button></div></> : <section className="duo-waiting" role="status"><span className="label">Shared board</span><p>Waiting for {other?.name || "your friend"}</p><span>You’ll take the next turn.</span></section> : <section className="duo-result"><h2>{day.answer}</h2><WordMeta entry={day.entry} /><p>{day.entry?.definition}</p><WordExtras entry={day.entry} />{day.entry?.note && <details><summary>Read more</summary><p>{day.entry.note}</p></details>}{(day.state === "won" || day.state === "lost") && duo.status === "active" && !new URLSearchParams(window.location.search).has("date") && <button className="button" disabled={busy} onClick={() => void startNext()}>{busy ? "Starting…" : "Next word"}</button>}</section>}
    </>}
  </main>;
}
