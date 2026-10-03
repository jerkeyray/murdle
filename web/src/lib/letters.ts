const NAMES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/**
 * Spells a word length for prose. The server sends the length with every round
 * and every shared board, so the one thing a message must not do is carry its
 * own copy of the number.
 */
export const lettersPhrase = (length: number) => `${NAMES[length] ?? length} letters`;
