"use client";

import { useSyncExternalStore } from "react";

/**
 * The meta line.
 *
 * Small, letterspaced, and sitting under the name — the kind of detail that
 * does the decorating so nothing else has to. It carries only what is true:
 * the date, and a streak when there is one to report.
 */
const neverChanges = () => () => {};
const todayLabel = () =>
  new Date()
    .toLocaleDateString(undefined, { month: "short", day: "numeric" })
    .toUpperCase();
// The server's date and the browser's can disagree, and a hydration warning is
// a poor trade for a dateline.
const noDateOnServer = () => null;

export function HomeMeta({ streak }: { streak?: number }) {
  const today = useSyncExternalStore(neverChanges, todayLabel, noDateOnServer);

  if (!today) return <p className="home-meta" aria-hidden />;
  return (
    <p className="home-meta">
      <span>{today}</span>
      {streak ? (
        <>
          <span aria-hidden>·</span>
          <span>
            Streak <b>{streak}</b>
          </span>
        </>
      ) : null}
    </p>
  );
}
