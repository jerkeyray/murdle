"use client";

import type { Mark, Row } from "@/lib/api";

interface TileProps {
  letter: string;
  mark?: Mark;
  /** Position in the row, which staggers the reveal flip. */
  index: number;
  revealing?: boolean;
}

/** Glyphs shown only in colour-blind mode, so the marks survive with no hue. */
const GLYPH: Record<Mark, string> = { hit: "\u25CF", present: "\u25D6", absent: "" };

/**
 * Spoken labels. "present" and "absent" are jargon; a screen reader user gets
 * the same plain phrasing the on-screen legend uses.
 */
export const MARK_LABEL: Record<Mark, string> = {
  hit: "right spot",
  present: "in the word",
  absent: "not in the word",
};

/**
 * The resting appearance of each mark, handed to the reveal animation as
 * custom properties so the flip can land on it at the midpoint.
 *
 * `present` is the hollow state: a tint rather than a fill, and a heavier
 * border, so it reads as unsettled next to a solid `hit`.
 */
const MARK_VARS: Record<Mark, { bg: string; text: string }> = {
  hit: { bg: "var(--mark-hit)", text: "var(--mark-hit-text)" },
  present: { bg: "var(--mark-present)", text: "var(--mark-present-text)" },
  absent: { bg: "var(--mark-absent)", text: "var(--mark-absent-text)" },
};

function Tile({ letter, mark, index, revealing }: TileProps) {
  const state = mark ? "revealed" : letter ? "filled" : "empty";

  // While a row is revealing, the mark is passed to the animation as custom
  // properties rather than as data-mark, so the appearance only lands at the
  // midpoint of the flip instead of appearing instantly.
  const vars = mark ? MARK_VARS[mark] : undefined;

  return (
    <div
      className="tile"
      data-state={state}
      data-mark={revealing ? undefined : mark}
      data-revealing={revealing || undefined}
      style={
        {
          "--reveal-index": index,
          "--tile-bg": vars?.bg,
          "--tile-text": vars?.text,
        } as React.CSSProperties
      }
      aria-label={mark ? `${letter}, ${MARK_LABEL[mark]}` : letter || "empty"}
    >
      {letter}
      {mark ? <span className="tile-glyph" aria-hidden>{GLYPH[mark]}</span> : null}
    </div>
  );
}

interface BoardProps {
  rows: Row[];
  /** The guess being typed, not yet submitted. */
  draft: string;
  wordLength: number;
  maxRows: number;
  /** Index of the row currently playing its reveal animation, if any. */
  revealingRow: number | null;
  /** Set when a guess was rejected, to shake the draft row. */
  shake: boolean;
}

export function Board({
  rows,
  draft,
  wordLength,
  maxRows,
  revealingRow,
  shake,
}: BoardProps) {
  const draftRow = rows.length;

  return (
    <div
      className="board"
      style={{ "--rows": maxRows, "--cols": wordLength } as React.CSSProperties}
    >
      {Array.from({ length: maxRows }, (_, rowIndex) => {
        const played = rows[rowIndex];
        const isDraft = rowIndex === draftRow;
        const letters = played?.guess ?? (isDraft ? draft : "");

        return (
          <div
            className="row"
            key={rowIndex}
            data-shake={isDraft && shake ? "true" : undefined}
          >
            {Array.from({ length: wordLength }, (_, col) => (
              <Tile
                key={col}
                letter={letters[col] ?? ""}
                mark={played?.marks[col]}
                index={col}
                revealing={revealingRow === rowIndex}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
