/**
 * The guess being typed: letters in boxes, and a cursor saying which box is
 * next. A cursor equal to the word length means "past the end", with the last
 * box filled and nothing selected.
 *
 * Shared by the solo board and the shared board so both behave the same way.
 */

const pad = (draft: string[], length: number) => Array.from({ length }, (_, i) => draft[i] ?? "");

/** Types into the selected box and moves on. Null when the word is full. */
export function typeInto(draft: string[], cursor: number, letter: string, length: number): { draft: string[]; cursor: number } | null {
  if (cursor < 0 || cursor >= length) return null;
  const next = pad(draft, length);
  next[cursor] = letter.toLowerCase();
  return { draft: next, cursor: Math.min(cursor + 1, length) };
}

/**
 * Deletes a letter. If the selected box has one, that is the letter that goes
 * (and the cursor stays on it); otherwise it steps back and deletes the
 * previous box, which is what happens after typing a letter and changing your
 * mind. Null when there is nothing before the cursor.
 */
export function deleteLetter(draft: string[], cursor: number, length: number): { draft: string[]; cursor: number } | null {
  const next = pad(draft, length);
  const position = cursor < length && next[cursor] ? cursor : Math.min(cursor, length) - 1;
  if (position < 0) return null;
  next[position] = "";
  return { draft: next, cursor: position };
}
