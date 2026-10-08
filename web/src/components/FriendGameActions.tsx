"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, inviteDuo, mutateDuo, type Duo, type DuoMutation } from "@/lib/api";

export function FriendGameActions({ friendshipId, duo, available, onChange, allowEnd = false }: {
  friendshipId: string; duo?: Duo; available: boolean; onChange: () => Promise<unknown>; allowEnd?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ending, setEnding] = useState(false);
  const pending = useRef<{ key: string; mutation: DuoMutation } | null>(null);
  const [current, setCurrent] = useState<Duo | null>(null);
  const game = current && current.id === duo?.id && current.version > duo.version ? current : duo;
  async function act(action: "invite" | "accept" | "decline" | "cancel" | "end") {
    if (busy) return;
    const key = `${game?.id ?? friendshipId}:${action}`;
    if (pending.current?.key !== key) pending.current = { key, mutation: { requestId: crypto.randomUUID(), version: action === "invite" ? 0 : game?.version ?? 0, friendshipId, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } };
    setBusy(true); setError("");
    try {
      const updated = action === "invite" ? await inviteDuo(pending.current.mutation) : await mutateDuo(game!.id, action, pending.current.mutation);
      pending.current = null;
      setEnding(false);
      await onChange();
      if (updated.status === "active" && (action === "invite" || action === "accept")) router.push(`/duos/${updated.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.current) setCurrent(e.current);
      if (e instanceof ApiError && e.status > 0 && e.status < 500) pending.current = null;
      setError(e instanceof Error ? e.message : "Could not update the invitation");
    } finally { setBusy(false); }
  }
  return <div className="social-actions">
    {game?.status === "active" ? <>
      <Link className="text-button" href={`/duos/${game.id}`}>Open board</Link>
      {allowEnd && (ending ? <div className="social-end"><p>End this daily game? Your friendship and past results stay.</p><button className="text-button" disabled={busy} onClick={() => void act("end")}>End daily game</button><button className="text-button" onClick={() => setEnding(false)}>Keep playing</button></div> : <button className="text-button friend-secondary" onClick={() => setEnding(true)}>End daily game</button>)}
    </> : game?.status === "pending" ? game.inviterId === game.viewerId ? <>
      <span className="hint">Waiting for acceptance</span><button className="text-button" disabled={busy} onClick={() => void act("cancel")}>Cancel</button>
    </> : <>
      <button className="text-button" disabled={busy || !available} onClick={() => void act("accept")}>Accept daily game</button><button className="text-button" disabled={busy} onClick={() => void act("decline")}>Decline</button>
    </> : <button className="text-button" disabled={busy || !available} onClick={() => void act("invite")}>{busy ? "Inviting…" : "Play together"}</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
