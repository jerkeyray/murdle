"use client";

import { useEffect } from "react";

// One request at a time; hidden tabs pause and network failures back off.
export function useVisiblePolling(task: (signal: AbortSignal) => Promise<unknown>, interval: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let running = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    const run = async () => {
      clearTimeout(timer);
      if (disposed || running || document.hidden) return;
      running = true;
      controller = new AbortController();
      try { await task(controller.signal); failures = 0; }
      catch { failures = Math.min(failures + 1, 4); }
      finally {
        running = false;
        if (!disposed) timer = setTimeout(run, interval * 2 ** failures);
      }
    };
    void run();
    window.addEventListener("focus", run);
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(timer);
      window.removeEventListener("focus", run);
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", run);
    };
  }, [task, interval, enabled]);
}
