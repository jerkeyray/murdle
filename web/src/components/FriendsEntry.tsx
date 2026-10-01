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
  return available ? <Link className="home-friends" href="/friends"><span>Friends</span><span>{turns ? `${turns} your turn` : invites ? `${invites} ${invites === 1 ? "invitation" : "invitations"}` : "Play together"} <span aria-hidden>↗</span></span></Link> : null;
}
