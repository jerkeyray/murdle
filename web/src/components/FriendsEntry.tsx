"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { getDuos } from "@/lib/api";
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
  const load = useCallback(async () => {
    const duos = await getDuos();
    setTurns(duos.filter(d => d.today?.state === "playing" && d.today.currentPlayer === d.viewerId).length);
    setInvites(duos.filter(d => d.status === "pending" && d.inviterId !== d.viewerId).length);
  }, []);
  useVisiblePolling(load, 30_000);
  const waiting = turns || invites;
  const status = turns
    ? `${turns} waiting on you`
    : invites
      ? `${invites} ${invites === 1 ? "invitation" : "invitations"}`
      : null;

  return (
    <Link className="home-friends" href="/friends" data-news={waiting ? true : undefined}>
      <span className="home-friends-word">Friends</span>
      {status && <span className="home-friends-status">{status}</span>}
    </Link>
  );
}
