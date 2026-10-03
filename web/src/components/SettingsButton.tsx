"use client";

import Link from "next/link";

/**
 * The way into settings.
 *
 * A cog, opposite the lexicon, so the two things you might want from outside a
 * game sit in the two top corners and neither is buried.
 */
export function SettingsButton({ showLabel = false }: { showLabel?: boolean }) {
  return (
    <Link
      className={`icon-button ${showLabel ? "nav-labelled" : ""}`}
      href="/settings"
      aria-label="Settings"
      title="Settings"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12.4" r="3" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M9.5 2.5h5l.65 2.8c.75.22 1.42.6 2 1.08l2.75-.92 2.5 4.33-2.12 2.05c.1.75.1 1.48 0 2.23l2.12 2.05-2.5 4.33-2.75-.92a7.2 7.2 0 0 1-2 1.08l-.65 2.8h-5l-.65-2.8a7.2 7.2 0 0 1-2-1.08l-2.75.92-2.5-4.33 2.12-2.05a8.4 8.4 0 0 1 0-2.23L3.6 9.76l2.5-4.33 2.75.92c.58-.48 1.25-.86 2-1.08z"
          stroke="currentColor"
          strokeWidth="1.55"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showLabel && <span>Settings</span>}
    </Link>
  );
}
