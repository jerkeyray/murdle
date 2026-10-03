"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, createRun, getRound, getRun, letterStates, startRunRound, submitGuess, revealHint, type Round, type Run } from "./api";
import { ACTIVE_KEY, activeRun, playedPacks, rememberRun, writeLocal } from "./session";
import { lettersPhrase } from "./letters";
import { dictionaryReady, isKnownWord, loadDictionary, serverDictionaryReady, subscribeDictionary } from "./dictionary";

/** How the Enter key presents itself. */
export type EnterState = "idle" | "incomplete" | "unknown" | "word";

const REVEAL_MS = 4 * 200 + 540;
type Deal = { round: Round; run: Run };

async function restore(id: string): Promise<Deal> {
  const run = await getRun(id);
  if (!run.currentRoundId) return startRunRound(id);
  // Completed boards are retained with the run even if their individual TTL elapsed.
  const round = run.completedWords.find((r) => r.id === run.currentRoundId) ?? await getRound(run.currentRoundId);
  return { run, round };
}
async function begin(): Promise<Deal> {
  const run = await createRun({ excludePacks: playedPacks() });
  rememberRun(run); // Retain the run even if dealing its first board fails.
  return startRunRound(run.id);
}

export function useGame() {
  const [run, setRun] = useState<Run | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [shake, setShake] = useState(false);
  const [revealedRows, setRevealedRows] = useState(0);
  const [revealingRow, setRevealingRow] = useState<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const mounted = useRef(false);
  const opening = useRef<Promise<Deal> | null>(null);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => { if (mounted.current) fn(); }, ms);
    timers.current.push(id);
  }, []);
  const flash = useCallback((text: string) => {
    setMessage(text); later(() => setMessage(null), 3500);
  }, [later]);
  const accept = useCallback((dealt: Deal) => {
    setRun(dealt.run); setRound(dealt.round);
    setDraft(""); setRevealingRow(null); setRevealedRows(dealt.round.rows.length);
    rememberRun(dealt.run); setError(null); setExpired(false);
  }, []);
  const fail = useCallback((err: unknown) => {
    const missing = err instanceof ApiError && (err.code === "run_not_found" || err.code === "round_not_found");
    setExpired(missing);
    setError(missing
      // What the player can do about it, not how the server stores it. Six
      // hours was a property of keeping runs in one process's memory; they
      // are in the database now and the window is a month.
      ? "That run is no longer available. Unfinished games are kept for a month."
      : err instanceof ApiError ? err.message : "Could not reach the game. Please try again.");
    if (missing) writeLocal(ACTIVE_KEY, null);
  }, []);

  // Off the critical path: the board does not wait on it, and the Enter key
  // simply has no opinion until it lands.
  useEffect(() => { loadDictionary(); }, []);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const saved = activeRun();
    opening.current ??= saved ? restore(saved) : begin();
    opening.current.then((dealt) => { if (!cancelled) accept(dealt); }).catch((err: unknown) => {
      if (!cancelled) { opening.current = null; fail(err); }
    });
    const pending = timers.current;
    return () => { cancelled = true; mounted.current = false; pending.forEach(clearTimeout); };
  }, [accept, fail]);

  const perform = useCallback(async (action: () => Promise<Deal>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { const dealt = await action(); if (mounted.current) accept(dealt); }
    catch (err) { if (mounted.current) fail(err); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }, [accept, fail]);
  const retry = useCallback(() => perform(() => {
    const saved = activeRun(); return saved ? restore(saved) : begin();
  }), [perform]);
  const newRun = useCallback(() => perform(begin), [perform]);
  const nextWord = useCallback(() => perform(async () => {
    if (!run) return begin();
    // Recover a response lost after the next word was already dealt.
    const current = await getRun(run.id);
    if (current.currentRoundId !== round?.id || current.complete) return restore(run.id);
    return startRunRound(run.id);
  }), [perform, run, round?.id]);

  const playable = !!round && round.state === "playing" && !busy && !error && revealingRow === null;

  // What Enter should look like. Both "word" and "unknown" still submit — the
  // server is the authority on a guess — so only an unfinished draft disables
  // it. A dictionary that never arrives leaves every full draft looking
  // submittable, which is the safe way to be wrong.
  const dictionaryReady_ = useSyncExternalStore(subscribeDictionary, dictionaryReady, serverDictionaryReady);
  const known = dictionaryReady_ ? isKnownWord(draft) : null;
  const enterState: EnterState = !playable || !round
    ? "idle"
    : draft.length < round.wordLength
      ? "incomplete"
      : known === false
        ? "unknown"
        : "word";
  const typeLetter = useCallback((letter: string) => {
    if (playable && round) setDraft((d) => d.length >= round.wordLength ? d : d + letter);
  }, [playable, round]);
  const backspace = useCallback(() => { if (playable) setDraft((d) => d.slice(0, -1)); }, [playable]);
  const reject = useCallback((text: string) => {
    flash(text); setShake(true); later(() => setShake(false), 450);
  }, [flash, later]);
  const submit = useCallback(async () => {
    if (!playable || !round || lock.current) return;
    if (draft.length !== round.wordLength) { reject(`Enter ${lettersPhrase(round.wordLength)}`); return; }
    lock.current = true; setBusy(true);
    try {
      const result = await submitGuess(round.id, draft);
      if (!mounted.current) return;
      setRound(result.round); setDraft("");
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setRevealingRow(reduced ? null : result.round.rows.length - 1);
      const settle = () => {
        setRevealingRow(null); setRevealedRows(result.round.rows.length);
        if (result.run) { setRun(result.run); rememberRun(result.run); }
      };
      if (reduced) settle(); else later(settle, REVEAL_MS);
    } catch (err) {
      if (err instanceof ApiError && ["wrong_length", "not_a_word"].includes(err.code)) reject(err.message);
      else fail(err); // Retry reads server state before accepting another guess.
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }, [playable, round, draft, reject, later, fail]);
  const requestHint = useCallback(async () => {
    if (!playable || !round || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const result = await revealHint(round.id, round.hintsUsed + 1);
      if (mounted.current) setRound(result.round);
    } catch (err) { if (mounted.current) fail(err); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }, [playable, round, fail]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || document.querySelector("dialog[open]")) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "Enter") {
        if (e.target instanceof HTMLElement && e.target.closest("button, a, summary")) return;
        e.preventDefault(); void submit();
      }
      else if (e.key === "Backspace") { e.preventDefault(); backspace(); }
      else if (/^[a-zA-Z]$/.test(e.key)) typeLetter(e.key.toLowerCase());
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [submit, backspace, typeLetter]);

  return {
    run, round, draft, busy, message, error, expired, shake, revealingRow,
    finished: !!round && round.state !== "playing" && revealedRows === round.rows.length,
    letterStates: letterStates(round?.rows.slice(0, revealedRows) ?? []),
    inputDisabled: !playable, enterState,
    typeLetter, backspace, submit, nextWord, newRun, retry, requestHint,
  };
}
