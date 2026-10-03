"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BackButton } from "@/components/BackButton";
import { Preferences } from "@/components/Preferences";
import { clearToken } from "@/lib/token";
import { signOut, useSession } from "@/lib/auth-client";
import { readLocal, type GameConfig, writeLocal } from "@/lib/session";

const DEFAULT_GAME_CONFIG: GameConfig = { mode: "classic", wordLength: 5, difficulty: "mixed" };

function savedGameConfig(): GameConfig {
  try {
    const saved = JSON.parse(readLocal("wordle.mode") ?? "null") as GameConfig | null;
    if (saved && (saved.mode === "classic" || saved.mode === "themed") && (saved.wordLength === 5 || saved.wordLength === 6)) {
      return { ...saved, difficulty: saved.difficulty === "learning" ? "learning" : "mixed" };
    }
  } catch { /* Classic five-letter play is the default. */ }
  return DEFAULT_GAME_CONFIG;
}

/**
 * Settings, reached by the cog on the home screen.
 *
 * Appearance and the default game setup live here. The front page stays a
 * calm way into a game rather than becoming a configuration form.
 */
export default function SettingsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [gameConfig, setGameConfig] = useState<GameConfig>(savedGameConfig);

  function chooseGameConfig(next: GameConfig) {
    setGameConfig(next);
    writeLocal("wordle.mode", JSON.stringify(next));
  }

  async function onSignOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      await signOut();
      clearToken();
      router.replace("/");
      router.refresh();
    } catch {
      setSignOutError("Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <main className="sheet">
      <header className="sheet-head">
        <BackButton href="/" />
        <h1 className="sheet-title">Settings</h1>
      </header>
      <section className="game-setup" aria-labelledby="game-setup-title">
        <div className="block-head"><span className="label">Game setup</span></div>
        <div className="game-setup-card">
          <div className="game-setting">
            <div>
              <h2 id="game-setup-title">Game type</h2>
              <p>Classic is the default.</p>
            </div>
            <div className="game-options" role="group" aria-label="Game mode">
              <button aria-pressed={gameConfig.mode === "classic"} onClick={() => chooseGameConfig({ ...gameConfig, mode: "classic" })}>Classic</button>
              <button aria-pressed={gameConfig.mode === "themed"} onClick={() => chooseGameConfig({ ...gameConfig, mode: "themed" })}>Themed</button>
            </div>
          </div>
          <div className="game-setting">
            <div>
              <h2>Word length</h2>
              <p>Choose five or six letters.</p>
            </div>
            <div className="game-options" role="group" aria-label="Word length">
              {[5, 6].map((length) => <button key={length} aria-pressed={gameConfig.wordLength === length} onClick={() => chooseGameConfig({ ...gameConfig, wordLength: length as 5 | 6 })}>{length} letters</button>)}
            </div>
          </div>
          <div className="game-setting">
            <div>
              <h2>Answer vocabulary</h2>
              <p>{gameConfig.mode === "classic" ? "Learning leaves out the most familiar answers." : "Themed sets keep their curated mix of words."}</p>
            </div>
            <div className="game-options" role="group" aria-label="Answer vocabulary">
              <button aria-pressed={gameConfig.difficulty === "mixed"} onClick={() => chooseGameConfig({ ...gameConfig, difficulty: "mixed" })}>Mixed</button>
              <button aria-pressed={gameConfig.difficulty === "learning"} onClick={() => chooseGameConfig({ ...gameConfig, difficulty: "learning" })}>Learning</button>
            </div>
          </div>
        </div>
      </section>
      <Preferences />
      {!isPending && session && <section className="settings-account">
        <div className="block-head"><span className="label">Account</span></div>
        <div className="settings-account-card">
          <p>Sign out of your account on this device.</p>
          <button className="settings-signout" onClick={onSignOut} disabled={signingOut}>
            <span>{signingOut ? "Signing out…" : "Sign out"}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg>
          </button>
          {signOutError && <p className="form-error" role="alert">{signOutError}</p>}
        </div>
      </section>}
    </main>
  );
}
