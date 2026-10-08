"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createPlayInvitation, getCapabilities, getDuos, getFriends, getProfile, respondToFriend, respondToPlayInvitation, type Duo, type FriendRecord, type PlayInviteMutation, type Profile } from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { Dialog } from "@/components/Dialog";
import { useVisiblePolling } from "@/lib/useVisiblePolling";
import { Loader } from "@/components/Loader";
import { Presence } from "@/components/Presence";
import { FriendGameActions } from "@/components/FriendGameActions";

export default function FriendsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [duos, setDuos] = useState<Duo[]>([]);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; mutation: PlayInviteMutation } | null>(null);
  const initialized = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      if (!initialized.current) {
        const incomingCode = new URLSearchParams(window.location.search).get("code")?.slice(0, 6).toUpperCase() ?? "";
        setCode(incomingCode); setAdding(!!incomingCode); initialized.current = true;
      }
      const [capability, p] = await Promise.all([getCapabilities(signal), getProfile(signal)]);
      if (signal?.aborted) return;
      setAvailable(capability.sharedGames);
      if (p.needsName) { router.replace(`/profile?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
      const [f, d] = await Promise.all([getFriends(signal), capability.sharedGames ? getDuos(signal) : Promise.resolve([])]);
      if (signal?.aborted) return;
      setProfile(p); setFriends(f); setDuos(d); setReady(true);
    } catch (e) {
      if (signal?.aborted) return;
      setReady(true);
      if (e instanceof ApiError && e.status === 401) { setProfile(null); setFriends([]); setDuos([]); }
      else setError(e instanceof Error ? e.message : "Could not load friends");
      throw e;
    }
  }, [router]);
  useVisiblePolling(load, 30_000);

  async function connect(e: React.FormEvent) {
    e.preventDefault(); if (busy || !available) return;
    const key = `create:${code}`;
    if (pending.current?.key !== key) pending.current = { key, mutation: { requestId: crypto.randomUUID(), inviteCode: code, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } };
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await createPlayInvitation(pending.current.mutation);
      pending.current = null; setCode(""); setAdding(false);
      setNotice(result.duo?.status === "active" ? "You’re ready to play" : result.status === "accepted" ? "Game invitation sent" : "Add & play invitation sent");
      await load();
      if (result.duo?.status === "active") router.push(`/duos/${result.duo.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status > 0 && e.status < 500) pending.current = null;
      setError(e instanceof Error ? e.message : "Could not send invitation");
    } finally { setBusy(false); }
  }
  async function answer(f: FriendRecord, action: "accept" | "decline" | "cancel") {
    if (busy) return;
    const key = `${f.id}:${action}`;
    if (pending.current?.key !== key) pending.current = { key, mutation: { requestId: crypto.randomUUID() } };
    setBusy(true); setError(""); setNotice("");
    try {
      const result = f.playInvite ? await respondToPlayInvitation(f.id, action, pending.current.mutation) : (await respondToFriend(f.id, action === "accept"), undefined);
      pending.current = null;
      await load();
      if (result?.duo?.status === "active") router.push(`/duos/${result.duo.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status > 0 && e.status < 500) pending.current = null;
      setError(e instanceof Error ? e.message : "Could not update invitation");
    } finally { setBusy(false); }
  }
  async function share(copy = false) {
    if (!profile) return;
    const url = `${window.location.origin}/friends?code=${encodeURIComponent(profile.inviteCode)}`;
    try {
      if (!copy && navigator.share) await navigator.share({ title: "Play Wordle with me", url });
      else { await navigator.clipboard.writeText(url); setNotice("Invite link copied"); }
    } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) setError("Could not share. Use your friend code."); }
  }
  const accepted = friends.filter(f => f.status === "accepted").sort((a, b) => a.displayName.localeCompare(b.displayName));
  const requests = friends.filter(f => f.status === "pending").sort((a, b) => Number(b.incoming) - Number(a.incoming) || a.displayName.localeCompare(b.displayName));
  const gameInvites = duos.filter(d => d.status === "pending" && accepted.some(f => f.id === d.friendshipId));
  // One row per friend, the ones waiting on you first, so a friend with a game
  // is never listed twice.
  const gameOf = (f: FriendRecord) => duos.find(d => d.friendshipId === f.id && (d.status === "active" || d.status === "pending"));
  const rank = (d?: Duo) => d?.status !== "active" || !d.today ? 3 : d.today.state !== "playing" ? 2 : d.today.currentPlayer === d.viewerId ? 0 : 1;
  const ordered = [...accepted].sort((a, b) => rank(gameOf(a)) - rank(gameOf(b)) || a.displayName.localeCompare(b.displayName));
  const statusLine = (f: FriendRecord, d?: Duo) => {
    const day = d?.status === "active" ? d.today : undefined;
    const game = !day ? (f.online ? "Online" : "") : day.state === "won" ? "Solved today" : day.state !== "playing" ? "Missed today" : day.currentPlayer === d!.viewerId ? `Your turn · ${day.rows.length} of 6` : `${f.displayName}’s turn`;
    const streak = f.sharedStreak ? `${f.sharedStreak}-day streak` : "";
    return [game, streak].filter(Boolean).join(" · ");
  };
  return <main className="sheet friends-page social-hub">
    <Presence enabled={available && !!profile} />
    <header className="sheet-head"><BackButton href="/" /><h1 className="sheet-title">Friends</h1>{profile && <button className="social-add" disabled={!available} onClick={() => { setAdding(true); setError(""); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>Add & play</button>}</header>
    {!ready ? <Loader /> : !profile ? <div className="gate-middle friends-gate"><div className="gate-card">
      {error ? <><h2 className="gate-title">Can’t reach friends</h2><p className="gate-line">Check your connection and try again.</p><button className="button" onClick={() => { setError(""); setReady(false); void load().catch(() => {}); }}>Try again</button></> : <><h2 className="gate-title">Play with friends.</h2><p className="gate-line">Share a daily board with a friend and take turns guessing.</p><Link className="button button--link" href={`/sign-in?returnTo=${encodeURIComponent(`/friends${code ? `?code=${code}` : ""}`)}`}>Sign in</Link></>}
    </div>{!error && <Link href="/" className="gate-foot">Play without an account</Link>}</div> : <>
      {!available && <p className="hint">Shared games are unavailable on this server.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="hint" role="status">{notice}</p>}
      {(requests.length > 0 || gameInvites.length > 0) && <section aria-label="Invitations"><div className="friends-list-heading"><h2>Invitations</h2></div><ul className="social-list">
        {requests.map(f => <li className="social-row" key={f.id}><div className="friend-info"><strong>{f.displayName}</strong><span>{f.incoming ? f.playInvite ? "Wants to add & play" : "Friend request" : "Waiting for acceptance"}</span></div><div className="social-actions">
          {f.incoming ? <><button className="text-button" disabled={busy || (f.playInvite && !available)} onClick={() => void answer(f, "accept")}>{f.playInvite ? "Accept & play" : "Accept friend"}</button><button className="text-button" disabled={busy || (f.playInvite && !available)} onClick={() => void answer(f, "decline")}>Decline</button></> : f.playInvite && <button className="text-button" disabled={busy || !available} onClick={() => void answer(f, "cancel")}>Cancel</button>}
        </div></li>)}
        {gameInvites.map(d => <li className="social-row" key={d.id}><div className="friend-info"><strong>{accepted.find(f => f.id === d.friendshipId)?.displayName}</strong><span>{d.inviterId === d.viewerId ? "Daily game invitation sent" : "Invited you to a daily game"}</span></div><FriendGameActions friendshipId={d.friendshipId} duo={d} available={available} onChange={load} /></li>)}
      </ul></section>}
      {accepted.length > 0 && <section aria-label="Your friends"><div className="friends-list-heading"><h2>Your friends</h2><span>{accepted.length}</span></div><ul className="social-list">{ordered.map(f => {
        const d = gameOf(f);
        const turn = d?.status === "active" && d.today?.state === "playing" && d.today.currentPlayer === d.viewerId;
        return <li className="social-row" key={f.id}><Link className="social-identity" href={`/friends/${f.id}`}><span className="friend-avatar" aria-hidden="true">{f.displayName.slice(0, 1).toUpperCase() || "?"}<i data-online={f.online} /></span><span className="friend-info"><strong>{f.displayName}</strong>{statusLine(f, d) && <span data-turn={turn}>{statusLine(f, d)}</span>}</span></Link>{d?.status === "pending" ? <Link className="text-button" href={`/friends/${f.id}`}>View invite</Link> : <FriendGameActions friendshipId={f.id} duo={d} available={available} onChange={load} />}</li>;
      })}</ul></section>}
      {friends.length === 0 && <section className="friends-empty"><h2>A word, shared.</h2><p>Six guesses. Two minds.<br />Invite your first friend to get started.</p><button className="button button--quiet" disabled={!available} onClick={() => setAdding(true)}>Add & play</button></section>}
      {adding && <Dialog title="Add & play" className="friend-dialog" onClose={() => setAdding(false)}><section className="friend-invite">
        <p className="friend-invite-lede">Share your code. When they accept, you’re friends and a daily board is ready.</p>
        <div className="invite-card"><span className="label">Your invite code</span><strong aria-label={`Your invite code, ${profile.inviteCode.split("").join(" ")}`}>{profile.inviteCode}</strong>
          <div className="invite-card-actions"><button className="button button--quiet" disabled={!available} onClick={() => void share(true)}>Copy link</button><button className="button" disabled={!available} onClick={() => void share()}>Share</button></div>
        </div>
        <div className="invite-or" aria-hidden="true"><span>or</span></div>
        <form className="code-form" onSubmit={connect}><label htmlFor="friend-code">Got a friend’s code?</label><div className="friend-code-entry"><input id="friend-code" className="input" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={6} autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="Enter code" /><button className="button button--inline" disabled={busy || !available || code.length !== 6}>{busy ? "Sending…" : "Add & play"}</button></div></form>
      </section>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="hint" role="status">{notice}</p>}</Dialog>}
    </>}
  </main>;
}
