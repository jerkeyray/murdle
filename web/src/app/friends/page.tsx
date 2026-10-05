"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addFriend, ApiError, getCapabilities, getDuos, getFriends, getProfile, inviteDuo, mutateDuo, respondToFriend, type Duo, type DuoMutation, type FriendRecord, type Profile } from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { Dialog } from "@/components/Dialog";
import { useVisiblePolling } from "@/lib/useVisiblePolling";
import { duoStatus } from "@/lib/duoStatus";
import { Loader } from "@/components/Loader";
import { Presence } from "@/components/Presence";

function FriendIcon({ kind }: { kind: "copy" | "share" | "people" | "arrow" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "copy" ? <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></> : kind === "share" ? <><path d="M12 16V3m-4 4 4-4 4 4M5 13v7h14v-7" /></> : kind === "arrow" ? <path d="m9 5 7 7-7 7" /> : <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m2 9v-2a6 6 0 0 0-2-4" /></>}
  </svg>;
}

export default function FriendsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [duos, setDuos] = useState<Duo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const pending = useRef<{ key: string; mutation: DuoMutation } | null>(null);
  const initialized = useRef(false);

  const load = useCallback(async (signal?:AbortSignal) => {
    try {
      const capability = await getCapabilities(signal);
      if (!initialized.current) { setCode(new URLSearchParams(window.location.search).get("code")?.slice(0, 6).toUpperCase() ?? ""); initialized.current = true; }
      setAvailable(capability.sharedGames);
      const p = await getProfile(signal);
      if (p.needsName) { router.replace(`/profile?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
      const [f, d] = await Promise.all([getFriends(signal), capability.sharedGames ? getDuos(signal) : Promise.resolve([])]);
      setProfile(p); setFriends(f); setDuos(d); setReady(true);
    } catch (e) {
      if(signal?.aborted)return;
      setReady(true);
      if (e instanceof ApiError && e.status === 401) { setProfile(null); setFriends([]); setDuos([]); setSelected(null); }
      if (!(e instanceof ApiError && e.status === 401)) setError(e instanceof Error ? e.message : "Could not load friends");
      throw e;
    }
  }, [router]);
  useVisiblePolling(load, 30_000);
  const friend = friends.find(f => f.id === selected);
  const duo = duos.find(d => d.friendshipId === selected);
  const sorted = [...friends].sort((a, b) => {
    const rank = (f: FriendRecord) => { const d = duos.find(d => d.friendshipId === f.id); return duoStatus(d) === "Your turn" ? 0 : d?.status === "active" || d?.status === "pending" ? 1 : 2; };
    return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName);
  });
  async function act(action: "invite" | "accept" | "decline" | "cancel" | "end") {
    if (!friend || busy) return;
    const key = `${friend.id}:${duo?.id ?? ""}:${action}`;
    if (pending.current?.key !== key) pending.current = { key, mutation: { requestId: crypto.randomUUID(), version: action === "invite" ? 0 : duo?.version ?? 0, friendshipId: friend.id, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } };
    setBusy(true); setError("");
    try {
      const d = action === "invite" ? await inviteDuo(pending.current.mutation) : await mutateDuo(duo!.id, action, pending.current.mutation);
      pending.current = null;
      await load(); setEnding(false);
      if (d.status === "active" && (action === "accept" || action === "invite")) router.push(`/duos/${d.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0 && e.status < 500) pending.current = null;
      setError(e instanceof Error ? e.message : "Could not update the invitation");
      if (e instanceof ApiError && e.current) { const current = e.current; setDuos(ds => [...ds.filter(x => x.id !== current.id), current]); }
    } finally { setBusy(false); }
  }
  async function connect(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try { await addFriend(code); setCode(""); setNotice("Friend request sent"); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not add friend"); }
    finally { setBusy(false); }
  }
  async function share(copy = false) {
    if (!profile) return;
    const url = `${window.location.origin}/friends?code=${encodeURIComponent(profile.inviteCode)}`;
    try {
      if (!copy && navigator.share) await navigator.share({ title: "Play Wordle with me", url });
      else { await navigator.clipboard.writeText(url); setNotice("Invite link copied"); }
    } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) setError("Could not share. Use your friend code below."); }
  }

  return <main className="sheet friends-page">
    <Presence />
    <header className="sheet-head"><BackButton href="/" /><h1 className="sheet-title">Friends</h1></header>
    {!ready ? <Loader /> : !profile ? <div className="gate-middle friends-gate">
      {error ? <div className="gate-card">
        <h2 className="gate-title">Can’t reach friends</h2>
        <p className="gate-line">Check your connection and try again.</p>
        <button className="button" onClick={() => { setError(""); setReady(false); void load().catch(() => {}); }}>Try again</button>
      </div> : <div className="gate-card">
        <h2 className="gate-title">Play with friends.</h2>
        <p className="gate-line">Share a daily board with a friend and take turns guessing.</p>
        <Link className="button button--link" href={`/sign-in?returnTo=${encodeURIComponent(`/friends${code ? `?code=${code}` : ""}`)}`}>Sign in</Link>
      </div>}
      {!error && <Link href="/" className="gate-foot">Play without an account</Link>}
    </div> : <>
      <section className="friend-invite" aria-label="Invite a friend">
        <div className="friend-invite-top">
          <div><span className="label">Your invite code</span><strong>{profile.inviteCode}</strong></div>
          <div className="friend-invite-actions">
            <button className="friend-icon-button" aria-label="Copy invite link" title="Copy invite link" onClick={() => void share(true)}><FriendIcon kind="copy" /></button>
            <button className="friend-icon-button" aria-label="Share invite link" title="Share invite link" onClick={() => void share()}><FriendIcon kind="share" /></button>
          </div>
        </div>
        <p className="friend-invite-caption">Share your code to play the daily word together.</p>
        <form className="code-form" onSubmit={connect}>
          <label htmlFor="friend-code">Have a friend’s code?</label>
          <div className="friend-code-entry"><input id="friend-code" className="input" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={6} autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="Enter code" /><button className="button button--inline" disabled={busy || code.trim().length !== 6}>{busy ? "Adding…" : "Add"}</button></div>
        </form>
      </section>
      {!available && <p className="hint">Shared games are unavailable on this server.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="hint" role="status">{notice}</p>}
      {sorted.length === 0 ? <section className="friends-empty">
        <div className="friends-empty-icon"><FriendIcon kind="people" /></div>
        <h2>A word, shared.</h2><p>Six guesses. Two minds.<br />Invite your first friend to get started.</p>
        <button className="button button--quiet" onClick={() => void share()}><FriendIcon kind="share" />Invite a friend</button>
      </section> : <><div className="friends-list-heading"><h2>Your friends</h2><span>{sorted.length}</span></div><ul className="friend-list">{sorted.map(f => {
        const d = duos.find(d => d.friendshipId === f.id);
        const status = f.status === "pending" ? f.incoming ? "Friend request" : "Request sent" : duoStatus(d);
        const tile = <>
          <span className="friend-avatar" aria-hidden>{f.displayName.slice(0, 1).toUpperCase() || "?"}<i data-online={f.online} /></span>
          <span className="friend-info"><strong>{f.displayName || "Friend"}</strong><span>{f.status === "accepted" ? f.online ? "Online" : "Offline" : "Pending"}</span></span>
          <span className="friend-game-status" data-turn={status === "Your turn"}>{d?.status === "active" ? `Open board · ${status}` : status}</span><span className="friend-chevron"><FriendIcon kind="arrow" /></span>
        </>;
        return <li key={f.id}>{d?.status === "active" ? <Link className="friend-tile" href={`/duos/${d.id}`}>{tile}</Link> : <button className="friend-tile" onClick={() => { setSelected(f.id); setError(""); setEnding(false); }}>{tile}</button>}</li>;
      })}</ul></>}
      {friend && <Dialog title={friend.displayName || "Friend"} onClose={() => { setSelected(null); setEnding(false); }}>
        {friend.status === "accepted" ? <>
          <div className="friend-detail-identity"><span className="friend-avatar" aria-hidden>{friend.displayName.slice(0, 1).toUpperCase()}<i data-online={friend.online} /></span><div><h2>{friend.displayName}</h2><p>{friend.online ? "Online" : "Offline"} · {friend.dayStreak} day streak</p></div></div>
          {duo?.status === "active" ? <>
            <section className="friend-shared-game"><span className="label">Your daily game</span><h3>{duoStatus(duo)}</h3><p>{duo.today?.streak ?? 0} {duo.today?.streak === 1 ? "day" : "days"} together</p><Link href={`/duos/${duo.id}`} className="button button--link">Open board</Link></section>
            {ending ? <div className="end-duo"><p>End this daily game? Your friendship and past results stay.</p><button className="button button--quiet" disabled={busy} onClick={() => void act("end")}>End daily game</button><button className="text-button" onClick={() => setEnding(false)}>Keep playing</button></div> : <button className="text-button" onClick={() => setEnding(true)}>End daily game</button>}
          </> : duo?.status === "pending" ? <div className="friend-shared-game"><h3>{duoStatus(duo)}</h3>{duo.inviterId === duo.viewerId ? <button className="button button--quiet" disabled={busy} onClick={() => void act("cancel")}>Cancel invitation</button> : <div className="entry-actions"><button className="button" disabled={busy} onClick={() => void act("accept")}>Accept daily game</button><button className="text-button" disabled={busy} onClick={() => void act("decline")}>Decline</button></div>}</div>
            : <button className="button" disabled={busy || !available} onClick={() => void act("invite")}>Play together</button>}
          {!!duo?.recent.length && <ul className="duo-recent" aria-label="Recent pair results">{duo.recent.map(day => <li key={`${day.duoId}:${day.board}`}><Link href={`/duos/${day.duoId}?date=${day.board}`}>{day.seq ? `${day.date} · game ${day.seq + 1}` : day.date}</Link><strong>{day.answer}</strong><span>{day.state === "won" ? `${day.rows.length}/6` : "Missed"}</span></li>)}</ul>}
        </> : friend.incoming ? <div className="entry-actions">{[true, false].map(accept => <button className="button button--quiet" key={String(accept)} disabled={busy} onClick={async () => { setBusy(true); try { await respondToFriend(friend.id, accept); await load(); setSelected(null); } catch (e) { setError(e instanceof Error ? e.message : "Could not respond"); } finally { setBusy(false); } }}>{accept ? "Accept friend" : "Decline"}</button>)}</div> : <p className="hint">Friend request sent.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </Dialog>}
    </>}
  </main>;
}
