"use client";

import type { Mark } from "@/lib/api";
import { MARK_LABEL } from "./Board";

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"] as const;

interface KeyboardProps {
  letterStates: Record<string, Mark>;
  onKey: (letter: string) => void;
  onEnter: () => void;
  onBackspace: () => void;
  /** Locked while a guess is in flight or the round is over. */
  disabled: boolean;
}

export function Keyboard({
  letterStates,
  onKey,
  onEnter,
  onBackspace,
  disabled,
}: KeyboardProps) {
  return (
    <div className="keyboard" role="group" aria-label="Keyboard">
      {ROWS.map((row, i) => (
        <div className="keyboard-row" key={row}>
          {/* The middle row is inset so its keys line up under the top row. */}
          {i === 1 ? <div className="key-spacer" aria-hidden /> : null}

          {i === 2 ? (
            <button
              className="key key--wide"
              onClick={onEnter}
              disabled={disabled}
              aria-label="Submit guess"
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
