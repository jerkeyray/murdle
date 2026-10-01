"use client";

import Link from "next/link";

interface BackButtonProps {
  href: string;
}

/**
 * Back, as an icon button the same size as the one in the opposite corner.
 *
 * It used to be the word "BACK" floating above the content, which read as a
 * stray label rather than a control and left the header unbalanced.
 */
export function BackButton({ href }: BackButtonProps) {
  return (
    <Link className="icon-button" href={href} aria-label="Back" title="Back">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M15 5l-7 7 7 7"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}
