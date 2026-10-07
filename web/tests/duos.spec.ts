import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const API = process.env.DUO_TEST_API;
const CLIENT_API = process.env.PW_API_URL ?? "http://localhost:8182";
test.skip(!API, "Run through the PostgreSQL-backed Go browser fixture");

async function asPlayer(context: BrowserContext, user: string) {
  await context.route("**/api/auth/token", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ token: `fixture-${user}` }) }));
  await context.route(`${CLIENT_API}/**`, async route => {
    const response = await route.fetch({ url: route.request().url().replace(CLIENT_API, API!) });
    await route.fulfill({ response });
  });
}
// Whose turn it is shows as the highlighted name chip, and as a waiting note for the other friend.
const yourTurn = (page: Page) => expect(page.locator(".duo-member[data-current='true']")).toContainText("You");
// The pair's streak lives on the friend detail now, not on the board; read it from the API.
const streakOf = async (page: Page, user: string, id: string) =>
  (await page.request.get(`${API}/api/duos/${id}`, { headers: { Authorization: `Bearer fixture-${user}` } }).then(r => r.json()) as { today: { streak: number } }).today.streak;
async function guess(page: Page, word: string) {
  await page.locator("h1").click();
  await page.keyboard.type(word);
  await page.keyboard.press("Enter");
}

test("friends invite, shared turns, retry, pass, persistence and daily reset", async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const b = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  await asPlayer(a, "adi"); await asPlayer(b, "ananya");
  const adi = await a.newPage(); const ananya = await b.newPage();
  await adi.goto("/friends"); await ananya.goto("/friends");
  await adi.getByRole("button", { name: /Ananya/ }).click();
  await expect(adi.getByRole("dialog")).toContainText("day streak");
  await adi.getByRole("button", { name: "Play together", exact: true }).click();
  await expect(adi.getByRole("dialog")).toContainText("Invitation sent");
  await ananya.reload();
  await ananya.getByRole("button", { name: /Adi/ }).click();
  await ananya.getByRole("button", { name: "Accept daily game" }).click();
  await expect(ananya).toHaveURL(/\/duos\//);
  const id = ananya.url().split("/").at(-1)!;
  const answer = await adi.request.get(`${API}/test/answer?id=${id}`, { headers: { Authorization: "Bearer fixture-adi" } }).then(r => r.json()) as { answer: string };
  const wrongGuesses = ["adieu", "stone", "crane", "slate", "house", "light", "money"].filter(word => word !== answer.answer);
  await adi.getByRole("button", { name: "Close Friend" }).click();
  await adi.goto(`/duos/${id}`);
  await yourTurn(adi);
  await expect(adi.getByRole("button", { name: "Reveal a shared hint" })).toHaveCount(0);
  await expect(ananya.getByText("Waiting for Adi")).toBeVisible();
  // Lose the response after the server commits, then retry the identical request.
  await adi.route("**/api/duos/*/days/*/guesses", async route => {
    await route.fetch({ url: route.request().url().replace(CLIENT_API, API!) });
    await route.abort("failed");
  }, { times: 1 });
  await guess(adi, wrongGuesses[0]);
  // The move reached the server even though its response did not. Nothing to
  // retry by hand: the next refresh finds it and settles the local record.
  await adi.reload();
  await expect(adi.locator(".row [data-mark]")).toHaveCount(5);
  await expect(ananya.locator(".row [data-mark]")).toHaveCount(5);
  await yourTurn(ananya);
  await ananya.getByRole("button", { name: "Pass this turn to your friend", exact: true }).click();
  await yourTurn(adi);
  await adi.locator("h1").click(); await adi.keyboard.type("sto");
  await adi.reload(); await expect(adi.locator('.tile[data-state="filled"]')).toHaveCount(3);
  await adi.request.post(API! + "/test/restart");
  await adi.reload(); await ananya.reload();
  await expect(adi.locator(".row [data-mark]")).toHaveCount(5);
  await expect(adi.locator('.tile[data-state="filled"]')).toHaveCount(3);
  await yourTurn(adi);
  for (let i = 0; i < 3; i++) await adi.keyboard.press("Backspace");
  // Abort before the API receives the move. Use an already-played word so
  // matching an old row cannot falsely settle this new request.
  const retryIDs: string[] = [];
  await adi.route("**/api/duos/*/days/*/guesses", async route => {
    retryIDs.push((route.request().postDataJSON() as {requestId: string}).requestId);
    if (retryIDs.length === 1) await route.abort("failed");
    else {
      const response = await route.fetch({url: route.request().url().replace(CLIENT_API, API!)});
      await route.fulfill({response});
    }
  }, {times: 2});
  await guess(adi, wrongGuesses[0]);
  // Next's route announcer is also role="alert" but stays empty.
  await expect(adi.getByRole("alert").filter({hasText: /\S/})).toBeVisible();
  await adi.reload();
  await expect(adi.locator(".row [data-mark]")).toHaveCount(10);
  expect(retryIDs).toHaveLength(2);
  expect(retryIDs[1]).toBe(retryIDs[0]);
  await yourTurn(ananya);
  await guess(ananya, wrongGuesses[2]);
  await expect(ananya.getByRole("button", { name: "Reveal a shared hint" })).toBeVisible();
  const turnBeforeHint = await ananya.request.get(`${API}/api/duos/${id}`, { headers: { Authorization: "Bearer fixture-ananya" } }).then(r => r.json()) as { today: { currentPlayer: string; version: number } };
  await ananya.route("**/api/duos/*/days/*/hint", async route => {
    await route.fetch({ url: route.request().url().replace(CLIENT_API, API!) });
    await route.abort("failed");
  }, { times: 1 });
  await ananya.getByRole("button", { name: "Reveal a shared hint" }).click();
  await expect(ananya.getByLabel("Shared hint")).toBeVisible();
  await expect(adi.getByLabel("Shared hint")).toBeVisible({timeout: 8_000});
  const turnAfterHint = await adi.request.get(`${API}/api/duos/${id}`, { headers: { Authorization: "Bearer fixture-adi" } }).then(r => r.json()) as { today: { currentPlayer: string; version: number } };
  expect(turnAfterHint.today.currentPlayer).toBe(turnBeforeHint.today.currentPlayer);
  expect(turnAfterHint.today.version).toBe(turnBeforeHint.today.version + 1);
  await adi.locator("h1").click(); for (let i = 0; i < 3; i++) await adi.keyboard.press("Backspace");
  await guess(adi, answer.answer);
  await expect(adi.getByText("Solved together", { exact: true })).toBeVisible();
  await expect(adi.locator('.row').nth(3).locator('[data-mark="hit"]')).toHaveCount(5);
  await expect(ananya.getByText("Solved together", { exact: true })).toBeVisible();
  expect(await streakOf(adi, "adi", id)).toBe(1);
  await adi.screenshot({ path: "test-results/shared-board-mobile.png" });
  // Finishing a board does not end the day: either friend can start the next
  // word, and the other lands on the same new board.
  await expect(adi.getByRole("button", { name: "Next word" })).toBeVisible();
  await expect(ananya.getByRole("button", { name: "Next word" })).toBeVisible();
  await ananya.getByRole("button", { name: "Next word" }).click();
  await expect(ananya.locator(".row [data-mark]")).toHaveCount(0);
  await expect(ananya.getByRole("button", { name: "Next word" })).toHaveCount(0);
  await adi.reload(); // A solved board polls slowly; a phone picked up would refresh on focus.
  await expect(adi.locator(".row [data-mark]")).toHaveCount(0);
  await expect(adi.getByRole("button", { name: "Next word" })).toHaveCount(0);
  const second = await adi.request.get(`${API}/test/answer?id=${id}`, { headers: { Authorization: "Bearer fixture-adi" } }).then(r => r.json()) as { answer: string };
  expect(second.answer).not.toBe(answer.answer);
  // The opener alternates, so Ananya starts the second board.
  await yourTurn(ananya);
  await guess(ananya, second.answer);
  await expect(ananya.getByText("Solved together", { exact: true })).toBeVisible();
  await expect(ananya.getByRole("button", { name: "Next word" })).toBeVisible();
  expect(await streakOf(ananya, "ananya", id)).toBe(1); // two wins in a day is still one day
  await adi.goto("/friends");
  await expect(adi.getByRole("link", { name: /Ananya/ })).toContainText("Solved");
  await adi.screenshot({ path: "test-results/friend-detail-mobile.png" });
  await ananya.screenshot({ path: "test-results/shared-board-desktop.png" });
  await ananya.request.get(API! + "/test/advance?seconds=86400");
  // Completed active boards still observe a friend's next word and rollover.
  await expect(ananya.getByRole("button", { name: "Today’s word" })).toBeVisible({ timeout: 8_000 });
  await ananya.getByRole("button", { name: "Today’s word" }).click();
  await expect(ananya.locator(".row [data-mark]")).toHaveCount(0);
  expect(await streakOf(ananya, "ananya", id)).toBe(1);
  // The friends list opens an active game straight to its board, so ending it
  // goes through the API; the ended pair then shows its history in the dialog.
  const live = await adi.request.get(`${API}/api/duos/${id}`, { headers: { Authorization: "Bearer fixture-adi" } }).then(r => r.json()) as { version: number };
  expect((await adi.request.post(`${API}/api/duos/${id}/end`, { headers: { Authorization: "Bearer fixture-adi" }, data: { requestId: crypto.randomUUID(), version: live.version } })).status()).toBe(200);
  await adi.goto("/friends"); await adi.getByRole("button", { name: /Ananya/ }).click();
  await expect(adi.getByRole("button", { name: "Play together", exact: true })).toBeVisible();
  await expect(adi.locator(".duo-recent")).toContainText(answer.answer);
  await expect(adi.locator(".duo-recent")).toContainText(second.answer);
  // Both of the first day's boards are listed, each with its own link.
  await expect(adi.locator(".duo-recent a", { hasText: "game 2" })).toHaveCount(1);
  // History remains readable after ending the partnership.
  await adi.locator(".duo-recent a").last().click();
  await expect(adi.getByText("Solved together", { exact: true })).toBeVisible();
  await expect(adi.locator('.row').nth(3).locator('[data-mark="hit"]')).toHaveCount(5);

  // Separate partnerships and friend details must not leak another pair's board.
  const api = adi.request;
  const request = await api.post(API! + "/api/me/friends", { headers: { Authorization: "Bearer fixture-adi" }, data: { inviteCode: "OUTCDE" } });
  const friendship = await request.json() as { id: string };
  await api.post(`${API}/api/me/friends/${friendship.id}/respond`, { headers: { Authorization: "Bearer fixture-outsider" }, data: { accept: true } });
  const invitation = await api.post(API! + "/api/me/duos", { headers: { Authorization: "Bearer fixture-adi" }, data: { requestId: crypto.randomUUID(), version: 0, friendshipId: friendship.id, timezone: "Asia/Kolkata" } }).then(r => r.json()) as { id: string; version: number };
  await api.post(`${API}/api/duos/${invitation.id}/accept`, { headers: { Authorization: "Bearer fixture-outsider" }, data: { requestId: crypto.randomUUID(), version: invitation.version } });
  expect((await api.get(`${API}/api/duos/${invitation.id}`, { headers: { Authorization: "Bearer fixture-ananya" } })).status()).toBe(404);
  const mine = await api.get(API! + "/api/me/duos", { headers: { Authorization: "Bearer fixture-adi" } }).then(r => r.json()) as { id: string }[];
  expect(mine).toHaveLength(2);
  await adi.goto("/friends");
  await expect(adi.getByRole("link", { name: /Outsider/ })).toBeVisible();
  await expect(adi.getByRole("button", { name: /Ananya/ })).toBeVisible();
  await expect(adi.getByRole("link", { name: /Outsider/ })).not.toContainText(answer.answer);
  await adi.screenshot({ path: "test-results/friends-lobby-mobile.png" });
  await adi.goto(`/duos/${invitation.id}`);
  for (const [width, height, theme, contrast] of [[320,640,"light",""], [390,844,"dark","cb"], [1280,900,"light","cb"]] as const) {
    await adi.setViewportSize({ width, height });
    await adi.evaluate(({ theme, contrast }) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.contrast = contrast; }, { theme, contrast });
    await expect.poll(async () => { const box = await adi.locator(".keyboard").boundingBox(); return box ? box.y + box.height : Infinity; }).toBeLessThanOrEqual(height + 1);
    expect(await adi.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await adi.screenshot({ path: `test-results/duo-${width}-${theme}-${contrast || "standard"}.png` });
  }
  // Pending invitation actions require an explicit expected version.
  expect((await api.post(`${API}/api/duos/${invitation.id}/end`, { headers: { Authorization: "Bearer fixture-adi" }, data: { requestId: crypto.randomUUID() } })).status()).toBe(400);
  await a.close(); await b.close();
});
