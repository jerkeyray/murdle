import type { Entry } from "@/lib/api";
import { respell } from "@/lib/respell";

/**
 * "uh-BAYT · verb", under the word. The pronunciation is shown respelled,
 * with the IPA it came from on hover. Renders nothing for an unenriched entry.
 */
export function WordMeta({ entry }: { entry?: Pick<Entry, "pronunciation" | "partOfSpeech"> | null }) {
  const sounds = respell(entry?.pronunciation);
  if (!sounds && !entry?.partOfSpeech) return null;
  return <p className="word-meta">
    {sounds && <span className="word-pronunciation" title={`/${entry?.pronunciation}/`} aria-label={`Pronounced ${sounds}`}>{sounds}</span>}
    {entry?.partOfSpeech && <span className="word-pos">{entry.partOfSpeech}</span>}
  </p>;
}

/** The example sentence and the origin line, after the definition. */
export function WordExtras({ entry }: { entry?: Pick<Entry, "example" | "origin"> | null }) {
  if (!entry?.example && !entry?.origin) return null;
  return <div className="word-extras">
    {entry.example && <p className="word-example">“{entry.example}”</p>}
    {entry.origin && <p className="word-origin"><span className="label">Origin</span> {entry.origin}</p>}
  </div>;
}
