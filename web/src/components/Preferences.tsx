"use client";

import { useSyncExternalStore } from "react";
import {
  getColorBlind,
  getServerColorBlind,
  getServerTheme,
  getTheme,
  setColorBlind,
  setTheme,
  subscribe,
} from "@/lib/theme";

/**
 * How it looks.
 *
 * These live here rather than in the game header because they are set once and
 * then forgotten, and the board should carry nothing it does not need.
 * Switches with words on them, too — an unlabelled icon toggle for a
 * colour-blind mode is a small joke at the expense of the people who need it.
 */
export function Preferences() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);
  const colorBlind = useSyncExternalStore(
    subscribe,
    getColorBlind,
    getServerColorBlind,
  );

  return (
    <section className="prefs">
      <div className="block-head">
        <span className="label">How it looks</span>
      </div>

      <div className="prefs-card">
        <div className="appearance-pref">
          <p className="pref-name">Appearance</p>
          <div className="appearance-options" role="group" aria-label="Appearance">
            {(["light", "dark", "system"] as const).map((choice) => <button key={choice} aria-pressed={theme === choice} onClick={() => setTheme(choice)}>{choice === "light" ? "Light" : choice === "dark" ? "Dark" : "System"}</button>)}
          </div>
          <p className="pref-sub">System follows your device’s appearance.</p>
        </div>

        <button
          className="pref"
          onClick={() => setColorBlind(!colorBlind)}
          aria-pressed={colorBlind}
        >
          <span className="pref-text">
            <span className="pref-name">High contrast marks</span>
            <span className="pref-sub">
              Blue and orange instead of green and rose, with shapes
            </span>
          </span>
          <span className="switch" aria-hidden />
        </button>

        <div className="pref-sample">
          <span className="pref-sample-label">
            Right spot · elsewhere · not in the word
          </span>
          <span className="pref-sample-tiles" aria-hidden>
            {(["hit", "present", "absent"] as const).map((mark, i) => (
              <span className="pref-tile" data-mark={mark} key={mark}>
                {"abc"[i]}
              </span>
            ))}
          </span>
        </div>
      </div>
    </section>
  );
}
