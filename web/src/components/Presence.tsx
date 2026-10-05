"use client";
import { useCallback, useState } from "react";
import { getCapabilities, heartbeat } from "@/lib/api";
import { useVisiblePolling } from "@/lib/useVisiblePolling";
import { getToken } from "@/lib/token";

export function Presence() {
  const [enabled, setEnabled] = useState(false);
  const check = useCallback(async (signal:AbortSignal) => { setEnabled((await getCapabilities(signal)).sharedGames); }, []);
  useVisiblePolling(check, 60_000);
  const beat = useCallback(async (signal:AbortSignal) => { if (await getToken()) await heartbeat(signal); }, []);
  useVisiblePolling(beat, 30_000, enabled);
  return null;
}
