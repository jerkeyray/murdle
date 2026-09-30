"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  createRound,
  letterStates,
  submitGuess,
  type Mode,
  type Round,
} from "@/lib/api";

/**
 * How long the reveal animation takes end to end: the last tile's stagger delay
 * plus its own flip. Kept in sync with the `reveal` keyframes in globals.css —
 * if the timing there changes, change it here too.
 */
const REVEAL_MS = 5 * 200 + 520;

const SEEN_KEY = "murdle.seen";

/** Words already played on this device, so rounds don't repeat one. */
function loadSeen(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    // Private mode, blocked storage, corrupt value — none of which should stop
    // someone playing. Repeating a word is a far smaller problem.
    return [];
  }
}

function rememberSeen(word: string) {
  try {
    const seen = loadSeen();
    if (!seen.includes(word)) {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, word]));
    }
  } catch {
    /* ignore — see loadSeen */
  }
}

export function useGame(mode: Mode = "solo") {
  const [round, setRound] = useState<Round | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  /**
   * How many rows have finished their reveal animation. Everything that would
   * spoil the flip — keyboard colours, the end-of-round card — reads this
   * rather than round.rows.length.
   */
  const [revealedRows, setRevealedRows] = useState(0);
  const [revealingRow, setRevealingRow] = useState<number | null>(null);

  /**
   * Which word this is for this device, counting from one. Shown as the
   * specimen number in the header — a real count of words played, not a
   * decorative id.
   */
  const [wordNumber, setWordNumber] = useState(1);

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

  /**
   * Starts the round the player is dropped into on arrival.
   *
   * This is deliberately separate from newRound: an effect must not set state
   * synchronously in its body, and newRound does exactly that to clear the
   * board before it awaits. Here the only state changes happen once the
   * request resolves.
   */
  useEffect(() => {
    let cancelled = false;

    const seen = loadSeen();

    createRound({ mode, exclude: seen })
      .then((next) => {
        if (cancelled) return;
        setRound(next);
        setWordNumber(seen.length + 1);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMessage(
          err instanceof ApiError ? err.message : "Could not start a round",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [mode]);

  /** Starts a fresh round in response to a tap, clearing the board first. */
  const newRound = useCallback(async () => {
    setBusy(true);
    setDraft("");
    setRevealedRows(0);
    setRevealingRow(null);
    try {
      const seen = loadSeen();
      const next = await createRound({ mode, exclude: seen });
      setRound(next);
      setWordNumber(seen.length + 1);
    } catch (err) {
      flash(err instanceof ApiError ? err.message : "Could not start a round");
    } finally {
      setBusy(false);
    }
  }, [mode, flash]);

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
      const next = await submitGuess(round.id, round.turnSeat, draft);
      const newRowIndex = next.rows.length - 1;

      setRound(next);
      setDraft("");
      setRevealingRow(newRowIndex);

      later(() => {
        setRevealingRow(null);
        setRevealedRows(next.rows.length);
        if (next.answer) rememberSeen(next.answer);
      }, REVEAL_MS);
    } catch (err) {
      if (err instanceof ApiError) {
        reject(err.message);
      } else {
        reject("Something went wrong");
      }
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
    round,
    wordNumber,
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
    newRound,
  };
}
