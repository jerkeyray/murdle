"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getProfile, type Profile } from "@/lib/api";
import { ProfileButton } from "@/components/ProfileButton";
import { SettingsButton } from "@/components/SettingsButton";

/**
 * The front door: one button.
 *
 * Everything else — how it looks, what you have collected, how long the words
 * are — lives behind the two icons at the top. Nothing here competes with
 * starting a game.
 */
export default function Home() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const fetchProfile = useCallback(() => getProfile(), []);

  useEffect(() => {
    let cancelled = false;
    fetchProfile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      // Signed out is the ordinary case, not an error worth showing.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fetchProfile]);

  return (
    <main className="home">
      <header className="home-top">
        <SettingsButton />
        <ProfileButton
          streakAtRisk={
            profile && profile.streak.current > 0 && !profile.streak.playedToday
              ? profile.streak.current
              : undefined
          }
        />
      </header>

      <div className="home-middle">
        <h1 className="home-mark">Murdle</h1>
        <p className="home-line">
          Five words that secretly belong together. Work out the connection
          before the last one falls.
        </p>

        <Link className="play" href="/play">
          <span className="play-word">Play</span>
          <span className="play-sub">Five words, a new theme</span>
        </Link>
      </div>
    </main>
  );
}
