"use client";

import { useState } from "react";
import { setDisplayName } from "@/lib/api";

const MAX = 16;

interface NameFormProps {
  /** Prefilled when renaming; empty on first run. */
  current?: string;
  /** First run gets the fuller framing; a rename is just the field. */
  firstRun?: boolean;
  onSaved: (name: string) => void;
  onCancel?: () => void;
}

/**
 * Choosing what you are called.
 *
 * Google hands over a legal name. That is not what anyone wants written on a
 * game they play with their girlfriend, and "Aditya Srivastava" does not fit
 * on a bookplate — so the nickname is asked for rather than assumed.
 */
export function NameForm({ current = "", firstRun, onSaved, onCancel }: NameFormProps) {
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= MAX;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;

    setBusy(true);
    setError(null);
    try {
      const saved = await setDisplayName(trimmed);
      onSaved(saved.displayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that");
      setBusy(false);
    }
  }

  return (
    <form className="name-form" onSubmit={onSubmit}>
      {firstRun ? (
        <>
          <span className="plate-ex">Ex libris</span>
          <h2 className="name-title">What should we call you?</h2>
          <p className="name-line">
            Short is better — it sits above the board on your turn.
          </p>
        </>
      ) : null}

      <div className="name-row">
        <input
          className="input name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX}
          placeholder="Rohan"
          aria-label="Your name"
          autoFocus
          autoComplete="off"
        />
        <button className="button button--inline" type="submit" disabled={!valid || busy}>
          {busy ? "…" : firstRun ? "Start" : "Save"}
        </button>
      </div>

      <div className="name-foot">
        <span className="hint">
          {MAX - trimmed.length} left
        </span>
        {onCancel ? (
          <button type="button" className="link-button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>

      {error ? <p className="form-error">{error}</p> : null}
    </form>
  );
}
