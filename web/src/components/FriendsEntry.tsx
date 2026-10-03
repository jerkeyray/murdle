"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { getDuos } from "@/lib/api";
import { useVisiblePolling } from "@/lib/useVisiblePolling";
export function FriendsEntry() {
  const [turns, setTurns] = useState(0);
  const [invites, setInvites] = useState(0);
  const load = useCallback(async () => {
    const duos = await getDuos();
    setTurns(duos.filter(d => d.today?.state === "playing" && d.today.currentPlayer === d.viewerId).length);
    setInvites(duos.filter(d => d.status === "pending" && d.inviterId !== d.viewerId).length);
  }, []);
  useVisiblePolling(load, 30_000);
  const news = turns > 0 || invites > 0;
  const status = turns
    ? `${turns} waiting on you`
    : invites
      ? `${invites} ${invites === 1 ? "invitation" : "invitations"}`
      : null;

  return <Link className="home-friends" href="/friends" data-news={news || undefined}>
    <span className="home-friends-word">Friends</span>
    {status && <span className="home-friends-status">{status}</span>}
  </Link>;
}
