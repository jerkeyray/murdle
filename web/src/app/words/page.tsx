"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getSavedWords, getSolves, setWordSaved, type SolveRecord } from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { Dialog } from "@/components/Dialog";
import { Loader } from "@/components/Loader";

type Shelf = "all" | "saved";
const PAGE_SIZE = 12;

export default function WordsPage() {
  const [solves, setSolves] = useState<SolveRecord[]>([]);
  const [saved, setSaved] = useState<SolveRecord[]>([]);
  const [shelf, setShelf] = useState<Shelf>("all");
  const [query, setQuery] = useState("");
  const [length, setLength] = useState<"all" | "5" | "6">("all");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<SolveRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [all, kept] = await Promise.all([getSolves(), getSavedWords()]);
      setSolves(all); setSaved(kept); setSignedOut(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setSignedOut(true);
      else setError("Your collection could not load.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (window.location.hash !== "#saved") return;
    const timer = window.setTimeout(() => setShelf("saved"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function chooseShelf(next: Shelf) { setShelf(next); setVisible(PAGE_SIZE); }
  function changeQuery(next: string) { setQuery(next); setVisible(PAGE_SIZE); }
  function chooseLength(next: "all" | "5" | "6") { setLength(next); setVisible(PAGE_SIZE); }

  const source = shelf === "all" ? solves : saved;
  const words = useMemo(() => source.filter((word) => {
    const text = [word.word, word.entry?.definition, word.entry?.note].join(" ").toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (length === "all" || word.word.length === Number(length));
  }), [source, query, length]);
  const shown = words.slice(0, visible);
  const savedWords = new Set(saved.map((word) => word.word));
  const isSaved = selected ? savedWords.has(selected.word) : false;

  async function toggleSaved() {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await setWordSaved(selected.word, !isSaved);
      setSaved((current) => isSaved ? current.filter((word) => word.word !== selected.word) : [selected, ...current]);
    } catch { setError("Could not update your saved words."); }
    finally { setSaving(false); }
  }

  return <main className="sheet words-page">
    <header className="sheet-head"><BackButton href="/profile" /><h1 className="sheet-title">Your library</h1></header>
    {loading ? <Loader label="Opening your library" /> : signedOut ? <section className="guest-profile">
      <span className="label">Your collection starts here</span><h2>Words worth keeping.</h2>
      <p>Sign in to keep every word you discover and build your own library.</p>
      <Link href="/sign-in?returnTo=%2Fwords" className="button button--link">Sign in</Link>
    </section> : error && solves.length === 0 ? <div className="empty"><p role="alert">{error}</p><button className="button" onClick={() => void load()}>Try again</button></div> : <>
      <section className="library-intro"><span className="label">Word bank</span><h2>Words you’ve met</h2><p>Search, save, and revisit the words that stayed with you.</p></section>
      <div className="library-tabs" role="group" aria-label="Library shelf">
        <button aria-pressed={shelf === "all"} onClick={() => chooseShelf("all")}>Collection <span>{solves.length}</span></button>
        <button aria-pressed={shelf === "saved"} onClick={() => chooseShelf("saved")}>Saved <span>{saved.length}</span></button>
      </div>
      <div className="library-tools">
        <label className="sr-only" htmlFor="library-search">Search your library</label>
        <input id="library-search" className="input" type="search" placeholder="Search words or meanings" value={query} onChange={(event) => changeQuery(event.target.value)} />
        <div className="library-filter" role="group" aria-label="Word length">
          <button aria-pressed={length === "all"} onClick={() => chooseLength("all")}>All</button>
          <button aria-pressed={length === "5"} onClick={() => chooseLength("5")}>5</button>
          <button aria-pressed={length === "6"} onClick={() => chooseLength("6")}>6</button>
        </div>
      </div>
      {words.length === 0 ? <div className="empty"><p>{query || length !== "all" ? "No words match those filters." : shelf === "saved" ? "Save a word to return to it here." : "Play a round to discover your first words."}</p>{(query || length !== "all") && <button className="text-button" onClick={() => { changeQuery(""); chooseLength("all"); }}>Clear filters</button>}</div> : <>
        <p className="library-count" role="status">Showing {shown.length} of {words.length}</p>
        <ul className="library-grid">{shown.map((word) => <li key={word.word}><button className="library-card" onClick={() => setSelected(word)}>
          <span className="library-card-top"><span>{word.word.length} letters</span>{savedWords.has(word.word) && <b aria-label="Saved">⌑</b>}</span>
          <strong>{word.word}</strong><span>{word.entry?.definition ?? "A word from your completed board."}</span>
        </button></li>)}</ul>
        {visible < words.length && <button className="button button--quiet library-more" onClick={() => setVisible((count) => count + PAGE_SIZE)}>Load more words</button>}
      </>}
      {error && solves.length > 0 && <p className="form-error" role="alert">{error}</p>}
    </>}
    {selected && <Dialog title={selected.word} onClose={() => setSelected(null)}>
      <article className="library-entry"><span className="label">{selected.word.length} letters</span><h2>{selected.word}</h2><p className="library-entry-definition">{selected.entry?.definition ?? "A word from your completed board."}</p>
        <div><span className="label">Word story</span><p>{selected.entry?.note ?? "No word note is available yet."}</p></div>
        <button className="library-save" onClick={() => void toggleSaved()} disabled={saving}>{saving ? "Saving…" : isSaved ? "Remove from saved" : "Save this word"}</button>
      </article>
    </Dialog>}
  </main>;
}
