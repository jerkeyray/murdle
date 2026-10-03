"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BackButton } from "@/components/BackButton";
import { Preferences } from "@/components/Preferences";
import { clearToken } from "@/lib/token";
import { signOut, useSession } from "@/lib/auth-client";

/**
 * Settings, reached by the cog on the home screen.
 *
 * Only appearance lives here so far. Word length and hint behaviour belong
 * here too and are not built yet.
 */
export default function SettingsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

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
