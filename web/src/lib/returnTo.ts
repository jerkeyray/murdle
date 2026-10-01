// Decode through URLSearchParams first; reject external, ambiguous, and escaped paths.
export function safeReturnTo(value: string | null | undefined, fallback = "/profile"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\s\u0000-\u001f]/.test(value) || /%2f|%5c|%0/i.test(value)) return fallback;
  try {
    const url = new URL(value, "https://wordle.invalid");
    if (url.origin !== "https://wordle.invalid" || url.pathname === "/sign-in") return fallback;
    return url.pathname + url.search;
  } catch { return fallback; }
}
