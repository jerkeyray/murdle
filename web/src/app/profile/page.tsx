"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  getFriends,
  getProfile,
  getSavedWords,
  getSolves,
  type FriendRecord,
  type Profile,
  type SolveRecord,
} from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { NameForm } from "@/components/NameForm";
import { safeReturnTo } from "@/lib/returnTo";
import { useRouter } from "next/navigation";
import { Loader } from "@/components/Loader";
import { SettingsButton } from "@/components/SettingsButton";

type Tab = "collection" | "kept";

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [solves, setSolves] = useState<SolveRecord[]>([]);
  const [saved, setSaved] = useState<SolveRecord[]>([]);
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [tab, setTab] = useState<Tab>("collection");
  const [renaming, setRenaming] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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
  const source = tab === "collection" ? solves : saved;
  const list = source.filter((word) => [word.word, word.entry?.definition, word.entry?.note].join(" ").toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <main className="sheet">
      {head}

      {/* One card: who this is, the shelf mark someone types to find them, and
          the three counts. Three separate boxes of zeroes was more furniture
          than content. */}
      <div className="plate">
        <div className="plate-head">
          <span className="plate-ex">Ex libris</span>
          <span className="plate-code">{profile.inviteCode}</span>
        </div>

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
          <div className="plate-name-row">
            <h2 className="plate-name">{profile.displayName}</h2>
            <button
              type="button"
              className="name-edit"
              onClick={() => setRenaming(true)}
              aria-label={`Edit nickname ${profile.displayName}`}
            >
              Edit
            </button>
          </div>
        )}

        <div className="plate-rule" />

        <dl className="tally">
          <div className="tally-cell">
            <dd className="tally-number">{profile.streak.current}</dd>
            <dt className="label">
              Day streak
              {profile.streak.current > 0 && !profile.streak.playedToday
                ? " · play today"
                : ""}
            </dt>
          </div>
          <div className="tally-cell">
            <dd className="tally-number">{profile.wordsLearned}</dd>
            <dt className="label">Words met</dt>
          </div>
          <div className="tally-cell">
            <dd className="tally-number">{profile.streak.longest}</dd>
            <dt className="label">Best run</dt>
          </div>
        </dl>
      </div>

      <div className="collection-controls">
        <div className="collection-tabs" role="group" aria-label="Word collection">
          <button aria-pressed={tab === "collection"} onClick={() => setTab("collection")}>All words <span>{solves.length}</span></button>
          <button aria-pressed={tab === "kept"} onClick={() => setTab("kept")}>Saved <span>{saved.length}</span></button>
        </div>
        <Link className="text-button" href="/friends">Friends{pending.length ? ` · ${pending.length} waiting` : ""}</Link>
      </div>
      {source.length > 0 && <div className="collection-search">
        <label className="sr-only" htmlFor="word-search">Search your words</label>
        <input id="word-search" className="input" type="search" placeholder="Search words or meanings" value={query} onChange={(event) => setQuery(event.target.value)} />
        {query && <p className="collection-count" role="status">{list.length} {list.length === 1 ? "word" : "words"} found</p>}
      </div>}
      {list.length === 0 ? <div className="empty"><p>{query.trim() && source.length ? "No words match your search." : tab === "collection" ? "Play a round to discover your first words." : "Tap the bookmark on a word card to save it here."}</p>
        {query.trim() && source.length ? <button className="text-button" onClick={() => setQuery("")}>Clear search</button> : <Link className="text-button" href="/play">Play a round</Link>}
      </div> : <ul className="collection-list">{list.map((word, index) => <li className="collection-card" key={word.word}>
        <details className="collection-word">
          <summary>
            <span className="collection-card-index">WORD {String(index + 1).padStart(2, "0")}</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="m9 5 7 7-7 7" /></svg>
            <strong>{word.word}</strong>
            {word.entry && <span className="collection-definition">{word.entry.definition}</span>}
            <span className="collection-story-cue">Read the word story</span>
          </summary>
          <div className="collection-note">
            <span className="collection-note-label">Word story</span>
            <p>{word.entry?.note ?? "No word note available yet."}</p>
          </div>
        </details>
      </li>)}</ul>}

    </main>
  );
}
