"use client";

import { BackButton } from "@/components/BackButton";
import { Preferences } from "@/components/Preferences";

/**
 * Settings, reached by the cog on the home screen.
 *
 * Only appearance lives here so far. Word length and hint behaviour belong
 * here too and are not built yet.
 */
export default function SettingsPage() {
  return (
    <main className="sheet">
      <header className="sheet-head">
        <BackButton href="/" />
        <h1 className="sheet-title">Settings</h1>
      </header>
      <Preferences />
    </main>
  );
}
