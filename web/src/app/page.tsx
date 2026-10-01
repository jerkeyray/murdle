"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useCallback, useEffect } from "react";
import { getProfile, type Profile } from "@/lib/api";
import { loadSeats, saveSeats } from "@/lib/seats";

/**
 * The front door.
 *
 * Dropping straight into a game would mean the only choice that matters never
 * gets made. Two people and one phone is what this is for, and that has to be
 * offered rather than buried.
 */
export default function Home() {
  const router = useRouter();
  const [choosing, setChoosing] = useState(false);
  const [names, setNames] = useState<[string, string]>(["", ""]);

  // The lexicon card shows the streak rather than just linking to it, so the
  // number you are protecting is on the screen you open.
  const [profile, setProfile] = useState<Profile | null>(null);
  const fetchProfile = useCallback(() => getProfile(), []);

  useEffect(() => {
    let cancelled = false;
    fetchProfile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      // Signed out is the ordinary case, not an error worth showing.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fetchProfile]);

  function openShared() {
    // Prefilled from last time: you two will almost always be the same two.
    setNames(loadSeats().names);
    setChoosing(true);
  }

  function startShared(e: React.FormEvent) {
    e.preventDefault();
    const seats = loadSeats();
    saveSeats({
      names: [
        names[0].trim() || seats.names[0],
        names[1].trim() || seats.names[1],
      ],
    });
    router.push("/play/shared");
  }

  return (
    <main className="home">
      <div className="home-middle">
        <h1 className="home-mark">Murdle</h1>
        <p className="home-line">
          Five words that secretly belong together. Work out the connection
          before the last one falls.
        </p>

        {choosing ? (
          <form className="seats" onSubmit={startShared}>
            <span className="label">Who is playing</span>

            <div className="seat-fields">
              {[0, 1].map((seat) => (
                <label className="seat-field" key={seat} data-seat={seat}>
                  <span className="seat-dot" aria-hidden />
                  <input
                    className="input seat-input"
                    value={names[seat]}
                    onChange={(e) =>
                      setNames((n) => {
                        const next: [string, string] = [...n];
                        next[seat] = e.target.value;
                        return next;
                      })
                    }
                    maxLength={14}
                    aria-label={`Player ${seat + 1} name`}
                    autoFocus={seat === 0}
                  />
                </label>
              ))}
            </div>

            <p className="seats-note">
              You take turns on the same board — one row each. Whoever lands the
              word takes the round.
            </p>

            <button className="button" type="submit">
              Start
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => setChoosing(false)}
            >
              Back
            </button>
          </form>
        ) : (
          <div className="choices">
            <Link className="choice" href="/play/solo">
              <span className="choice-title">Just me</span>
              <span className="choice-sub">One board, six guesses</span>
            </Link>

            <button className="choice choice--accent" onClick={openShared}>
              <span className="choice-title">Two of us</span>
              <span className="choice-sub">One phone, alternating turns</span>
            </button>
          </div>
        )}
      </div>

      <footer className="home-foot">
        <Link href="/profile" className="lexicon">
          <span className="lexicon-icon" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 15.5z"
                    stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5z"
                    stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            </svg>
          </span>

          <span className="lexicon-text">
            <span className="lexicon-title">Your lexicon</span>
            <span className="lexicon-sub">
              {profile
                ? `${profile.wordsLearned} word${profile.wordsLearned === 1 ? "" : "s"} met` +
                  (profile.streak.current > 0
                    ? ` · ${profile.streak.current} day streak`
                    : "")
                : "Words you have met, and how it looks"}
            </span>
          </span>

          {profile && profile.streak.current > 0 && !profile.streak.playedToday ? (
            <span className="lexicon-flag" title="Play today to keep it">
              {profile.streak.current}
            </span>
          ) : null}
        </Link>
      </footer>
    </main>
  );
}
