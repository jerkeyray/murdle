"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, signUp } from "@/lib/auth-client";
import { clearToken } from "@/lib/token";
import { BackButton } from "@/components/BackButton";

/**
 * The way in.
 *
 * Google first, because nobody wants to invent a password for a word game.
 * Email stays available underneath: it is the fallback when Google is not
 * configured, and the only way in at all until it is.
 */
export default function SignInPage() {
  const router = useRouter();
  const [google, setGoogle] = useState(false);
  const [withEmail, setWithEmail] = useState(false);
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchConfig = useCallback(
    () => fetch("/api/config").then((r) => r.json() as Promise<{ google: boolean }>),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetchConfig()
      .then((c) => {
        if (!cancelled) setGoogle(c.google);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fetchConfig]);

  async function onGoogle() {
    setBusy(true);
    setError(null);
    // Better Auth redirects away and comes back to callbackURL, so there is
    // nothing to await here on the happy path.
    const result = await signIn.social({
      provider: "google",
      callbackURL: "/profile",
    });
    if (result?.error) {
      setBusy(false);
      setError(result.error.message ?? "Google would not sign you in");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const result =
      mode === "up"
        ? await signUp.email({ email, password, name: name || email.split("@")[0] })
        : await signIn.email({ email, password });

    setBusy(false);

    if (result.error) {
      setError(result.error.message ?? "That did not work");
      return;
    }

    // The cached JWT belongs to whoever was signed in before.
    clearToken();
    router.push("/profile");
  }

  return (
    <main className="sheet">
      <header className="sheet-head">
        <BackButton href="/" />
        <h1 className="sheet-title">Sign in</h1>
      </header>

      <p className="empty sign-in-line">
        So your words have somewhere to collect.
      </p>

      {google ? (
        <button className="google" onClick={onGoogle} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
            <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.3z"/>
            <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46z"/>
            <path fill="#FBBC05" d="M11.6 28.2c-.4-1.3-.7-2.7-.7-4.2s.2-2.9.7-4.2v-5.7H4.3C2.8 17 2 20.4 2 24s.8 7 2.3 9.9l7.3-5.7z"/>
            <path fill="#EA4335" d="M24 10.7c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.1 30 2 24 2 15.4 2 7.9 6.9 4.3 14.1l7.3 5.7c1.7-5.2 6.6-9.1 12.4-9.1z"/>
          </svg>
          Continue with Google
        </button>
      ) : null}

      {google && !withEmail ? (
        <button className="link-button sign-in-alt" onClick={() => setWithEmail(true)}>
          Use an email address instead
        </button>
      ) : null}

      {!google || withEmail ? (
        <form className="form sign-in-form" onSubmit={onSubmit}>
          {!google ? (
            <p className="hint">
              Google sign-in is not configured yet, so email it is.
            </p>
          ) : null}

          {mode === "up" ? (
            <label className="field">
              <span className="label">Name</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="What she calls you"
              />
            </label>
          ) : null}

          <label className="field">
            <span className="label">Email</span>
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>

          <label className="field">
            <span className="label">Password</span>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "up" ? "new-password" : "current-password"}
            />
          </label>

          {error ? <p className="form-error">{error}</p> : null}

          <button className="button" type="submit" disabled={busy}>
            {busy ? "One moment" : mode === "in" ? "Sign in" : "Create account"}
          </button>

          <button
            type="button"
            className="link-button"
            onClick={() => {
              setMode(mode === "in" ? "up" : "in");
              setError(null);
            }}
          >
            {mode === "in"
              ? "No account yet? Make one"
              : "Already have an account? Sign in"}
          </button>
        </form>
      ) : null}

      {error && google && !withEmail ? (
        <p className="form-error">{error}</p>
      ) : null}

      <p className="hint sign-in-foot">
        You never need an account to play. <Link href="/">Go straight to a game</Link>.
      </p>
    </main>
  );
}
