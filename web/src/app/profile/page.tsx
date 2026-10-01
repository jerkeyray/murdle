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
import { Alphabet } from "@/components/Alphabet";
import { Preferences } from "@/components/Preferences";
import { StreakCalendar } from "@/components/StreakCalendar";

type Tab = "collection" | "kept" | "friends";

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [solves, setSolves] = useState<SolveRecord[]>([]);
  const [saved, setSaved] = useState<SolveRecord[]>([]);
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [tab, setTab] = useState<Tab>("collection");
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const fetchAll = useCallback(
    () => Promise.all([getProfile(), getSolves(), getSavedWords(), getFriends()]),
    [],
  );

  const apply = useCallback(
    ([p, s, sv, f]: Awaited<ReturnType<typeof fetchAll>>) => {
      setProfile(p);
      setSolves(s);
      setSaved(sv);
      setFriends(f);
      setSignedOut(false);
    },
    [],
  );

  /** Refresh after an action; safe from an event handler. */
  const load = useCallback(async () => {
    try {
      apply(await fetchAll());
    } catch {
      setSignedOut(true);
    }
  }, [fetchAll, apply]);

  useEffect(() => {
    let cancelled = false;
    fetchAll()
      .then((r) => {
        if (!cancelled) apply(r);
      })
      .catch(() => {
        if (!cancelled) setSignedOut(true);
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
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add them");
    }
  }

  const head = (
    <header className="sheet-head">
      <Link href="/" className="label sheet-back">
        Back
      </Link>
    </header>
  );

  // Signed out still gets Preferences. Contrast settings are an accessibility
  // need, and gating them behind an account would be a poor joke.
  if (signedOut) {
    return (
      <main className="sheet">
        {head}
        {/* An unfilled bookplate: the blank is the invitation. */}
        <div className="plate plate--empty">
          <span className="plate-ex">Ex libris</span>
          <div className="plate-blank" aria-hidden />
        </div>

        <p className="empty">
          Sign in and every word you meet joins a lexicon of your own — with a
          streak, the words you kept, and someone to play against.
        </p>

        <Link href="/sign-in" className="button button--link">
          Sign in
        </Link>

        <Preferences />
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="sheet">
        {head}
        <span className="label">Loading</span>
      </main>
    );
  }

  const pending = friends.filter((f) => f.status === "pending" && f.incoming);
  const list = tab === "collection" ? solves : tab === "kept" ? saved : [];

  return (
    <main className="sheet">
      {head}

      {/* A bookplate: whose collection this is, and the shelf mark someone
          else types to find it. */}
      <div className="plate">
        <span className="plate-ex">Ex libris</span>
        <h1 className="plate-name">{profile.displayName}</h1>
        <div className="plate-rule" />
        <div className="plate-foot">
          <span className="label">Shelf mark</span>
          <span className="plate-code">{profile.inviteCode}</span>
        </div>
      </div>

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

      <StreakCalendar solves={solves} />
      <Alphabet solves={solves} />

      <nav className="tabs" role="tablist">
        {(["collection", "kept", "friends"] as Tab[]).map((t) => (
          <button
            key={t}
            className="tab"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === "collection"
              ? `Collection ${solves.length}`
              : t === "kept"
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
              placeholder="Their shelf mark"
              maxLength={6}
              aria-label="Friend's invite code"
            />
            <button className="button button--inline" type="submit">
              Add
            </button>
          </form>

          {error ? <p className="form-error">{error}</p> : null}

          {friends.length === 0 ? (
            <p className="empty">
              Nobody yet. Swap shelf marks and you will both see it here.
            </p>
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
          {list.map((s, i) => (
            <li className="entry-row" key={s.word}>
              <div className="entry-row-head">
                <span className="row-word">
                  <span className="entry-no">
                    {String(i + 1).padStart(3, "0")}
                  </span>
                  {s.word}
                </span>
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

      <Preferences />

      <button
        className="link-button sign-out"
        onClick={async () => {
          await signOut();
          clearToken();
          setSignedOut(true);
        }}
      >
        Sign out
      </button>
    </main>
  );
}
