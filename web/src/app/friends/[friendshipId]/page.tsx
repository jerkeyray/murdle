"use client";

import Link from "next/link";
import { use, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getCapabilities, getFriendProfile, getProfile, type FriendProfile } from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { FriendGameActions } from "@/components/FriendGameActions";
import { Loader } from "@/components/Loader";
import { Presence } from "@/components/Presence";
import { useVisiblePolling } from "@/lib/useVisiblePolling";
import { duoStatus } from "@/lib/duoStatus";

export default function FriendPage({ params }: { params: Promise<{ friendshipId: string }> }) {
  const { friendshipId } = use(params);
  const router = useRouter();
  const [friend, setFriend] = useState<FriendProfile | null>(null);
  const [available, setAvailable] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [capability, own] = await Promise.all([getCapabilities(signal), getProfile(signal)]);
      if (signal?.aborted) return;
      if (own.needsName) { router.replace(`/profile?returnTo=${encodeURIComponent(`/friends/${friendshipId}`)}`); return; }
      const f = await getFriendProfile(friendshipId, signal);
      if (signal?.aborted) return;
      setFriend(f); setAvailable(capability.sharedGames); setReady(true); setError(""); setSignedOut(false);
    } catch (e) {
      if (signal?.aborted) return;
      setReady(true);
      if (e instanceof ApiError && (e.status === 401 || e.status === 404)) setFriend(null);
      setSignedOut(e instanceof ApiError && e.status === 401);
      setError(e instanceof ApiError && e.status === 404 ? "Friend not found" : e instanceof Error ? e.message : "Could not load your friend");
      throw e;
    }
  }, [friendshipId, router]);
  useVisiblePolling(load, 30_000);
  return <main className="sheet friends-page social-profile">
    <Presence enabled={available && !!friend} />
    <header className="sheet-head"><BackButton href="/friends" /><h1 className="sheet-title">Friend</h1></header>
    {!ready ? <Loader /> : !friend ? <div className="gate-middle"><div className="gate-card">
      <h2 className="gate-title">{signedOut ? "Play with friends." : error}</h2>
      {signedOut ? <Link className="button button--link" href={`/sign-in?returnTo=${encodeURIComponent(`/friends/${friendshipId}`)}`}>Sign in</Link> : <button className="text-button" onClick={() => void load().catch(() => {})}>Try again</button>}
      <Link className="text-button" href="/friends">Back to friends</Link>
    </div></div> : <>
      <div className="friend-detail-identity"><span className="friend-avatar" aria-hidden="true">{friend.displayName.slice(0, 1).toUpperCase() || "?"}<i data-online={friend.online} /></span><div><h2>{friend.displayName}</h2><p>{friend.online ? "Online" : "Offline"} · Joined {new Date(friend.joinedAt).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" })}</p></div></div>
      <dl className="social-stats" aria-label="Personal stats"><div><dt>Playing streak</dt><dd>{friend.streak.current} days</dd></div><div><dt>Best playing streak</dt><dd>{friend.streak.longest} days</dd></div><div><dt>Words solved</dt><dd>{friend.wordsSolved}</dd></div></dl>
      <section aria-label="Together"><div className="friends-list-heading"><h2>Together</h2></div><dl className="social-stats"><div><dt>Shared streak</dt><dd>{friend.together.current} days</dd></div><div><dt>Best shared streak</dt><dd>{friend.together.longest} days</dd></div><div><dt>Words solved together</dt><dd>{friend.together.wordsSolved}</dd></div></dl>
        <p className="hint">A shared streak counts consecutive days with a word solved together.</p>
        <div className="social-game-detail"><p className="hint">{friend.duo?.status === "active" || friend.duo?.status === "pending" ? duoStatus(friend.duo) : "Share a board each day and take turns guessing."}</p><FriendGameActions friendshipId={friend.id} duo={friend.duo} available={available} onChange={load} allowEnd /></div>
        {!available && <p className="hint">Shared games are unavailable on this server.</p>}
      </section>
      {!!friend.duo?.recent.length && <section aria-label="Recent shared results"><div className="friends-list-heading"><h2>Recent words</h2></div><ul className="duo-recent">{friend.duo.recent.map(day => <li key={`${day.duoId}:${day.board}`}><Link href={`/duos/${day.duoId}?date=${day.board}`}>{day.date}{day.seq > 0 ? ` · game ${day.seq + 1}` : ""}</Link><strong>{day.answer}</strong><span>{day.state === "won" ? `${day.rows.length}/6` : "Missed"}</span></li>)}</ul></section>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </>}
  </main>;
}
