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
        <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M12 2.8v2.1M12 19.1v2.1M21.2 12h-2.1M4.9 12H2.8M18.5 5.5l-1.5 1.5M7 17l-1.5 1.5M18.5 18.5 17 17M7 7 5.5 5.5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
      {showLabel && <span>Settings</span>}
    </Link>
  );
}
