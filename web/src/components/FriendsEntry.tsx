"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { getCapabilities, getDuos } from "@/lib/api";
import { useVisiblePolling } from "@/lib/useVisiblePolling";
export function FriendsEntry() {
  const [available, setAvailable] = useState(false);
  const [turns, setTurns] = useState(0);
  const [invites, setInvites] = useState(0);
  const load = useCallback(async () => {
    const caps = await getCapabilities(); setAvailable(caps.sharedGames);
    if (!caps.sharedGames) return;
    const duos = await getDuos();
    setTurns(duos.filter(d => d.today?.state === "playing" && d.today.currentPlayer === d.viewerId).length);
    setInvites(duos.filter(d => d.status === "pending" && d.inviterId !== d.viewerId).length);
  }, []);
  useVisiblePolling(load, 30_000);
  // The second button on the front door, shaped like the first. News takes the
  // label itself rather than hiding in a trailing caption — a turn waiting on
  // you is the whole reason to come back, so it should be the thing you read.
  const news = turns > 0 || invites > 0;
  const label = turns
    ? `${turns} waiting on you`
    : invites
      ? `${invites} ${invites === 1 ? "invitation" : "invitations"}`
      : "Play with a friend";
  return available ? (
    <Link className="home-friends" href="/friends" data-news={news || undefined}>
      <span className="home-friends-word">{label}</span>
    </Link>
  ) : null;
}
