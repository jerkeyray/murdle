"use client";

import Link from "next/link";

/**
 * The only chrome the board carries: a way into your lexicon.
 *
 * Theme and contrast used to live here. They are set once and then forgotten,
 * so they moved to Preferences on the profile and the board got quieter.
 */
export function Settings() {
  return (
    <div className="topbar-actions">
      <Link
        className="icon-button"
        href="/profile"
        aria-label="Your lexicon"
        title="Your lexicon"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 15.5z"
                stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5z"
                stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      </Link>
    </div>
  );
}
