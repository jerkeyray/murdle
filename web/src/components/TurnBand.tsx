"use client";

import { motion } from "motion/react";

interface TurnBandProps {
  seat: number;
  name: string;
  /** Which word of the run this is, and how many there are. */
  word: number;
  of: number;
}

/**
 * Whose board this is.
 *
 * In a duel the phone changes hands between every board, so the first thing
 * anyone needs on picking it up is confirmation that this one is theirs. Named
 * as well as coloured — colour alone is never the only signal — and keyed on
 * the seat so it replays its animation on every handover.
 */
export function TurnBand({ seat, name, word, of }: TurnBandProps) {
  return (
    <div className="turn" data-seat={seat}>
      <motion.div
        className="turn-inner"
        // Keyed on the seat so React swaps the element and replays the
        // animation on every handoff rather than only on the first.
        key={seat}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <span className="turn-dot" aria-hidden />
        <span className="turn-name">{name}</span>
        <span className="turn-verb">
          word {word} of {of}
        </span>
      </motion.div>
    </div>
  );
}
