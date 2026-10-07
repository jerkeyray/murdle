import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const packs = JSON.parse(readFileSync("../server/internal/words/packs.json", "utf8")) as { id: string; title: string; words: { word: string; hints: string[] }[] }[];
const API = process.env.PW_API_URL ?? "http://localhost:8082";

async function setup(page: Page, index = 0) {
  await page.route("**/api/auth/token", route => route.fulfill({ status: 401, body: "{}", contentType: "application/json" }));
  await page.route(`${API}/**`, async route => {
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  await page.addInitScript(({ exclude }) => {
    // Only seed a fresh browser context, never overwrite a completed cycle on reload.
    if (!localStorage.getItem("test-seeded")) {
      localStorage.setItem("wordle.packs", JSON.stringify(exclude));
      localStorage.setItem("wordle.mode", JSON.stringify({ mode: "themed", wordLength: 5, difficulty: "mixed" }));
      localStorage.setItem("test-seeded", "1");
    }
  }, { exclude: packs.filter((_, i) => i !== index).map(p => p.id) });
}
async function guess(page: Page, word: string) {
  await page.locator("h1").click();
  await page.keyboard.type(word);
  await page.keyboard.press("Enter");
}
async function solve(page: Page, word: string) {
  await guess(page, word);
  await expect(page.getByRole("dialog", { name: "Word entry", exact: true })).toBeVisible();
}
async function expectWord(page: Page, word: number) {
  // Progress is announced rather than drawn, so assert it is present rather
  // than visible: the element is deliberately clipped for sighted players.
  await expect(page.getByText(`Word ${word} of 5`, { exact: true })).toBeAttached();
}

test("accessible modal, keyboard, hints, restoration, conclusion", async ({ page }) => {
  await setup(page);
  await page.goto("/play");
  await expectWord(page, 1);
  await page.getByRole("button", { name: "Clue", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Clue", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reveal clue" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Clue", exact: true })).toBeFocused();
  await guess(page, "adieu");
  await expect(page.locator(".row").first().locator('[data-mark]')).toHaveCount(5);
  await guess(page, "stone");
  await expect(page.locator(".row").nth(1).locator('[data-mark]')).toHaveCount(5);
  // The first hint waits for three accepted guesses.
  await page.getByRole("button", { name: "Clue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reveal clue" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await guess(page, "crane");
  await expect(page.locator(".row").nth(2).locator('[data-mark]')).toHaveCount(5);
  await page.getByRole("button", { name: "Clue", exact: true }).click();
  await page.getByRole("button", { name: "Reveal clue" }).click();
  await expect(page.getByText(packs[0].words[0].hints[0], { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByRole("button", { name: "Clue used" })).toBeVisible();
  await solve(page, packs[0].words[0].word);
  // The entry dialog's action advances the existing themed run.
  await page.getByRole("dialog", { name: "Word entry" }).getByRole("button", { name: "Next word", exact: true }).click();
  await expectWord(page, 2);
  await expect(page.locator('.tile[data-state="filled"]')).toHaveCount(0);
  await page.reload();
  await expectWord(page, 2);
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await page.getByRole("link", { name: /Continue/ }).click();
  await expectWord(page, 2);
  for (let i = 1; i < 5; i++) {
    await solve(page, packs[0].words[i].word);
    await page.getByRole("button", { name: i === 4 ? "Uncover the connection" : "Next word", exact: true }).last().click();
    if (i < 4) await expectWord(page, i + 2);
  }
  await expect(page.getByRole("dialog", { name: "The connection", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: packs[0].title })).toBeVisible();
  await expect(page.locator(".connection-list li")).toHaveCount(5);
  await page.screenshot({ path: "test-results/conclusion-mobile.png" });
});

for (const index of [2, 4, 5, 12]) {
  test(`pilot run ${packs[index].title}: ordered words and final connection`, async ({ page }) => {
    await setup(page, index); await page.goto("/play");
    for (let i = 0; i < 5; i++) {
      await expectWord(page, i + 1);
      await solve(page, packs[index].words[i].word);
      await page.getByRole("button", { name: i === 4 ? "Uncover the connection" : "Next word", exact: true }).last().click();
    }
    await expect(page.getByRole("heading", { name: packs[index].title })).toBeVisible();
    await expect(page.locator(".connection-list li")).toHaveCount(5);
  });
}

test("expired sessions offer an explicit restart", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => localStorage.setItem("wordle.active", "expiredsession"));
  await page.goto("/play");
  await expect(page.getByText(/no longer available/)).toBeVisible();
  await page.getByRole("button", { name: "Start a new run" }).click();
  await expectWord(page, 1);
});

test("a lost guess response restores the accepted row before retrying", async ({ page }) => {
  await setup(page); await page.goto("/play");
  await expectWord(page, 1);
  await page.route("**/api/rounds/*/guesses", async route => {
    await route.fetch();
    await route.abort("failed");
  }, { times: 1 });
  await guess(page, "adieu");
  // The client retries the same request ID after the response is lost. The
  // accepted row appears once, with the next row still empty.
  await expect(page.locator(".row").first().locator('[data-mark]')).toHaveCount(5);
  await expect(page.locator(".row").nth(1).locator('[data-mark]')).toHaveCount(0);
  await expect(page.locator(".row").nth(1).locator('[data-mark]')).toHaveCount(0);
});

test("light, dark, colour-blind, short mobile and desktop layouts", async ({ page }) => {
  await setup(page); await page.goto("/play");
  await expectWord(page, 1);
  for (const [width, height, theme, contrast] of [[390,844,"dark",""], [320,640,"light",""], [390,844,"dark","cb"], [1280,900,"light","cb"]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ theme, contrast }) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.contrast = contrast; }, { theme, contrast });
    await expect.poll(async () => {
      const box = await page.locator(".keyboard").boundingBox();
      return box ? box.y + box.height : Infinity;
    }).toBeLessThanOrEqual(height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/board-${width}-${theme}-${contrast || "standard"}.png` });
  }
});

test("lost words remain in the strip and the optional clue survives restoration", async ({ page }) => {
  await setup(page); await page.goto("/play");
  await expectWord(page, 1);
  for (let i = 0; i < 3; i++) {
    await guess(page, "adieu");
    await expect(page.locator(".row").nth(i).locator('[data-mark]')).toHaveCount(5);
  }
  await page.getByRole("button", { name: "Clue", exact: true }).click();
  await page.getByRole("button", { name: "Reveal clue" }).click();
  await expect(page.locator(".hint-list li")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByRole("button", { name: "Clue used" })).toBeVisible();
  for (let i = 3; i < 6; i++) await guess(page, "adieu");
  await expect(page.getByRole("dialog", { name: "Word entry", exact: true })).toBeVisible();
  const runId = await page.evaluate(() => localStorage.getItem("wordle.active.themed.5.mixed"));
  expect(runId).toBeTruthy();
  const run = await page.request.get(`${API}/api/runs/${runId}`).then(r => r.json()) as { completedWords: { state: string; hintsUsed: number }[] };
  expect(run.completedWords[0]).toMatchObject({ state: "lost", hintsUsed: 1 });
  await page.getByRole("dialog", { name: "Word entry" }).getByRole("button", { name: "Next word", exact: true }).click();
  await expectWord(page, 2);
});

test("play remains usable with storage blocked", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error("Storage blocked"); };
    Storage.prototype.setItem = () => { throw new Error("Storage blocked"); };
  });
  await page.goto("/play");
  await expectWord(page, 1);
  await guess(page, "adieu");
  await expect(page.locator(".row").first().locator('[data-mark]')).toHaveCount(5);
});

test("legacy browser data moves into the Wordle namespace", async ({ page }) => {
  await page.addInitScript(() => {
    const old = ["mur", "dle."].join("");
    localStorage.setItem(old + "theme", "light");
    localStorage.setItem(old + "contrast", "cb");
    localStorage.setItem(old + "active", "legacyrun");
    localStorage.setItem(old + "mode", JSON.stringify({ mode: "themed", wordLength: 5, difficulty: "mixed" }));
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "cb");
  await expect(page.getByRole("link", { name: /Continue/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("wordle.active")))
    .toBe("legacyrun");
});

test("a lost run-creation response reuses the request ID and payload", async ({ page }) => {
  await setup(page);
  const requests: { requestId: string; body: string }[] = [];
  await page.route("**/api/runs?deal=1", async route => {
    const body = route.request().postData() ?? "";
    requests.push({ requestId: JSON.parse(body).requestId, body });
    const response = await route.fetch();
    if (requests.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.goto("/play");
  await expectWord(page, 1);
  expect(requests.length).toBeGreaterThanOrEqual(2);
  expect(new Set(requests.map(request => request.requestId)).size).toBe(1);
  expect(new Set(requests.map(request => request.body)).size).toBe(1);
});

test("a lost next-word response retries its receipt without dealing twice", async ({ page }) => {
  await setup(page); await page.goto("/play");
  await expectWord(page, 1);
  await solve(page, packs[0].words[0].word);
  const requests: { requestId: string; body: string }[] = [];
  await page.route("**/api/runs/*/rounds", async route => {
    const body = route.request().postData() ?? "";
    requests.push({ requestId: JSON.parse(body).requestId, body });
    const response = await route.fetch();
    if (requests.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Next word", exact: true }).last().click();
  await expectWord(page, 2);
  expect(requests.length).toBeGreaterThanOrEqual(2);
  expect(new Set(requests.map(request => request.requestId)).size).toBe(1);
  expect(new Set(requests.map(request => request.body)).size).toBe(1);
  expect(JSON.parse(requests[0].body).expectedRoundId).toBeTruthy();
  await solve(page, packs[0].words[1].word);
});

test("exhaustion starts a fresh exclusion cycle with stable IDs", async ({ page }) => {
  await setup(page);
  await page.addInitScript(({ ids }) => {
    localStorage.setItem("wordle.packs", JSON.stringify(ids));
  }, { ids: packs.map(p => p.id) });
  await page.goto("/play");
  await expectWord(page, 1);
  // Discover only the test fixture identity, never add an answer endpoint to the app.
  const runId = await page.evaluate(() => localStorage.getItem("wordle.active"));
  for (let i = 0; i < 5; i++) {
    for (let g = 0; g < 6; g++) {
      await guess(page, "adieu");
      if (g < 5) await expect(page.locator(".row").nth(g).locator('[data-mark]')).toHaveCount(5);
    }
    await expect(page.getByRole("dialog", { name: "Word entry", exact: true })).toBeVisible();
    await page.getByRole("button", { name: i === 4 ? "Uncover the connection" : "Next word", exact: true }).last().click();
    if (i < 4) await expectWord(page, i + 2);
  }
  const completed = await page.request.get(`${API}/api/runs/${runId}`).then(r => r.json());
  const seen = await page.evaluate(() => JSON.parse(localStorage.getItem("wordle.packs") ?? "[]"));
  expect(seen).toEqual([completed.pack.id]);
});

test("enter reflects whether the typed word is real, without ever blocking a guess", async ({ page }) => {
  await setup(page);
  await page.goto("/play");
  await expectWord(page, 1);
  const enter = page.getByRole("button", { name: "Submit", exact: true });

  // Nothing typed: there is nothing to send.
  await expect(enter).toBeDisabled();

  await page.locator("h1").click();
  await page.keyboard.type("zzzz");
  await expect(enter).toBeDisabled();

  // Full length but not a word. Muted, and still pressable: the server is the
  // authority on a guess, so a stale local list must never cost a move.
  await page.keyboard.type("z");
  await expect(enter).toHaveAttribute("data-state", "unknown");
  await expect(enter).toBeEnabled();

  for (let i = 0; i < 5; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type("crane");
  await expect(enter).toHaveAttribute("data-state", "word");
  await expect(enter).toBeEnabled();
});

test("configuration changes cannot publish an earlier opening response", async ({ page }) => {
  await setup(page);
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const opening = new Promise<void>(resolve => { started = resolve; });
  await page.route(`${API}/api/runs?deal=1`, async route => {
    const payload = route.request().postDataJSON() as {wordLength: number};
    const response = await route.fetch();
    if (payload.wordLength === 5) { started(); await held; }
    await route.fulfill({response});
  });
  try {
    await page.goto("/play?mode=classic&length=5");
    await opening;
    await page.evaluate(() => window.history.pushState(null, "", "/play?mode=classic&length=6"));
    await expect(page.locator(".row").first().locator(".tile")).toHaveCount(6);
    const runID = await page.evaluate(() => localStorage.getItem("wordle.active.classic.6.mixed"));
    expect(runID).toBeTruthy();
    release();
    await expect(page.locator(".row").first().locator(".tile")).toHaveCount(6);
    expect(await page.evaluate(() => localStorage.getItem("wordle.active.classic.6.mixed"))).toBe(runID);
    expect(await page.evaluate(() => localStorage.getItem("wordle.active.classic.5.mixed"))).toBeNull();
  } finally { release(); }
});
