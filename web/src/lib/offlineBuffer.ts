import type { Entry, Round } from "./api";

const KEY = "wordle.offline-buffer";

export type BufferedBoard = {
  id: string;
  mode: "classic" | "themed";
  wordLength: 5 | 6;
  answer: string;
  hints: [string, string];
  entry?: Entry;
  round: Round;
  queuedAt: string;
};

type BufferState = { boards: BufferedBoard[]; pending: BufferedBoard[] };

function read(): BufferState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (typeof value === "object" && value) {
      const state = value as Partial<BufferState>;
      return { boards: Array.isArray(state.boards) ? state.boards : [], pending: Array.isArray(state.pending) ? state.pending : [] };
    }
  } catch { /* A fresh buffer is safe when storage was cleared. */ }
  return { boards: [], pending: [] };
}

function write(state: BufferState) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { /* Storage can be full or disabled; online play remains available. */ }
}

export function storeBufferedBoards(boards: BufferedBoard[]) {
  const state = read();
  const ids = new Set(state.boards.map((board) => board.id));
  state.boards.push(...boards.filter((board) => !ids.has(board.id)));
  write(state);
}

export function takeBufferedBoard(mode: BufferedBoard["mode"], wordLength: BufferedBoard["wordLength"]): BufferedBoard | null {
  const state = read();
  const index = state.boards.findIndex((board) => board.mode === mode && board.wordLength === wordLength);
  if (index < 0) return null;
  const [board] = state.boards.splice(index, 1);
  write(state);
  return board;
}

export function queueCompletedBoard(board: BufferedBoard) {
  const state = read();
  state.pending = [...state.pending.filter((item) => item.id !== board.id), board];
  write(state);
}

export function pendingBoards() { return read().pending; }
