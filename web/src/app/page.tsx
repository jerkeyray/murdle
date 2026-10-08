"use client";

import Link from "next/link";
import { startTransition, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getHomeSummary, type HomeSummary } from "@/lib/api";
import { ProfileButton } from "@/components/ProfileButton";
import { activeRunFor, clearRetiredKeys, DEFAULT_GAME_CONFIG, savedGameConfig, subscribeSession, type GameConfig, writeLocal } from "@/lib/session";
import { SettingsButton } from "@/components/SettingsButton";
import { FriendsEntry } from "@/components/FriendsEntry";
import { HomeRow } from "@/components/HomeRow";
import { HomeMeta } from "@/components/HomeMeta";
import { prefetchGame } from "@/lib/useGame";

/**
 * The front door: one button.
 *
 * Everything else — how it looks, what you have collected, how long the words
 * are — lives behind the two icons at the top. Nothing here competes with
 * starting a game.
 */
const serverSession = () => null;

export default function Home() {
  const [config, setConfig] = useState<GameConfig>(DEFAULT_GAME_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const savedRun = useSyncExternalStore(subscribeSession, () => activeRunFor(config), serverSession);
  const [homeSummary, setHomeSummary] = useState<HomeSummary | null>(null);
  const fetchHomeSummary = useCallback(() => getHomeSummary(), []);

  useEffect(() => {
    let cancelled = false;
    fetchHomeSummary()
      .then((summary) => {
        if (!cancelled) setHomeSummary(summary);
      })
      // Signed out is the ordinary case, not an error worth showing.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fetchHomeSummary]);
  useEffect(() => {
    clearRetiredKeys();
    const effective = savedGameConfig();
    // Deal the game now, for the settings Begin will actually open with, so the
    // round trip happens while you are looking at this page rather than after
    // you have tapped.
    prefetchGame(effective);
    startTransition(() => {
      setConfig(effective);
      setConfigLoaded(true);
    });
  }, []);
  useEffect(() => { if (configLoaded) writeLocal("wordle.mode", JSON.stringify(config)); }, [config, configLoaded]);

  return (
    <main className="home">
      <header className="home-top">
        <SettingsButton />
        <ProfileButton
          streakAtRisk={
            homeSummary && homeSummary.streak.current > 0 && !homeSummary.streak.playedToday
              ? homeSummary.streak.current
              : undefined
          }
        />
      </header>

      <div className="home-middle">
        <section className="home-intro">
          <h1 className="home-mark">Wordle</h1>
          <HomeMeta streak={homeSummary?.streak.current} />
        </section>
        <HomeRow />
        <div className="home-actions">
          <Link className="play" href={`/play?length=${config.wordLength}&difficulty=${config.difficulty}`}>
            <span className="play-word">
              {savedRun ? "Continue" : "Begin"}
            </span>
          </Link>
          <FriendsEntry />
        </div>
      </div>
    </main>
  );
}
