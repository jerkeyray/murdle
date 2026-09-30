"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  addFriend,
  getFriends,
  getProfile,
  getSavedWords,
  getSolves,
  respondToFriend,
  type FriendRecord,
  type Profile,
  type SolveRecord,
} from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { clearToken } from "@/lib/token";

type Tab = "collection" | "saved" | "friends";

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [solves, setSolves] = useState<SolveRecord[]>([]);
  const [saved, setSaved] = useState<SolveRecord[]>([]);
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [tab, setTab] = useState<Tab>("collection");
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");

  /** One request per section, but they are always wanted together. */
  const fetchAll = useCallback(
    () =>
      Promise.all([getProfile(), getSolves(), getSavedWords(), getFriends()]),
    [],
  );

  const apply = useCallback(
    ([p, s, sv, f]: Awaited<ReturnType<typeof fetchAll>>) => {
      setProfile(p);
      setSolves(s);
      setSaved(sv);
      setFriends(f);
      setError(null);
    },
    [],
  );

  /** Refresh after an action. Safe to call state synchronously from here — it
   *  runs from an event handler, not from an effect body. */
  const load = useCallback(async () => {
    try {
      apply(await fetchAll());
    } catch {
      setError("signed-out");
    }
  }, [fetchAll, apply]);

  useEffect(() => {
    let cancelled = false;

    fetchAll()
      .then((result) => {
        if (!cancelled) apply(result);
      })
      .catch(() => {
        if (!cancelled) setError("signed-out");
      });

    return () => {
      cancelled = true;
    };
  }, [fetchAll, apply]);

  async function onAddFriend(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    try {
      await addFriend(code.trim());
      setCode("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add them");
    }
  }

  if (error === "signed-out") {
    return (
      <main className="sheet">
        <header className="sheet-head">
          <Link href="/" className="label sheet-back">
            Back
          </Link>
          <h1 className="sheet-title">Your words</h1>
        </header>
        <p className="empty">
          Sign in and every round you play joins a collection — with a streak,
          the words you kept, and a record against whoever you play.
        </p>
        <Link href="/sign-in" className="button button--link">
          Sign in
        </Link>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="sheet">
        <span className="label">Loading</span>
      </main>
    );
  }

  const pending = friends.filter((f) => f.status === "pending" && f.incoming);
  const list = tab === "collection" ? solves : tab === "saved" ? saved : [];

  return (
    <main className="sheet">
      <header className="sheet-head">
        <Link href="/" className="label sheet-back">
          Back
        </Link>
        <h1 className="sheet-title">{profile.displayName}</h1>
      </header>

      <div className="stats">
        <div className="stat">
          <span className="stat-number">{profile.streak.current}</span>
          <span className="label">
            Day streak
            {profile.streak.current > 0 && !profile.streak.playedToday
              ? " · play today"
              : ""}
          </span>
        </div>
        <div className="stat">
          <span className="stat-number">{profile.wordsLearned}</span>
          <span className="label">Words met</span>
        </div>
        <div className="stat">
          <span className="stat-number">{profile.streak.longest}</span>
          <span className="label">Best run</span>
        </div>
      </div>

      <div className="invite">
        <span className="label">Your code</span>
        <span className="invite-code">{profile.inviteCode}</span>
        <span className="invite-hint">Give this to her so you can play as a pair.</span>
      </div>

      <nav className="tabs" role="tablist">
        {(["collection", "saved", "friends"] as Tab[]).map((t) => (
          <button
            key={t}
            className="tab"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === "collection"
              ? `Collection ${solves.length}`
              : t === "saved"
                ? `Kept ${saved.length}`
                : `Friends ${friends.filter((f) => f.status === "accepted").length}`}
            {t === "friends" && pending.length > 0 ? (
              <span className="tab-dot" aria-label={`${pending.length} waiting`} />
            ) : null}
          </button>
        ))}
      </nav>

      {tab === "friends" ? (
        <section>
          <form className="code-form" onSubmit={onAddFriend}>
            <input
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Their code"
              maxLength={6}
              aria-label="Friend's invite code"
            />
            <button className="button button--inline" type="submit">
              Add
            </button>
          </form>

          {error && error !== "signed-out" ? (
            <p className="form-error">{error}</p>
          ) : null}

          {friends.length === 0 ? (
            <p className="empty">Nobody yet. Swap codes and you will both see it here.</p>
          ) : (
            <ul className="rows">
              {friends.map((f) => (
                <li className="row-item" key={f.id}>
                  <span className="row-word">{f.displayName}</span>
                  {f.status === "accepted" ? (
                    <span className="label">Playing</span>
                  ) : f.incoming ? (
                    <span className="row-actions">
                      <button
                        className="button button--tiny"
                        onClick={async () => {
                          await respondToFriend(f.id, true);
                          await load();
                        }}
                      >
                        Accept
                      </button>
                      <button
                        className="link-button"
                        onClick={async () => {
                          await respondToFriend(f.id, false);
                          await load();
                        }}
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <span className="label">Waiting</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : list.length === 0 ? (
        <p className="empty">
          {tab === "collection"
            ? "Nothing yet. Play a round and it lands here."
            : "Star a word at the end of a round to keep it."}
        </p>
      ) : (
        <ul className="rows">
          {list.map((s) => (
            <li className="entry-row" key={s.word}>
              <div className="entry-row-head">
                <span className="row-word">{s.word}</span>
                {tab === "collection" ? (
                  <span className="label">
                    {s.solved ? `${s.guesses} guesses` : "Missed"}
                  </span>
                ) : null}
              </div>
              {s.entry ? (
                <>
                  <p className="entry-row-def">{s.entry.definition}</p>
                  <p className="entry-row-note">{s.entry.note}</p>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <button
        className="link-button sign-out"
        onClick={async () => {
          await signOut();
          clearToken();
          setError("signed-out");
        }}
      >
        Sign out
      </button>
    </main>
  );
}
