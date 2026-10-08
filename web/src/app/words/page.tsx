"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getSavedStatus, getSavedWords, getSolves, setWordSaved, type SolveRecord } from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { Dialog } from "@/components/Dialog";
import { Loader } from "@/components/Loader";
import { WordExtras, WordMeta } from "@/components/WordFacts";

type Shelf = "all" | "saved";
const PAGE_SIZE = 24;
function cancelPageRequest(ref: {current:number}) { ref.current++; }

export default function WordsPage() {
  const [solves, setSolves] = useState<SolveRecord[]>([]);
  const [saved, setSaved] = useState<SolveRecord[]>([]);
  const [shelf, setShelf] = useState<Shelf>("all");
  const [query, setQuery] = useState("");
  const [length, setLength] = useState<"all" | "5" | "6">("all");
  const [total, setTotal] = useState(0);
  const [collectionTotal, setCollectionTotal] = useState(0);
  const [savedTotal, setSavedTotal] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>();
  const cursorRef = useRef<string | undefined>(undefined);
  const [moreLoading, setMoreLoading] = useState(false);
  const generation = useRef(0);
  const [selected, setSelected] = useState<SolveRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (append = false) => {
    const requestGeneration = append ? generation.current : ++generation.current;
    setLoading(!append); setMoreLoading(append); setError("");
    try {
      const fetchPage = shelf === "all" ? getSolves : getSavedWords;
      const page = await fetchPage({limit:PAGE_SIZE,cursor:append?cursorRef.current:undefined,q:query.trim(),length:length === "all" ? undefined : Number(length)});
      if(requestGeneration!==generation.current)return;
      const apply=(previous:SolveRecord[])=>append?[...previous,...page.items]:page.items;
      if(shelf === "all") setSolves(apply); else setSaved(apply);
      setTotal(page.total);if(shelf==="all")setCollectionTotal(page.total);else setSavedTotal(page.total);cursorRef.current=page.nextCursor;setCursor(page.nextCursor);setSignedOut(false);
    } catch (err) {
      if(requestGeneration!==generation.current)return;
      if (err instanceof ApiError && err.status === 401) setSignedOut(true);
      else setError("Your collection could not load.");
    } finally { if(requestGeneration===generation.current){setLoading(false);setMoreLoading(false);} }
  }, [shelf,query,length]);

  useEffect(() => {
    const timer = window.setTimeout(() => { cursorRef.current=undefined;setCursor(undefined); void load(false); }, query ? 200 : 0);
    return () => { window.clearTimeout(timer); cancelPageRequest(generation); };
  }, [load,query]);
  useEffect(() => {
    if (window.location.hash !== "#saved") return;
    const timer = window.setTimeout(() => setShelf("saved"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function chooseShelf(next: Shelf) { setShelf(next);setSolves([]);setSaved([]);setCursor(undefined); }
  function changeQuery(next: string) { setQuery(next);setCursor(undefined); }
  function chooseLength(next: "all" | "5" | "6") { setLength(next);setCursor(undefined); }

  return <main className="sheet words-page">
    <header className="sheet-head"><BackButton href="/profile" /><h1 className="sheet-title">Your library</h1></header>
    {loading ? <Loader label="Opening your library" /> : signedOut ? <section className="guest-profile">
      <span className="label">Your collection starts here</span><h2>Words worth keeping.</h2>
      <p>Sign in to keep every word you discover and build your own library.</p>
      <Link href="/sign-in?returnTo=%2Fwords" className="button button--link">Sign in</Link>
    </section> : error && solves.length === 0 ? <div className="empty"><p role="alert">{error}</p><button className="button" onClick={() => void load()}>Try again</button></div> : <>
      <section className="library-intro"><span className="label">Word bank</span><h2>Words you’ve met</h2><p>Search, save, and revisit the words that stayed with you.</p></section>
      <div className="library-tabs" role="group" aria-label="Library shelf">
        <button aria-pressed={shelf === "all"} onClick={() => chooseShelf("all")}>Collection <span>{collectionTotal}</span></button>
        <button aria-pressed={shelf === "saved"} onClick={() => chooseShelf("saved")}>Saved <span>{savedTotal}</span></button>
      </div>
      <div className="library-tools">
        <label className="sr-only" htmlFor="library-search">Search your library</label>
        <input id="library-search" className="input" type="search" placeholder="Search words" value={query} onChange={(event) => changeQuery(event.target.value)} />
        <div className="library-filter" role="group" aria-label="Word length">
          <button aria-pressed={length === "all"} onClick={() => chooseLength("all")}>All</button>
          <button aria-pressed={length === "5"} onClick={() => chooseLength("5")}>5</button>
          <button aria-pressed={length === "6"} onClick={() => chooseLength("6")}>6</button>
        </div>
      </div>
      {(shelf==="all"?solves:saved).length === 0 ? <div className="empty"><p>{query || length !== "all" ? "No words match those filters." : shelf === "saved" ? "Save a word to return to it here." : "Play a round to discover your first words."}</p>{(query || length !== "all") && <button className="text-button" onClick={() => { changeQuery(""); chooseLength("all"); }}>Clear filters</button>}</div> : <>
        <p className="library-count" role="status">Showing {(shelf==="all"?solves:saved).length} of {total}</p>
        <ul className="library-grid">{(shelf==="all"?solves:saved).map((word) => <li key={word.word}><button className="library-card" onClick={() => setSelected(word)}>
          <strong>{word.word}</strong><span>{word.entry?.definition ?? "A word from your completed board."}</span>
        </button></li>)}</ul>
        {cursor && <button className="button button--quiet library-more" disabled={moreLoading} onClick={() => void load(true)}>{moreLoading?"Loading…":"Load more words"}</button>}
      </>}
      {error && solves.length > 0 && <p className="form-error" role="alert">{error}</p>}
    </>}
    {selected && <SelectedWord key={selected.word} selected={selected} onClose={() => setSelected(null)} onSaved={async(value)=>{await setWordSaved(selected.word,value);if(value){setSavedTotal(n=>n+1);if(shelf==="saved")setSaved(items=>[selected,...items.filter(x=>x.word!==selected.word)]);}else{setSavedTotal(n=>Math.max(0,n-1));setSaved(items=>items.filter(x=>x.word!==selected.word));}}} />}
  </main>;
}

function SelectedWord({selected,onClose,onSaved}:{selected:SolveRecord;onClose:()=>void;onSaved:(saved:boolean)=>Promise<void>}){
 const [saved,setSaved]=useState(false);const [saving,setSaving]=useState(false);
 useEffect(()=>{let cancelled=false;getSavedStatus(selected.word).then(value=>{if(!cancelled)setSaved(value.saved);}).catch(()=>{});return()=>{cancelled=true;}},[selected.word]);
 async function toggle(){setSaving(true);try{await onSaved(!saved);setSaved(!saved);}finally{setSaving(false);}}
 return <Dialog title={selected.word} onClose={onClose}><article className="library-entry"><span className="label">{selected.word.length} letters</span><h2>{selected.word}</h2><WordMeta entry={selected.entry}/><p className="library-entry-definition">{selected.entry?.definition??"A word from your completed board."}</p><WordExtras entry={selected.entry}/><div><span className="label">Word story</span><p>{selected.entry?.note??"No word note is available yet."}</p></div><button className="library-save" onClick={()=>void toggle()} disabled={saving}>{saving?"Saving…":saved?"Remove from saved":"Save this word"}</button></article></Dialog>;
}
