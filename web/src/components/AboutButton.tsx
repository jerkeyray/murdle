"use client";

import Link from "next/link";

/**
 * The way into "about the words", a question mark beside the cog.
 *
 * It is there for the curious, so it stays small and quiet: it asks nothing of
 * anyone who just wants to play.
 */
export function AboutButton() {
  return (
    <Link className="icon-button" href="/about" aria-label="About the words" title="About the words">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9.2" />
        <path d="M9.4 9.3a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.2-2.6 3.9" />
        <circle cx="12" cy="17.2" r=".6" fill="currentColor" />
      </svg>
    </Link>
  );
}
