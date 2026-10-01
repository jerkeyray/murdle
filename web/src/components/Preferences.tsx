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

      <button
        className="pref"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        aria-pressed={theme === "light"}
      >
        <span className="pref-text">
          <span className="pref-name">Paper</span>
          <span className="pref-sub">Light instead of ink</span>
        </span>
        <span className="switch" aria-hidden />
      </button>

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

      <div className="pref-sample" aria-hidden>
        {(["hit", "present", "absent"] as const).map((mark, i) => (
          <span className="pref-tile" data-mark={mark} key={mark}>
            {"abc"[i]}
          </span>
        ))}
      </div>
    </section>
  );
}
