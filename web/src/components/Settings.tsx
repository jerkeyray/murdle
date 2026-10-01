"use client";

import { ProfileButton } from "@/components/ProfileButton";

/**
 * The only chrome the board carries: a way into your lexicon.
 *
 * Theme and contrast used to live here. They are set once and then forgotten,
 * so they moved to Preferences on the profile and the board got quieter.
 */
export function Settings() {
  return (
    <div className="topbar-actions">
      <ProfileButton />
    </div>
  );
}
