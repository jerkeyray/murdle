"use client";

import type { Mark } from "@/lib/api";
import type { EnterState } from "@/lib/useGame";
import { MARK_LABEL } from "./Board";

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"] as const;

interface KeyboardProps {
  letterStates: Record<string, Mark>;
  onKey: (letter: string) => void;
  onEnter: () => void;
  onBackspace: () => void;
  /** Locked while a guess is in flight or the round is over. */
  disabled: boolean;
  /** How Enter should present itself for what is currently typed. */
  enterState: EnterState;
}

export function Keyboard({
  letterStates,
  onKey,
  onEnter,
  onBackspace,
  disabled,
  enterState,
}: KeyboardProps) {
  return (
    <div className="keyboard" role="group" aria-label="Keyboard">
      {ROWS.map((row, i) => (
        <div className="keyboard-row" key={row}>
          {/* The middle row is inset so its keys line up under the top row. */}
          {i === 1 ? <div className="key-spacer" aria-hidden /> : null}

          {i === 2 ? (
            <button
              className="key key--wide key--enter"
              data-state={enterState}
              onClick={onEnter}
              // Only an unfinished word is unpressable. A word the local list
              // does not recognise still goes to the server, which is the one
              // that actually decides.
              disabled={disabled || enterState === "incomplete"}
              aria-label={
                enterState === "unknown"
                  ? "Submit guess, not in the word list"
                  : "Submit guess"
              }
            >
              Enter
            </button>
          ) : null}

          {row.split("").map((letter) => (
            <button
              key={letter}
              className="key"
              data-mark={letterStates[letter]}
              onClick={() => onKey(letter)}
              disabled={disabled}
              aria-label={
                letterStates[letter]
                  ? `${letter}, ${MARK_LABEL[letterStates[letter]]}`
                  : letter
              }
            >
              {letter}
              {letterStates[letter] && <span className="key-glyph" aria-hidden>{letterStates[letter] === "hit" ? "●" : letterStates[letter] === "present" ? "◖" : "–"}</span>}
            </button>
          ))}

          {i === 2 ? (
            <button
              className="key key--wide"
              onClick={onBackspace}
              disabled={disabled}
              aria-label="Delete letter"
            >
              Del
            </button>
          ) : null}

          {i === 1 ? <div className="key-spacer" aria-hidden /> : null}
        </div>
      ))}
    </div>
  );
}
