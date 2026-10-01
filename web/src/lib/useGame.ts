"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  createRun,
  letterStates,
  startRunRound,
  submitGuess,
  type Round,
  type Run,
} from "@/lib/api";

/**
 * How long the reveal animation takes end to end: the last tile's stagger delay
 * plus its own flip. Kept in sync with the `reveal` keyframes in globals.css —
 * if the timing there changes, change it here too.
 */
const REVEAL_MS = 5 * 200 + 520;

const PACKS_KEY = "murdle.packs";

/** Themes already played on this device, so a new run picks a fresh one. */
function loadPlayedPacks(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PACKS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    // Private mode, blocked storage, corrupt value — none of which should stop
    // anyone playing. Repeating a theme is a far smaller problem.
    return [];
  }
}

function rememberPack(title: string) {
  try {
    const played = loadPlayedPacks();
    if (!played.includes(title)) {
      window.localStorage.setItem(PACKS_KEY, JSON.stringify([...played, title]));
    }
  } catch {
    /* ignore — see loadPlayedPacks */
  }
}

export function useGame() {
  const [run, setRun] = useState<Run | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  /**
   * How many rows have finished their reveal animation. Everything that would
   * spoil the flip — keyboard colours, the entry card — reads this rather than
   * round.rows.length.
   */
  const [revealedRows, setRevealedRows] = useState(0);
  const [revealingRow, setRevealingRow] = useState<number | null>(null);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const flash = useCallback(
    (text: string) => {
      setMessage(text);
      later(() => setMessage(null), 1800);
    },
    [later],
  );

  const clearBoard = useCallback(() => {
    setDraft("");
    setRevealedRows(0);
    setRevealingRow(null);
  }, []);

  /**
   * Starts a themed run and deals its first word.
   *
   * An effect must not set state synchronously in its body, so the mount path
   * lives in its own effect below and this is only ever called from a tap.
   */
  const newRun = useCallback(async () => {
    setBusy(true);
    clearBoard();
    try {
      const fresh = await createRun({ excludePacks: loadPlayedPacks() });
      const dealt = await startRunRound(fresh.id);
      setRun(dealt.run);
      setRound(dealt.round);
    } catch (err) {
      flash(err instanceof ApiError ? err.message : "Could not start a run");
    } finally {
      setBusy(false);
    }
  }, [clearBoard, flash]);

  /** Deals the next board — the next word, or your opponent's turn at this one. */
  const nextWord = useCallback(async () => {
    if (!run || run.complete) return;

    setBusy(true);
    clearBoard();
    try {
      const dealt = await startRunRound(run.id);
      setRun(dealt.run);
      setRound(dealt.round);
    } catch (err) {
      flash(err instanceof ApiError ? err.message : "Could not deal the next board");
    } finally {
      setBusy(false);
    }
  }, [run, clearBoard, flash]);

  /**
   * Caches the opening request against React's development double-invoke.
   *
   * Starting a run is a side effect on the server, not an idempotent read:
   * firing twice creates two runs and two rounds and abandons one of each.
   *
   * The dedupe has to cache the *promise* rather than skip the second effect
   * run. Skipping it strands the game on the loading screen — the first
   * invocation's cleanup has already marked its result as cancelled, so if the
   * second invocation never subscribes, nothing is ever applied.
   */
  const opening = useRef<Promise<{ round: Round; run: Run }> | null>(null);

  useEffect(() => {
    let cancelled = false;

    opening.current ??= createRun({ excludePacks: loadPlayedPacks() }).then(
      (fresh) => startRunRound(fresh.id),
    );

    opening.current
      .then((dealt) => {
        if (cancelled) return;
        setRun(dealt.run);
        setRound(dealt.round);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Let a failed opening be retried rather than cached forever.
        opening.current = null;
        setMessage(
          err instanceof ApiError ? err.message : "Could not start a run",
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const playable =
    round !== null && round.state === "playing" && !busy && revealingRow === null;

  const typeLetter = useCallback(
    (letter: string) => {
      if (!playable || !round) return;
      setDraft((d) => (d.length >= round.wordLength ? d : d + letter));
    },
    [playable, round],
  );

  const backspace = useCallback(() => {
    if (!playable) return;
    setDraft((d) => d.slice(0, -1));
  }, [playable]);

  const reject = useCallback(
    (text: string) => {
      flash(text);
      setShake(true);
      later(() => setShake(false), 450);
      // A short buzz on rejection. Silently absent on desktop and on iOS
      // Safari, which is fine — it is a bonus signal, not the only one.
      navigator.vibrate?.(60);
    },
    [flash, later],
  );

  const submit = useCallback(async () => {
    if (!playable || !round) return;

    if (draft.length !== round.wordLength) {
      reject(`${round.wordLength} letters`);
      return;
    }

    setBusy(true);
    try {
      const result = await submitGuess(round.id, draft);
      const newRowIndex = result.round.rows.length - 1;

      setRound(result.round);
      setDraft("");
      setRevealingRow(newRowIndex);

      later(() => {
        setRevealingRow(null);
        setRevealedRows(result.round.rows.length);
        // The run only updates on the guess that ends a round, and holding it
        // back until the flip finishes keeps the theme reveal from landing
        // before the last tile has turned over.
        if (result.run) {
          setRun(result.run);
          if (result.run.pack) rememberPack(result.run.pack.title);
        }
      }, REVEAL_MS);
    } catch (err) {
      reject(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }, [playable, round, draft, reject, later]);

  // Physical keyboard, so the game is properly playable on a laptop too.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Enter") {
        e.preventDefault();
        void submit();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        typeLetter(e.key.toLowerCase());
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [submit, backspace, typeLetter]);

  const settledRows = round ? round.rows.slice(0, revealedRows) : [];

  return {
    run,
    round,
    draft,
    message,
    shake,
    revealingRow,
    /** True once the round is over *and* the final row has finished flipping. */
    finished:
      round !== null &&
      round.state !== "playing" &&
      revealedRows === round.rows.length,
    letterStates: letterStates(settledRows),
    inputDisabled: !playable,
    typeLetter,
    backspace,
    submit,
    nextWord,
    newRun,
  };
}
