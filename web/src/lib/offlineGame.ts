import type { Mark, Round, Row } from "./api";

/** Browser copy of the solo rules for preloaded offline boards. */
export function markGuess(guess: string, answer: string): Mark[] {
  const marks: Mark[] = Array.from({ length: answer.length }, () => "absent");
  const remaining = new Map<string, number>();
  for (let i = 0; i < answer.length; i++) {
    if (guess[i] === answer[i]) marks[i] = "hit";
    else remaining.set(answer[i], (remaining.get(answer[i]) ?? 0) + 1);
  }
  for (let i = 0; i < answer.length; i++) {
    if (marks[i] === "hit") continue;
    const count = remaining.get(guess[i]) ?? 0;
    if (count) { marks[i] = "present"; remaining.set(guess[i], count - 1); }
  }
  return marks;
}

export function applyOfflineGuess(round: Round, answer: string, guess: string): Round {
  const marks = markGuess(guess, answer);
  const rows: Row[] = [...round.rows, { guess, marks }];
  const won = marks.every((mark) => mark === "hit");
  const lost = !won && rows.length >= round.maxRows;
  return {
    ...round,
    rows,
    state: won ? "won" : lost ? "lost" : "playing",
    solvedRow: won ? rows.length - 1 : round.solvedRow,
    answer: won || lost ? answer : undefined,
  };
}

export function hintAvailable(rows: number, used: number): boolean {
  return used < 2 && rows >= (used + 1) * 2 + 1;
}
