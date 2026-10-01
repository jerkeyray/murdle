"use client";

import Link from "next/link";

interface ProfileButtonProps {
  /** Shown as a badge when a streak is running but today has not been played
   *  — the one count here with a deadline. */
  streakAtRisk?: number;
}

/**
 * The way into your lexicon.
 *
 * Top right on every screen, which is where a person looks for themselves.
 */
export function ProfileButton({ streakAtRisk }: ProfileButtonProps) {
  return (
    <Link
      className="icon-button profile-button"
      href="/profile"
      aria-label={
        streakAtRisk
          ? `Your lexicon — ${streakAtRisk} day streak, not played today`
          : "Your lexicon"
      }
      title="Your lexicon"
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 15.5z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path
          d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>

      {streakAtRisk ? (
        <span className="profile-badge" aria-hidden>
          {streakAtRisk}
        </span>
      ) : null}
    </Link>
  );
}
