"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { signIn } from "@/lib/auth-client";
import { BackButton } from "@/components/BackButton";

/**
 * The gate.
 *
 * Google only. Inventing a password for a word game is friction nobody wants,
 * and playing has never required an account anyway — signing in is what gives
 * a round a streak, a collection and someone to play against.
 */
export default function SignInPage() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchConfig = useCallback(
    () =>
      fetch("/api/config").then((r) => r.json() as Promise<{ google: boolean }>),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetchConfig()
      .then((c) => {
        if (!cancelled) setAvailable(c.google);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchConfig]);

  async function onGoogle() {
    setBusy(true);
    setError(null);
    // Better Auth redirects away and returns to callbackURL, so on the happy
    // path there is nothing here to await.
    const result = await signIn.social({
      provider: "google",
      callbackURL: "/profile",
    });
    if (result?.error) {
      setBusy(false);
      setError(result.error.message ?? "Google would not sign you in");
    }
  }

  return (
    <main className="gate">
      <div className="gate-nav">
        <BackButton href="/" />
      </div>

      <div className="gate-middle">
        <div className="gate-card">
          <span className="gate-ex">Ex libris</span>
          <h1 className="gate-title">Keep what you learn</h1>
          <p className="gate-line">
            Sign in and every word you meet joins a lexicon of your own — a
            streak, the words you kept, and someone to play against.
          </p>

          {available === false ? (
            <p className="hint gate-hint">
              Google sign-in is not configured yet. Set GOOGLE_CLIENT_ID and
              GOOGLE_CLIENT_SECRET, then restart the app.
            </p>
          ) : (
            <button
              className="google"
              onClick={onGoogle}
              disabled={busy || available === null}
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
                <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.3z"/>
                <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46z"/>
                <path fill="#FBBC05" d="M11.6 28.2c-.4-1.3-.7-2.7-.7-4.2s.2-2.9.7-4.2v-5.7H4.3C2.8 17 2 20.4 2 24s.8 7 2.3 9.9l7.3-5.7z"/>
                <path fill="#EA4335" d="M24 10.7c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.1 30 2 24 2 15.4 2 7.9 6.9 4.3 14.1l7.3 5.7c1.7-5.2 6.6-9.1 12.4-9.1z"/>
              </svg>
              {busy ? "Taking you to Google" : "Continue with Google"}
            </button>
          )}

          {error ? <p className="form-error gate-error">{error}</p> : null}
        </div>

        <p className="hint gate-foot">
          You never need an account to play.{" "}
          <Link href="/">Go straight to a game</Link>.
        </p>
      </div>
    </main>
  );
}
