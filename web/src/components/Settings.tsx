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

/** Theme and contrast toggles, both reading straight from documentElement. */
export function Settings() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);
  const colorBlind = useSyncExternalStore(
    subscribe,
    getColorBlind,
    getServerColorBlind,
  );

  return (
    <div className="topbar-actions">
      <button
        className="icon-button"
        onClick={() => setColorBlind(!colorBlind)}
        aria-pressed={colorBlind}
        aria-label="High contrast colours"
        title="High contrast colours"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
        </svg>
      </button>

      <button
        className="icon-button"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"}
        title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      >
        {theme === "dark" ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
