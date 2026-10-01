"use client";

import { motion } from "motion/react";

interface TurnBandProps {
  seat: number;
  name: string;
}

/**
 * Whose turn it is.
 *
 * The single most important thing on a shared board. Someone glancing down
 * mid-conversation has to know in under a second whether the phone is waiting
 * on them, so this is named as well as coloured — colour alone is never the
 * only signal — and it moves when the turn changes, because a thing that moves
 * catches an eye that was somewhere else.
 */
export function TurnBand({ seat, name }: TurnBandProps) {
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
        <span className="turn-verb">to play</span>
      </motion.div>
    </div>
  );
}
