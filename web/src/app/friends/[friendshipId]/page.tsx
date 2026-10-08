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

// One sentence about today's game, in place of a status label.
function gameLine(friend: FriendProfile): string {
  const d = friend.duo;
  if (d?.status === "pending") return d.inviterId === d.viewerId ? `Waiting for ${friend.displayName} to accept.` : `${friend.displayName} invited you to play.`;
  const day = d?.status === "active" ? d.today : undefined;
  if (!day) return "Share a board each day and take turns guessing.";
  if (day.state === "won") return "You solved today’s word together.";
  if (day.state !== "playing") return "Today’s word got away.";
  return day.currentPlayer === d!.viewerId ? `Your turn · ${day.rows.length} of 6 guesses.` : `${friend.displayName}’s turn · ${day.rows.length} of 6 guesses.`;
}

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
      <div className="friend-detail-identity"><span className="friend-avatar" aria-hidden="true">{friend.displayName.slice(0, 1).toUpperCase() || "?"}<i data-online={friend.online} /></span><div><h2>{friend.displayName}</h2><p>{friend.online ? "Online" : "Offline"}</p></div></div>
      <section className="friend-game" aria-label="Today"><p>{gameLine(friend)}</p><FriendGameActions friendshipId={friend.id} duo={friend.duo} available={available} onChange={load} allowEnd /></section>
      {!available && <p className="hint">Shared games are unavailable on this server.</p>}
      <div className="friend-together-head"><span className="label">Together</span></div>
      <dl className="friend-together" aria-label="Together"><div><dt>day streak</dt><dd>{friend.together.current}</dd></div><div><dt>best streak</dt><dd>{friend.together.longest}</dd></div><div><dt>solved together</dt><dd>{friend.together.wordsSolved}</dd></div></dl>
      {error && <p className="form-error" role="alert">{error}</p>}
    </>}
  </main>;
}
