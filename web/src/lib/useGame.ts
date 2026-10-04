"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, createRun, getRound, getRun, letterStates, startRunRound, submitGuess, revealHint, type Round, type Run } from "./api";
import { ACTIVE_KEY, activeRunFor, type GameConfig, playedPacks, rememberRun, writeLocal } from "./session";
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
// Not remembered here: every deal goes through accept(), which remembers it.
// Remembering early would let a prefetch from the home page flip its button
// from Begin to Continue while you were looking at it.
function begin(config: GameConfig): Promise<Deal> {
  return createRun({ excludePacks: config.mode === "themed" ? playedPacks() : [], ...config });
}

function open(config: GameConfig): Promise<Deal> {
  const saved = activeRunFor(config);
  return saved ? restore(saved) : begin(config);
}

/**
 * A game dealt before its board is on screen.
 *
 * The home page starts one as soon as it loads, so by the time Begin is tapped
 * the word has usually already crossed the ocean and the board opens straight
 * onto it instead of onto a loader. Consumed once, keyed by the settings it was
 * dealt for, and dropped after a few minutes so a long stay on the home page
 * never opens something stale.
 */
type Prefetch = { key: string; at: number; deal: Promise<Deal> };
let prefetched: Prefetch | null = null;
const PREFETCH_TTL_MS = 5 * 60 * 1000;
const keyOf = (c: GameConfig) => `${c.mode}:${c.wordLength}:${c.difficulty}`;

export function prefetchGame(config: GameConfig): void {
  const key = keyOf(config);
  if (prefetched && prefetched.key === key && Date.now() - prefetched.at < PREFETCH_TTL_MS) return;
  const deal = open(config);
  // A failed prefetch is forgotten, so the board makes its own attempt and
  // shows its own error rather than inheriting a stale one.
  deal.catch(() => { if (prefetched?.deal === deal) prefetched = null; });
  prefetched = { key, at: Date.now(), deal };
}

function takePrefetched(config: GameConfig): Promise<Deal> | null {
  const p = prefetched;
  if (!p || p.key !== keyOf(config) || Date.now() - p.at >= PREFETCH_TTL_MS) return null;
  prefetched = null;
  return p.deal;
}

export function useGame(config: GameConfig = { mode: "themed", wordLength: 5, difficulty: "mixed" }) {
  const { mode, wordLength, difficulty } = config;
  const [run, setRun] = useState<Run | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  // Empty strings retain a player's chosen tile positions. That means they can
  // work through a word from the middle without letters shifting left.
  const [draft, setDraft] = useState<string[]>([]);
  const [draftCursor, setDraftCursor] = useState(0);
  const draftCursorRef = useRef(0);
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
    setDraft([]); draftCursorRef.current = 0; setDraftCursor(0); setRevealingRow(null); setRevealedRows(dealt.round.rows.length);
    rememberRun(dealt.run, { mode, wordLength, difficulty }); setError(null); setExpired(false);
  }, [mode, wordLength, difficulty]);
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
    const config = { mode, wordLength, difficulty };
    opening.current ??= takePrefetched(config) ?? open(config);
    opening.current.then((dealt) => { if (!cancelled) accept(dealt); }).catch((err: unknown) => {
      if (!cancelled) { opening.current = null; fail(err); }
    });
    const pending = timers.current;
    return () => { cancelled = true; mounted.current = false; pending.forEach(clearTimeout); };
  }, [accept, fail, mode, wordLength, difficulty]);

  const perform = useCallback(async (action: () => Promise<Deal>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { const dealt = await action(); if (mounted.current) accept(dealt); }
    catch (err) { if (mounted.current) fail(err); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }, [accept, fail]);
  const retry = useCallback(() => perform(() => {
    return open({ mode, wordLength, difficulty });
  }), [perform, mode, wordLength, difficulty]);
  const newRun = useCallback(() => perform(() => begin({ mode, wordLength, difficulty })), [perform, mode, wordLength, difficulty]);
  const nextWord = useCallback(() => perform(async () => {
    if (!run) return begin({ mode, wordLength, difficulty });
    // Recover a response lost after the next word was already dealt.
    const current = await getRun(run.id);
    if (current.currentRoundId !== round?.id || current.complete) return restore(run.id);
    return startRunRound(run.id);
  }), [perform, run, round?.id, mode, wordLength, difficulty]);

  const playable = !!round && round.state === "playing" && !busy && !error && revealingRow === null;

  // What Enter should look like. Both "word" and "unknown" still submit — the
  // server is the authority on a guess — so only an unfinished draft disables
  // it. A dictionary that never arrives leaves every full draft looking
  // submittable, which is the safe way to be wrong.
  const dictionaryReady_ = useSyncExternalStore(subscribeDictionary, dictionaryReady, serverDictionaryReady);
  const draftWord = draft.join("");
  const draftComplete = !!round && draft.length === round.wordLength && draft.every(Boolean);
  const known = dictionaryReady_ && draftComplete ? isKnownWord(draftWord) : null;
  const enterState: EnterState = !playable || !round
    ? "idle"
    : !draftComplete
      ? "incomplete"
      : known === false
        ? "unknown"
        : "word";
  const typeLetter = useCallback((letter: string) => {
    const position = draftCursorRef.current;
    if (!playable || !round || position >= round.wordLength) return;
    setDraft((current) => {
      const next = Array.from({ length: round.wordLength }, (_, index) => current[index] ?? "");
      next[position] = letter;
      return next;
    });
    const nextPosition = Math.min(position + 1, round.wordLength);
    draftCursorRef.current = nextPosition;
    setDraftCursor(nextPosition);
  }, [playable, round]);
  const backspace = useCallback(() => {
    const cursor = draftCursorRef.current;
    if (!playable || !round || cursor === 0) return;
    const position = Math.min(cursor, round.wordLength) - 1;
    setDraft((current) => {
      const next = Array.from({ length: round.wordLength }, (_, index) => current[index] ?? "");
      next[position] = "";
      return next;
    });
    draftCursorRef.current = position;
    setDraftCursor(position);
  }, [playable, round]);
  const selectDraftTile = useCallback((index: number) => {
    if (playable && round && index >= 0 && index < round.wordLength) {
      draftCursorRef.current = index;
      setDraftCursor(index);
    }
  }, [playable, round]);
  const reject = useCallback((text: string) => {
    flash(text); setShake(true); later(() => setShake(false), 450);
  }, [flash, later]);
  const submit = useCallback(async () => {
    if (!playable || !round || lock.current) return;
    if (!draftComplete) { reject(`Enter ${lettersPhrase(round.wordLength)}`); return; }
    lock.current = true; setBusy(true);
    try {
      const result = await submitGuess(round.id, draftWord);
      if (!mounted.current) return;
      setRound(result.round); setDraft([]); draftCursorRef.current = 0; setDraftCursor(0);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setRevealingRow(reduced ? null : result.round.rows.length - 1);
      const settle = () => {
        setRevealingRow(null); setRevealedRows(result.round.rows.length);
        if (result.run) { setRun(result.run); rememberRun(result.run, { mode, wordLength, difficulty }); }
      };
      if (reduced) settle(); else later(settle, REVEAL_MS);
    } catch (err) {
      if (err instanceof ApiError && ["wrong_length", "not_a_word"].includes(err.code)) reject(err.message);
      else fail(err); // Retry reads server state before accepting another guess.
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }, [playable, round, draftComplete, draftWord, reject, later, fail, mode, wordLength, difficulty]);
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
    run, round, draft, draftCursor, busy, message, error, expired, shake, revealingRow,
    finished: !!round && round.state !== "playing" && revealedRows === round.rows.length,
    letterStates: letterStates(round?.rows.slice(0, revealedRows) ?? []),
    inputDisabled: !playable, enterState,
    typeLetter, backspace, selectDraftTile, submit, nextWord, newRun, retry, requestHint,
  };
}
