"use client";
import { useCallback, useState } from "react";
import { getCapabilities, heartbeat } from "@/lib/api";
import { useVisiblePolling } from "@/lib/useVisiblePolling";
import { getToken } from "@/lib/token";

export function Presence({ enabled: provided }: { enabled?: boolean }) {
  const [available, setAvailable] = useState(false);
  const enabled = provided ?? available;
  const check = useCallback(async (signal:AbortSignal) => { const capability = await getCapabilities(signal); if (!signal.aborted) setAvailable(capability.sharedGames); }, []);
  useVisiblePolling(check, 60_000, provided === undefined);
  const beat = useCallback(async (signal:AbortSignal) => { if (await getToken(signal)) await heartbeat(signal); }, []);
  useVisiblePolling(beat, 30_000, enabled);
  return null;
}
