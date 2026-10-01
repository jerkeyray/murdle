"use client";

import type { SolveRecord } from "@/lib/api";

const WEEKS = 15;
const DAYS = WEEKS * 7;

/** A bare calendar date, so comparisons never trip over a timezone offset. */
function dayKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface StreakCalendarProps {
  solves: SolveRecord[];
}

/**
 * The last fifteen weeks, as letters rather than blank squares.
 *
 * A contribution graph tells you that you turned up. This tells you what you
 * met — each day you played carries the first letter of that day's word, set
 * in the same serif as the board. The shape of the habit and the content of it
 * in one object, and you can actually read it.
 */
export function StreakCalendar({ solves }: StreakCalendarProps) {
  // Last word of each day wins: if a day holds several, the most recent is the
  // one you would remember.
  const byDay = new Map<string, SolveRecord>();
  for (const s of solves) byDay.set(s.playedOn, s);

  const today = new Date();
  const cells = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today);
    // Walk back so the final column is this week.
    d.setDate(today.getDate() - (DAYS - 1 - i));
    const key = dayKey(d);
    return { key, date: d, solve: byDay.get(key) };
  });

  // Column-major: each column is a week, each row a weekday.
  const columns: (typeof cells)[] = [];
  for (let c = 0; c < WEEKS; c++) {
    columns.push(cells.slice(c * 7, c * 7 + 7));
  }

  const played = cells.filter((c) => c.solve).length;

  return (
    <section className="calendar-block">
      <div className="block-head">
        <span className="label">Last fifteen weeks</span>
        <span className="label">{played} days</span>
      </div>

      <div className="calendar" role="img"
           aria-label={`Played on ${played} of the last ${DAYS} days`}>
        {columns.map((week, i) => (
          <div className="calendar-week" key={i}>
            {week.map((cell) => (
              <span
                className="calendar-day"
                key={cell.key}
                data-played={cell.solve ? "true" : undefined}
                data-missed={cell.solve && !cell.solve.solved ? "true" : undefined}
                title={
                  cell.solve
                    ? `${cell.solve.word} — ${cell.key}`
                    : cell.key
                }
              >
                {cell.solve ? cell.solve.word[0] : ""}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
