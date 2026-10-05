"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, getFriends, getProfile, getSavedWords, getSolves, type FriendRecord, type Profile, type SolveRecord } from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { NameForm } from "@/components/NameForm";
import { safeReturnTo } from "@/lib/returnTo";
import { useRouter } from "next/navigation";
import { Loader } from "@/components/Loader";
import { SettingsButton } from "@/components/SettingsButton";

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [recent, setRecent] = useState<SolveRecord[]>([]);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchAll = useCallback(() => Promise.all([getProfile(), getFriends()]), []);

  // The words are the point of this page, so it leads with them. Loaded
  // separately: a slow collection should never hold back the name and stats.
  useEffect(() => {
    let cancelled = false;
    getSolves({ limit: 5 }).then((page) => { if (!cancelled) setRecent(page.items); }).catch(() => {});
    getSavedWords({ limit: 1 }).then((page) => { if (!cancelled) setSavedCount(page.total); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const apply = useCallback(
    ([p, f]: Awaited<ReturnType<typeof fetchAll>>) => {
      setProfile(p);
      setFriends(f);
      setSignedOut(false);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetchAll()
      .then((r) => {
        if (!cancelled) apply(r);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) setSignedOut(true);
        else setError("Your words could not load. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAll, apply]);

  const head = (
    <header className="sheet-head">
      <BackButton href="/" />
      <h1 className="sheet-title">Your words</h1>
      <SettingsButton />
    </header>
  );

  // Signed out still gets Preferences. Contrast settings are an accessibility
  // need, and gating them behind an account would be a poor joke.
  if (signedOut) {
    return (
      <main className="sheet sheet--guest">
        {head}
        <section className="guest-profile">
          <span className="label">Your library</span>
          <h2>Keep the words you meet.</h2>
          <p>Sign in to save words and play with friends.</p>
          <Link href="/sign-in?returnTo=%2Fprofile" className="button button--link">Sign in</Link>
        </section>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="sheet">
        {head}
        {error ? <div className="empty"><p role="alert">{error}</p><button className="button" onClick={() => window.location.reload()}>Try again</button></div> : <Loader />}
      </main>
    );
  }

  if (profile.needsName) {
    return (
      <main className="sheet">
        {head}
        <div className="plate plate--naming">
          <NameForm
            firstRun
            onSaved={(name) => {
              setProfile({ ...profile, displayName: name, needsName: false });
              const next = new URLSearchParams(window.location.search).get("returnTo");
              if (next) router.push(safeReturnTo(next));
            }}
          />
        </div>
      </main>
    );
  }

  const pending = friends.filter((f) => f.status === "pending" && f.incoming);
  const friendCount = friends.filter((f) => f.status === "accepted").length;
  const { current, longest, playedToday } = profile.streak;
  return (
    <main className="sheet profile">
      {head}

      <section className="profile-hero" aria-labelledby="profile-name">
        {renaming ? (
          <NameForm
            current={profile.displayName}
            onSaved={(name) => {
              setProfile({ ...profile, displayName: name });
              setRenaming(false);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <>
            <h2 id="profile-name" className="profile-name">{profile.displayName}</h2>
            <button type="button" className="profile-rename" onClick={() => setRenaming(true)} aria-label={`Change nickname ${profile.displayName}`}>Change name</button>
          </>
        )}

        <dl className="profile-figures">
          <div><dt>day streak</dt><dd>{current}</dd></div>
          <div><dt>{profile.wordsLearned === 1 ? "word met" : "words met"}</dt><dd>{profile.wordsLearned}</dd></div>
          <div><dt>best streak</dt><dd>{longest}</dd></div>
        </dl>
        {current > 0 && !playedToday && (
          <Link className="profile-nudge" href="/play">Play today to keep your {current}-day streak</Link>
        )}
      </section>

      <section className="profile-recent" aria-labelledby="recent-heading">
        <div className="profile-section-head">
          <h3 id="recent-heading" className="label">Recently met</h3>
          {profile.wordsLearned > 0 && <Link href="/words">See all {profile.wordsLearned}</Link>}
        </div>
        {recent.length > 0 ? (
          <ul>
            {recent.map((w) => (
              <li key={`${w.word}-${w.playedOn}`}>
                <Link href="/words">
                  <strong>{w.word}</strong>
                  <span>{w.entry?.definition ?? "A word from your board."}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="profile-empty">The words you solve collect here. <Link href="/play">Play a round</Link></p>
        )}
      </section>

      <nav className="profile-links" aria-label="More">
        <Link href="/words#saved">
          <span>Saved words</span>
          {savedCount !== null && <small>{savedCount}</small>}
          <Chevron />
        </Link>
        <Link href="/friends">
          <span>Friends</span>
          {pending.length > 0
            ? <small className="profile-links-alert">{pending.length} {pending.length === 1 ? "request" : "requests"}</small>
            : friendCount > 0 && <small>{friendCount}</small>}
          <Chevron />
        </Link>
      </nav>
    </main>
  );
}

function Chevron() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>;
}
