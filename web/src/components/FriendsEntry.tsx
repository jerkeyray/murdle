"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { getDuos, getFriends, getCapabilities } from "@/lib/api";
import { useVisiblePolling } from "@/lib/useVisiblePolling";

/**
 * The second way in.
 *
 * Tucked into the top bar as an icon it was findable only if you already knew
 * it was there. Back under Begin, but as a real outlined button on the same
 * measure rather than the pale text link it was before — the point was never
 * to make it quieter, it was to stop it looking like a rival to Begin.
 */
export function FriendsEntry() {
  const [turns, setTurns] = useState(0);
  const [invites, setInvites] = useState(0);
  const load = useCallback(async (signal:AbortSignal) => {
    const capability = await getCapabilities(signal);
    const [duos, friends] = await Promise.all([capability.sharedGames ? getDuos(signal) : Promise.resolve([]), getFriends(signal)]);
    if (signal.aborted) return;
    setTurns(duos.filter(d => d.today?.state === "playing" && d.today.currentPlayer === d.viewerId).length);
    const incomingFriends = friends.filter(f => f.status === "pending" && f.incoming);
    setInvites(incomingFriends.length + duos.filter(d => d.status === "pending" && d.inviterId !== d.viewerId && !incomingFriends.some(f => f.id === d.friendshipId)).length);
  }, []);
  useVisiblePolling(load, 30_000);
  const notificationCount = turns + invites;
  const notificationLabel = [
    turns ? `${turns} ${turns === 1 ? "turn" : "turns"} waiting on you` : null,
    invites ? `${invites} ${invites === 1 ? "invitation" : "invitations"}` : null,
  ].filter(Boolean).join(", ");

  return (
    <Link
      className="home-friends"
      href="/friends"
      data-news={notificationCount ? true : undefined}
      aria-label={notificationCount ? `Friends, ${notificationLabel}` : undefined}
    >
      <svg className="home-friends-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="9" cy="8" r="3.2" /><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.2c2.4-.2 4.1 1.2 4.5 3.8" />
      </svg>
      <span className="home-friends-word">Friends</span>
      {notificationCount > 0 && <span className="home-friends-badge" aria-hidden="true">{notificationCount > 99 ? "99+" : notificationCount}</span>}
    </Link>
  );
}
