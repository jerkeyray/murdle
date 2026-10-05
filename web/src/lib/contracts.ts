/** Public API shapes shared by the web application. */
export type Mark = "absent" | "present" | "hit";
export type RoundState = "playing" | "won" | "lost";

export interface Row {
  guess: string;
  marks: Mark[];
}

/** What the round taught you. Present only once the round is over. */
export interface Entry {
  word: string;
  register: "standard" | "slang";
  definition: string;
  note: string;
  /** IPA, without slashes. Absent until the word has been enriched. */
  pronunciation?: string;
  partOfSpeech?: string;
  /** One-line source chain, e.g. "Anglo-Norman abatre, from Latin battere". The longer story stays in `note`. */
  origin?: string;
  example?: string;
  /** Link to the sentence an example came from, where its licence asks for one. */
  exampleSource?: string;
}

/** The theme reveal. Present only on a completed run. */
export interface Pack {
  id: string;
  connections: { word: string; explanation: string }[];
  title: string;
  blurb: string;
}

export interface Run {
  id: string;
  mode: "classic" | "themed";
  wordLength: 5 | 6;
  /** Words in the run. */
  length: number;
  started: number;
  currentRoundId?: string;
  completedWords: Round[];
  newCycle: boolean;
  finished: number;
  complete: boolean;
  points: number;
  /** Only ever present once the run is complete. */
  pack?: Pack;
}

export interface Round {
  id: string;
  state: RoundState;
  wordLength: number;
  maxRows: number;
  rows: Row[];
  hintsUsed: number;
  hints: { tier: number; text: string }[];
  /** Row index the board was solved on, or -1. */
  solvedRow: number;
  points: number;
  /** Only ever present once the round has finished. */
  answer?: string;
  /** Rides along with `answer`, for the same reason. */
  entry?: Entry;
}


/* --------------------------------------------------------------------------
   Profile, collection and friends. All require a signed-in player.
   -------------------------------------------------------------------------- */

export interface Profile {
  displayName: string;
  /** True until a nickname has been chosen. */
  needsName: boolean;
  seatColor: string;
  /** Short code a friend types to find you. */
  inviteCode: string;
  streak: { current: number; longest: number; playedToday: boolean };
  wordsLearned: number;
}

export interface HomeSummary {
  streak: { current: number; playedToday: boolean };
}

export interface SolveRecord {
  word: string;
  packId: string;
  solved: boolean;
  solvedRow: number | null;
  guesses: number;
  points: number;
  playedOn: string;
  entry?: Entry;
}
export interface CollectionPage { items: SolveRecord[]; total: number; nextCursor?: string }

export interface FriendRecord {
  id: string;
  displayName: string;
  status: "pending" | "accepted" | "blocked";
  /** True when they asked you, which is what decides accept versus waiting. */
  incoming: boolean;
  online: boolean;
  dayStreak: number;
}

export interface DuoDay {
  duoId: string;
  /** The rules, as the server holds them — never a second copy in the UI. */
  wordLength: number;
  maxRows: number;
  date: string;
  /** Which board of the day this is: 0 for the first, then one more for each "next word". */
  seq: number;
  /** How to address the board: the plain date for the first, "2026-10-05.1" for the next. */
  board: string;
  deadline: string;
  state: "playing" | "won" | "lost" | "expired" | "closed";
  currentPlayer: string;
  version: number;
  rows: (Row & { playerId: string })[];
  passed: string[];
  streak: number;
  answer?: string;
  entry?: Entry;
}
export interface Duo {
  id: string;
  friendshipId: string;
  inviterId: string;
  viewerId: string;
  members: { id: string; name: string }[];
  timezone: string;
  status: "pending" | "active" | "declined" | "cancelled" | "ended";
  version: number;
  today?: DuoDay;
  recent: DuoDay[];
}
export interface DuoMutation {
  requestId: string;
  version: number;
  guess?: string;
  friendshipId?: string;
  timezone?: string;
}
