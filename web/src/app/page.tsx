"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getProfile, type Profile } from "@/lib/api";
import { ProfileButton } from "@/components/ProfileButton";
import { activeRun, subscribeSession } from "@/lib/session";
import { SettingsButton } from "@/components/SettingsButton";
import { FriendsEntry } from "@/components/FriendsEntry";

/**
 * The front door: one button.
 *
 * Everything else — how it looks, what you have collected, how long the words
 * are — lives behind the two icons at the top. Nothing here competes with
 * starting a game.
 */
const serverSession = () => null;

export default function Home() {
  const savedRun = useSyncExternalStore(subscribeSession, activeRun, serverSession);
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
        <section className="home-intro">
          <h1 className="home-mark">Wordle</h1>
          <p className="home-line">
            Five words. One hidden connection.
          </p>

          <Link className="play" href="/play">
            <span className="play-word">
              {savedRun ? "Continue" : "Begin"}
            </span>
            <span className="play-arrow" aria-hidden>→</span>
          </Link>
          <FriendsEntry />
        </section>

        <div className="home-specimen" aria-hidden>
          <ol className="specimen-list">
            {Array.from({ length: 5 }, (_, row) => (
              <li key={row}>
                <span className="specimen-word">
                  {Array.from({ length: 5 }, (_, tile) => (
                    <i key={tile} />
                  ))}
                </span>
                <span className="specimen-node" />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </main>
  );
}
