"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, signUp } from "@/lib/auth-client";
import { clearToken } from "@/lib/token";

/**
 * Sign in or create an account.
 *
 * One form for both, because the only thing that differs is a name field and
 * nobody wants to hunt for the other tab. Playing never requires this — an
 * account is what makes a round count towards a streak, a collection, and a
 * record against someone else.
 */
export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <Link href="/" className="label sheet-back">
          Back
        </Link>
        <h1 className="sheet-title">
          {mode === "in" ? "Sign in" : "Make an account"}
        </h1>
      </header>

      <form className="form" onSubmit={onSubmit}>
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
    </main>
  );
}
