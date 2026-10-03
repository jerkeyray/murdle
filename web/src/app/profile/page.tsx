"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, getFriends, getProfile, type FriendRecord, type Profile } from "@/lib/api";
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
  const [renaming, setRenaming] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchAll = useCallback(() => Promise.all([getProfile(), getFriends()]), []);

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
      <main className="sheet">
        {head}
        <section className="guest-profile">
          <span className="label">Your collection starts here</span>
          <h2>Words worth keeping.</h2>
          <p>Sign in to keep the words you discover, build a daily streak, and play with friends.</p>
          <ul><li>Every discovered word, in one place</li><li>Save favourites to revisit</li><li>Track your streak and play together</li></ul>
          <Link href="/sign-in?returnTo=%2Fprofile" className="button button--link">Sign in</Link>
          <Link href="/play" className="text-button">Play a round</Link>
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
  return (
    <main className="sheet">
      {head}

      <section className="profile-summary" aria-labelledby="about-you">
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
          <div className="profile-summary-head">
            <div>
              <span className="label">About you</span>
              <h2 id="about-you" className="profile-summary-name">{profile.displayName}</h2>
            </div>
            <button
              type="button"
              className="profile-edit"
              onClick={() => setRenaming(true)}
              aria-label={`Edit nickname ${profile.displayName}`}
            >
              Edit
            </button>
          </div>
        )}

        <dl className="profile-stats">
          <div>
            <dt>Streak</dt>
            <dd>{profile.streak.current}</dd>
            {profile.streak.current > 0 && !profile.streak.playedToday && <span>Play today</span>}
          </div>
          <div>
            <dt>Words met</dt>
            <dd>{profile.wordsLearned}</dd>
          </div>
          <div>
            <dt>Best run</dt>
            <dd>{profile.streak.longest}</dd>
          </div>
        </dl>
      </section>

      <section className="profile-destinations" aria-label="Your library">
        <Link className="profile-destination" href="/words">
          <span className="profile-destination-icon" aria-hidden>✦</span>
          <span><span className="label">Collection</span><strong>Words you’ve met</strong><small>{profile.wordsLearned} {profile.wordsLearned === 1 ? "word" : "words"}</small></span>
          <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="m9 5 7 7-7 7" /></svg>
        </Link>
        <Link className="profile-destination" href="/words#saved">
          <span className="profile-destination-icon" aria-hidden>⌑</span>
          <span><span className="label">Saved</span><strong>Return to a word</strong><small>Your personal reading list</small></span>
          <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="m9 5 7 7-7 7" /></svg>
        </Link>
      </section>

      <Link className="profile-friends" href="/friends">
        <span className="profile-friends-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m2 9v-2a6 6 0 0 0-2-4" /></svg></span>
        <span><span className="label">Friends</span><strong>Play together</strong></span>
        {pending.length > 0 && <span className="profile-friends-badge" aria-label={`${pending.length} pending requests`}>{pending.length}</span>}
        <svg className="profile-friends-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </Link>

    </main>
  );
}
