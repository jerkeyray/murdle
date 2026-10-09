import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// Every game is one random word from the bank, so these tests cannot know the
// answer. They lose on purpose, which opens the same entry card a win does, and
// recognise a revealed clue by checking it against the bank.
const bank = JSON.parse(readFileSync("../server/internal/words/classic.json", "utf8")) as { word: string; hints: string[] }[];
const firstClues = new Set(bank.map(entry => entry.hints[0]));
const API = process.env.PW_API_URL ?? "http://localhost:8082";

async function setup(page: Page) {
  await page.route("**/api/auth/token", route => route.fulfill({ status: 401, body: "{}", contentType: "application/json" }));
  await page.route(`${API}/**`, async route => {
    const response = await route.fetch();
    await route.fulfill({ response });
  });
}
async function guess(page: Page, word: string) {
  await page.locator("h1").click();
  await page.keyboard.type(word);
  await page.keyboard.press("Enter");
}
async function loseGame(page: Page) {
  for (let g = 0; g < 6; g++) {
    await guess(page, "adieu");
    if (g < 5) await expect(page.locator(".row").nth(g).locator('[data-mark]')).toHaveCount(5);
  }
  await expect(page.getByRole("dialog", { name: "Word entry", exact: true })).toBeVisible();
}
async function expectWord(page: Page) {
  // Progress is announced rather than drawn, so assert it is present rather
  // than visible: the element is deliberately clipped for sighted players.
  await expect(page.getByText("Word 1 of 1", { exact: true })).toBeAttached();
}

test("accessible modal, keyboard, hints, restoration", async ({ page }) => {
  await setup(page);
  await page.goto("/play");
  await expectWord(page);
  await page.getByRole("button", { name: "Clue", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Clue", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reveal clue" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Clue", exact: true })).toBeFocused();
  await guess(page, "stone");
  await expect(page.locator(".row").first().locator('[data-mark]')).toHaveCount(5);
  await guess(page, "pound");
  await expect(page.locator(".row").nth(1).locator('[data-mark]')).toHaveCount(5);
  // The first hint waits for three accepted guesses.
  await page.getByRole("button", { name: "Clue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reveal clue" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await guess(page, "crane");
  await expect(page.locator(".row").nth(2).locator('[data-mark]')).toHaveCount(5);
  await page.getByRole("button", { name: "Clue", exact: true }).click();
  await page.getByRole("button", { name: "Reveal clue" }).click();
  const clue = (await page.locator(".hint-list li p").innerText()).trim();
  expect(firstClues.has(clue)).toBe(true);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByRole("button", { name: "Clue used" })).toBeVisible();
  await expect(page.locator(".row")).toHaveCount(6);
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await page.getByRole("link", { name: /Continue/ }).click();
  await expect(page.getByRole("button", { name: "Clue used" })).toBeVisible();
});

test("a finished game offers the next word", async ({ page }) => {
  await setup(page);
  await page.goto("/play");
  await expectWord(page);
  await loseGame(page);
  await page.getByRole("dialog", { name: "Word entry" }).getByRole("button", { name: "Next word", exact: true }).click();
  await expectWord(page);
  await expect(page.locator('.tile[data-state="filled"]')).toHaveCount(0);
  await expect(page.locator(".row").first().locator('[data-mark]')).toHaveCount(0);
});

test("expired sessions offer an explicit restart", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => localStorage.setItem("wordle.active.classic.5.mixed", "expiredsession"));
  await page.goto("/play");
  await expect(page.getByText(/no longer available/)).toBeVisible();
  await page.getByRole("button", { name: "Start a new run" }).click();
  await expectWord(page);
});

test("a lost guess response restores the accepted row before retrying", async ({ page }) => {
  await setup(page); await page.goto("/play");
  await expectWord(page);
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
  await expectWord(page);
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
  await expectWord(page);
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
  const runId = await page.evaluate(() => localStorage.getItem("wordle.active.classic.5.mixed"));
  expect(runId).toBeTruthy();
  const run = await page.request.get(`${API}/api/runs/${runId}`).then(r => r.json()) as { completedWords: { state: string; hintsUsed: number }[] };
  expect(run.completedWords[0]).toMatchObject({ state: "lost", hintsUsed: 1 });
  await page.getByRole("dialog", { name: "Word entry" }).getByRole("button", { name: "Next word", exact: true }).click();
  await expectWord(page);
});

test("play remains usable with storage blocked", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error("Storage blocked"); };
    Storage.prototype.setItem = () => { throw new Error("Storage blocked"); };
  });
  await page.goto("/play");
  await expectWord(page);
  await guess(page, "adieu");
  await expect(page.locator(".row").first().locator('[data-mark]')).toHaveCount(5);
});

test("legacy browser data moves into the Wordle namespace", async ({ page }) => {
  await page.addInitScript(() => {
    const old = ["mur", "dle."].join("");
    localStorage.setItem(old + "theme", "light");
    localStorage.setItem(old + "contrast", "cb");
    localStorage.setItem(old + "active.classic.5.mixed", "legacyrun");
    // Saved back when games had a type to choose; that field is ignored.
    localStorage.setItem(old + "mode", JSON.stringify({ mode: "themed", wordLength: 5, difficulty: "mixed" }));
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "cb");
  await expect(page.getByRole("link", { name: /Continue/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("wordle.active.classic.5.mixed")))
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
  await expectWord(page);
  expect(requests.length).toBeGreaterThanOrEqual(2);
  expect(new Set(requests.map(request => request.requestId)).size).toBe(1);
  expect(new Set(requests.map(request => request.body)).size).toBe(1);
});

test("a lost next-word response retries its receipt without dealing twice", async ({ page }) => {
  await setup(page); await page.goto("/play");
  await expectWord(page);
  await loseGame(page);
  const requests: { requestId: string; body: string }[] = [];
  await page.route("**/api/runs?deal=1", async route => {
    const body = route.request().postData() ?? "";
    requests.push({ requestId: JSON.parse(body).requestId, body });
    const response = await route.fetch();
    if (requests.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Next word", exact: true }).last().click();
  // "Word 1 of 1" is already on screen from the game just lost, so wait for the
  // retry itself and for the finished board to be replaced.
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".row").first().locator('[data-mark]')).toHaveCount(0);
  expect(new Set(requests.map(request => request.requestId)).size).toBe(1);
  expect(new Set(requests.map(request => request.body)).size).toBe(1);
});

test("played words are excluded from the next deal", async ({ page }) => {
  await setup(page); await page.goto("/play");
  await expectWord(page);
  await loseGame(page);
  const played = await page.evaluate(() => JSON.parse(localStorage.getItem("wordle.words") ?? "[]")) as string[];
  expect(played).toHaveLength(1);
  expect(bank.some(entry => entry.word === played[0])).toBe(true);
  const next = page.waitForRequest("**/api/runs?deal=1");
  await page.getByRole("dialog", { name: "Word entry" }).getByRole("button", { name: "Next word", exact: true }).click();
  expect(JSON.parse((await next).postData() ?? "{}").excludeWords).toEqual(played);
});

test("enter reflects whether the typed word is real, without ever blocking a guess", async ({ page }) => {
  await setup(page);
  await page.goto("/play");
  await expectWord(page);
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
    await page.goto("/play?length=5");
    await opening;
    await page.evaluate(() => window.history.pushState(null, "", "/play?length=6"));
    await expect(page.locator(".row").first().locator(".tile")).toHaveCount(6);
    const runID = await page.evaluate(() => localStorage.getItem("wordle.active.classic.6.mixed"));
    expect(runID).toBeTruthy();
    release();
    await expect(page.locator(".row").first().locator(".tile")).toHaveCount(6);
    expect(await page.evaluate(() => localStorage.getItem("wordle.active.classic.6.mixed"))).toBe(runID);
    expect(await page.evaluate(() => localStorage.getItem("wordle.active.classic.5.mixed"))).toBeNull();
  } finally { release(); }
});

test("the Hard vocabulary setting is saved and carried into the game", async ({ page }) => {
  await setup(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Hard", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hard", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/words most adults could not define/)).toBeVisible();
  // All three vocabulary choices share one row, like the two word lengths.
  const tops = await page.getByRole("group", { name: "Answer vocabulary" }).getByRole("button").evaluateAll(
    (buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  // And none of them is cut off on a phone.
  const clipped = await page.getByRole("group", { name: "Answer vocabulary" }).getByRole("button").evaluateAll(
    (buttons) => buttons.filter((b) => b.scrollWidth > b.clientWidth).map((b) => b.textContent));
  expect(clipped).toEqual([]);
  await page.screenshot({ path: "test-results/settings-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: "test-results/settings-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("wordle.mode") ?? "{}"));
  expect(saved.difficulty).toBe("hard");
  await page.goto("/");
  await expect(page.locator("a.play")).toHaveAttribute("href", /difficulty=hard/);
  const request = page.waitForRequest("**/api/runs?deal=1");
  await page.goto("/play?length=5&difficulty=hard");
  expect(JSON.parse((await request).postData() ?? "{}").difficulty).toBe("hard");
  await expectWord(page);
});
