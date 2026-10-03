"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, getDuo, letterStates, mutateDuo, type Duo, type DuoMutation } from "@/lib/api";
import { useVisiblePolling } from "@/lib/useVisiblePolling";
import { readLocal, writeLocal } from "@/lib/session";
import { lettersPhrase } from "@/lib/letters";
import { Board, MARK_LABEL } from "@/components/Board";
import { Keyboard } from "@/components/Keyboard";
import { BackButton } from "@/components/BackButton";
import { Loader } from "@/components/Loader";
import { dictionaryReady, isKnownWord, loadDictionary, serverDictionaryReady, subscribeDictionary } from "@/lib/dictionary";
import type { EnterState } from "@/lib/useGame";

type Pending = { action: "guesses" | "pass"; date: string; mutation: DuoMutation };
export default function DuoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [duo, setDuo] = useState<Duo | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [closedDate, setClosedDate] = useState<string | null>(null);
  const dayKey = useRef("");
  const pending = useRef<Pending | null>(null);
  const lock = useRef(false);
  const accept = useCallback((d: Duo) => {
    const key = `wordle.duo.${d.viewerId}.${id}.${d.today?.date}`;
    const priorDate = dayKey.current.split(".").at(-1);
    if (priorDate && d.today && /^\d{4}-\d{2}-\d{2}$/.test(priorDate) && d.today.date < priorDate) return;
    if (dayKey.current !== key) {
      if (dayKey.current) setClosedDate(dayKey.current.split(".").at(-1)!);
      dayKey.current = key;
      setDraft((readLocal(key) ?? "").replace(/[^a-z]/g, "").slice(0, d.today?.wordLength ?? 0));
      pending.current = null;
      try { const value = JSON.parse(readLocal(key + ".pending") ?? "null") as Pending | null; if (value && value.date === d.today?.date) pending.current = value; } catch { /* Ignore incomplete local state. */ }
      setHasPending(!!pending.current);
    }
    setDuo(previous => previous?.today && d.today && (previous.today.date > d.today.date || previous.today.date === d.today.date && previous.today.version > d.today.version) ? previous : d);
    setReconnecting(false); setSignedOut(false);
  }, [id]);
  const load = useCallback(async () => {
    try { accept(await getDuo(id, new URLSearchParams(window.location.search).get("date") ?? "today")); }
    catch (e) {
      setReconnecting(true);
      if (e instanceof ApiError && e.status === 401) setSignedOut(true);
      if (e instanceof ApiError && (e.status === 404 || e.status === 422)) setError(e.message);
      throw e;
    }
  }, [id, accept]);
  const day = duo?.today;
  const wordLength = day?.wordLength ?? 0;
  const yourTurn = day?.state === "playing" && day.currentPlayer === duo?.viewerId && duo?.status === "active";
  // Waiting on your friend is the one case worth polling quickly: their guess
  // should land on your board while you are both looking at it. On your own
  // turn, or once the day is done, the only things that can still change are
  // the deadline and the duo itself, and every poll costs a locking write
  // transaction — so a board left open on a desk backs off instead of billing
  // for a move that cannot arrive. Focus, reconnect and visibility changes
  // refresh immediately either way.
  const waiting = day?.state === "playing" && duo?.status === "active" && !yourTurn;
  useVisiblePolling(load, waiting ? 3_000 : 30_000);
  useEffect(() => { loadDictionary(); }, []);
  const enabled = !!yourTurn && !busy && !signedOut && !closedDate && !hasPending;
  // The same Enter treatment as the solo board. Unknown words still submit;
  // the server decides, here as there.
  const dictionaryReady_ = useSyncExternalStore(subscribeDictionary, dictionaryReady, serverDictionaryReady);
  const enterState: EnterState = !enabled
    ? "idle"
    : draft.length < wordLength
      ? "incomplete"
      : dictionaryReady_ && isKnownWord(draft) === false
        ? "unknown"
        : "word";
  const updateDraft = useCallback((next: string) => { setDraft(next); if (dayKey.current) writeLocal(dayKey.current, next); }, []);
  const type = useCallback((letter: string) => { if (enabled) updateDraft((draft + letter.toLowerCase()).slice(0, wordLength)); }, [enabled, updateDraft, draft, wordLength]);
  const backspace = useCallback(() => { if (enabled) updateDraft(draft.slice(0, -1)); }, [enabled, updateDraft, draft]);

  const submit = useCallback(async (action: "guesses" | "pass" = "guesses") => {
    if (lock.current || !duo?.today) return;
    if (!pending.current && !yourTurn) return;
    if (!pending.current && action === "guesses" && draft.length !== duo.today.wordLength) { setError(`Enter ${lettersPhrase(duo.today.wordLength)}`); return; }
    lock.current = true; setBusy(true); setError("");
    try {
      if (!pending.current) {
        const latest = await getDuo(id);
        accept(latest);
        if (!latest.today || latest.today.date !== duo.today.date || latest.today.version !== duo.today.version || latest.today.currentPlayer !== latest.viewerId || latest.today.state !== "playing") { setError("The board changed. Review it before playing."); return; }
        pending.current = { action, date: latest.today.date, mutation: { requestId: crypto.randomUUID(), version: latest.today.version, ...(action === "guesses" ? { guess: draft } : {}) } };
        writeLocal(dayKey.current + ".pending", JSON.stringify(pending.current));
        setHasPending(true);
      }
      const request = pending.current;
      const result = await mutateDuo(id, request.action, request.mutation, request.date);
      pending.current = null; writeLocal(dayKey.current + ".pending", null);
      setHasPending(false);
      if (request.action === "guesses") updateDraft("");
      accept(result);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status > 0 && e.status < 500) { pending.current = null; setHasPending(false); writeLocal(dayKey.current + ".pending", null); if (e.current) accept(e.current); }
      setError(e instanceof Error ? e.message : "Could not submit. Retry to check your move.");
    } finally { lock.current = false; setBusy(false); }
  }, [duo, yourTurn, draft, id, accept, load, updateDraft]);
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
    <header className="topbar"><BackButton href="/friends" /><h1 className="wordmark">Wordle</h1><span aria-hidden="true" /></header>
    {signedOut ? <section className="game-error"><p>Sign in to open your shared board.</p><Link className="button button--link" href={`/sign-in?returnTo=${encodeURIComponent(`/duos/${id}`)}`}>Sign in</Link></section> : !duo ? <section className="game-error">{error ? <p role="status">{error}</p> : <Loader label={reconnecting ? "Reconnecting" : "Loading"} />}<button className="text-button" onClick={() => void load().catch(() => {})}>Retry</button></section> : !day ? <section className="game-error"><p>{duo.status === "pending" ? "This invitation is waiting for acceptance." : "This daily game has ended."}</p><Link href="/friends">Back to friends</Link></section> : <>
      <div className="duo-members">{duo.members.map((m, seat) => {
        const active = m.id === day.currentPlayer && day.state === "playing";
        return <span className="duo-member" key={m.id} data-seat={seat} data-current={active}><i aria-hidden>{m.name.slice(0, 1).toUpperCase()}</i><span>{m.id === duo.viewerId ? "You" : m.name}</span></span>;
      })}</div>
      <div className="rule" />
      <div className="board-area"><Board rows={day.rows} authors={day.rows.map(r => duo.members.find(m => m.id === r.playerId)?.name || "Friend")} authorSeats={day.rows.map(r => duo.members.findIndex(m => m.id === r.playerId))} draft={draft} wordLength={day.wordLength} maxRows={day.maxRows} revealingRow={null} shake={false} /></div>
      <div className="sr-only" role="status" aria-live="polite">{day.rows.at(-1)?.guess.split("").map((letter, i) => `${letter}: ${MARK_LABEL[day.rows.at(-1)!.marks[i]]}`).join("; ")}</div>
      {day.state !== "playing" ? <div className="game-tools"><span role="status">{reconnecting ? "Reconnecting…" : status}</span></div> : yourTurn && !day.passed.includes(duo.viewerId) && !closedDate ? <div className="game-tools game-tools--action"><button className="text-button" disabled={busy || hasPending} onClick={() => void submit("pass")}>Pass turn</button></div> : null}
      {error && <div className="duo-error" role="alert">{error}</div>}
      {hasPending && <button className="button button--quiet" disabled={busy} onClick={() => void submit()}>Retry move</button>}
      {closedDate ? <section className="duo-result"><p>{closedDate} has finished.</p><button className="button" onClick={() => { setClosedDate(null); updateDraft(""); }}>Today’s word</button></section> : day.state === "playing" ? yourTurn ? <><div className="rule" /><Keyboard letterStates={letterStates(day.rows)} onKey={type} onBackspace={backspace} disabled={!enabled} /><button className="button keyboard-submit" data-state={enterState} disabled={!enabled || enterState === "incomplete"} onClick={() => void submit()}>Submit</button></> : <section className="duo-waiting" role="status"><span className="label">Shared board</span><p>Waiting for {other?.name || "your friend"}</p><span>You’ll take the next turn.</span></section> : <section className="duo-result"><h2>{day.answer}</h2><p>{day.entry?.definition}</p>{day.entry?.note && <details><summary>Read more</summary><p>{day.entry.note}</p></details>}<Link className="text-button" href="/friends">Back to friends</Link></section>}
    </>}
  </main>;
}
