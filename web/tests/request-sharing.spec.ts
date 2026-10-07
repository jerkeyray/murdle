import { test, expect } from "@playwright/test";
import { getToken, clearToken } from "../src/lib/token";

test("token callers share one exchange and cancellation affects only its caller", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let finish!: (response: Response) => void;
  globalThis.fetch = async () => { calls++; return new Promise<Response>(resolve => { finish = resolve; }); };
  clearToken();
  try {
    const controller = new AbortController();
    const cancelled = getToken(controller.signal);
    const survivor = getToken(new AbortController().signal);
    const rejected = expect(cancelled).rejects.toMatchObject({name: "AbortError"});
    controller.abort();
    await rejected;
    finish(new Response(JSON.stringify({token: "shared-token"}), {headers: {"Content-Type": "application/json"}}));
    expect(await survivor).toBe("shared-token");
    expect(await getToken()).toBe("shared-token");
    expect(calls).toBe(1);
  } finally { globalThis.fetch = originalFetch; clearToken(); }
});

test("a failed token exchange prevents anonymous game requests", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", {status: 503});
  clearToken();
  try { await expect(getToken()).rejects.toThrow("Could not load the session"); }
  finally { globalThis.fetch = originalFetch; clearToken(); }
});
