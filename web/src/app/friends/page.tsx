"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addFriend, ApiError, getCapabilities, getDuos, getFriends, getProfile, inviteDuo, mutateDuo, respondToFriend, type Duo, type DuoMutation, type FriendRecord, type Profile } from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { Dialog } from "@/components/Dialog";
import { useVisiblePolling } from "@/lib/useVisiblePolling";
import { duoStatus } from "@/lib/duoStatus";

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

  const load = useCallback(async () => {
    try {
      const capability = await getCapabilities();
      if (!initialized.current) { setCode(new URLSearchParams(window.location.search).get("code")?.slice(0, 6).toUpperCase() ?? ""); initialized.current = true; }
      setAvailable(capability.sharedGames);
      const p = await getProfile();
      if (p.needsName) { router.replace(`/profile?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
      const [f, d] = await Promise.all([getFriends(), capability.sharedGames ? getDuos() : Promise.resolve([])]);
      setProfile(p); setFriends(f); setDuos(d); setReady(true);
    } catch (e) {
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
    <header className="sheet-head"><BackButton href="/" /><h1 className="sheet-title">Friends</h1></header>
    {!ready ? <p role="status">Loading…</p> : !profile ? <>
      <p className="empty">Sign in to play with friends.</p>
      <Link className="button button--link" href={`/sign-in?returnTo=${encodeURIComponent(`/friends${code ? `?code=${code}` : ""}`)}`}>Sign in</Link>
      {error && <p role="alert">{error}</p>}
    </> : <>
      <section className="friend-invite">
        <div><span className="label">Your friend code</span><strong>{profile.inviteCode}</strong></div>
        <div className="friend-invite-actions"><button className="text-button" onClick={() => void share(true)}>Copy link</button><button className="text-button" onClick={() => void share()}>Share</button></div>
      </section>
      <form className="code-form" onSubmit={connect}><input className="input" aria-label="Friend code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="Friend code" /><button className="button button--inline" disabled={busy || !code.trim()}>Add friend</button></form>
      {!available && <p className="hint">Shared games are unavailable on this server.</p>}
      {error && <p className="form-error" role="alert">{error} <button className="text-button" onClick={() => void load().catch(() => {})}>Retry</button></p>}
      {notice && <p className="hint" role="status">{notice}</p>}
      {sorted.length === 0 ? <p className="empty">Invite a friend to get started.</p> : <ul className="friend-list">{sorted.map(f => {
        const d = duos.find(d => d.friendshipId === f.id);
        const status = f.status === "pending" ? f.incoming ? "Friend request" : "Request sent" : duoStatus(d);
        return <li key={f.id}><button className="friend-tile" onClick={() => { setSelected(f.id); setError(""); setEnding(false); }}>
          <span className="friend-avatar" aria-hidden>{f.displayName.slice(0, 1).toUpperCase() || "?"}<i data-online={f.online} /></span>
          <span className="friend-info"><strong>{f.displayName || "Friend"}</strong><span>{f.status === "accepted" ? f.online ? "Online" : "Offline" : "Pending"}</span></span>
          <span className="friend-game-status" data-turn={status === "Your turn"}>{status}<span aria-hidden> ↗</span></span>
        </button></li>;
      })}</ul>}
      {friend && <Dialog title={friend.displayName || "Friend"} onClose={() => { setSelected(null); setEnding(false); }}>
        {friend.status === "accepted" ? <>
          <div className="friend-detail-identity"><span className="friend-avatar" aria-hidden>{friend.displayName.slice(0, 1).toUpperCase()}<i data-online={friend.online} /></span><div><h2>{friend.displayName}</h2><p>{friend.online ? "Online" : "Offline"} · {friend.dayStreak} day streak</p></div></div>
          {duo?.status === "active" ? <>
            <section className="friend-shared-game"><span className="label">Your daily game</span><h3>{duoStatus(duo)}</h3><p>{duo.today?.streak ?? 0} {duo.today?.streak === 1 ? "day" : "days"} together</p><Link href={`/duos/${duo.id}`} className="button button--link">Open board</Link></section>
            {ending ? <div className="end-duo"><p>End this daily game? Your friendship and past results stay.</p><button className="button button--quiet" disabled={busy} onClick={() => void act("end")}>End daily game</button><button className="text-button" onClick={() => setEnding(false)}>Keep playing</button></div> : <button className="text-button" onClick={() => setEnding(true)}>End daily game</button>}
          </> : duo?.status === "pending" ? <div className="friend-shared-game"><h3>{duoStatus(duo)}</h3>{duo.inviterId === duo.viewerId ? <button className="button button--quiet" disabled={busy} onClick={() => void act("cancel")}>Cancel invitation</button> : <div className="entry-actions"><button className="button" disabled={busy} onClick={() => void act("accept")}>Accept daily game</button><button className="text-button" disabled={busy} onClick={() => void act("decline")}>Decline</button></div>}</div>
            : <button className="button" disabled={busy || !available} onClick={() => void act("invite")}>Play together</button>}
          {!!duo?.recent.length && <ul className="duo-recent" aria-label="Recent pair results">{duo.recent.map(day => <li key={`${day.duoId}:${day.date}`}><Link href={`/duos/${day.duoId}?date=${day.date}`}>{day.date}</Link><strong>{day.answer}</strong><span>{day.state === "won" ? `${day.rows.length}/6` : "Missed"}</span></li>)}</ul>}
        </> : friend.incoming ? <div className="entry-actions">{[true, false].map(accept => <button className="button button--quiet" key={String(accept)} disabled={busy} onClick={async () => { setBusy(true); try { await respondToFriend(friend.id, accept); await load(); setSelected(null); } catch (e) { setError(e instanceof Error ? e.message : "Could not respond"); } finally { setBusy(false); } }}>{accept ? "Accept friend" : "Decline"}</button>)}</div> : <p className="hint">Friend request sent.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </Dialog>}
    </>}
  </main>;
}
