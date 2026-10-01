import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const API = process.env.DUO_TEST_API;
test.skip(!API, "Run through the PostgreSQL-backed Go browser fixture");

async function asPlayer(context: BrowserContext, user: string) {
  await context.route("**/api/auth/token", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ token: `fixture-${user}` }) }));
  await context.route("http://localhost:8080/**", async route => {
    const response = await route.fetch({ url: route.request().url().replace("http://localhost:8080", API!) });
    await route.fulfill({ response });
  });
}
async function guess(page: Page, word: string) {
  await page.locator("h1").click();
  await page.keyboard.type(word);
  await page.keyboard.press("Enter");
}

test("friends invite, shared turns, retry, pass, persistence and daily reset", async ({ browser }) => {
  test.setTimeout(60_000);
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
  await adi.getByRole("button", { name: "Close Ananya" }).click();
  await adi.goto(`/duos/${id}`);
  await expect(adi.getByText("Your turn", { exact: true })).toBeVisible();
  await expect(ananya.getByText("Adi’s turn", { exact: true })).toBeVisible();
  // Lose the response after the server commits, then retry the identical request.
  await adi.route("**/api/duos/*/days/*/guesses", async route => {
    await route.fetch({ url: route.request().url().replace("http://localhost:8080", API!) });
    await route.abort("failed");
  }, { times: 1 });
  await guess(adi, "adieu");
  await expect(adi.getByRole("button", { name: "Retry move" })).toBeVisible();
  await adi.getByRole("button", { name: "Retry move" }).click();
  await expect(adi.locator(".row [data-mark]")).toHaveCount(5);
  await expect(ananya.locator(".row [data-mark]")).toHaveCount(5);
  await expect(ananya.getByText("Your turn", { exact: true })).toBeVisible();
  await ananya.getByRole("button", { name: "Pass turn" }).click();
  await expect(adi.getByText("Your turn", { exact: true })).toBeVisible();
  await adi.locator("h1").click(); await adi.keyboard.type("sto");
  await adi.reload(); await expect(adi.locator('.tile[data-state="filled"]')).toHaveCount(3);
  await adi.request.post(API! + "/test/restart");
  await adi.reload(); await ananya.reload();
  await expect(adi.locator(".row [data-mark]")).toHaveCount(5);
  await expect(adi.locator('.tile[data-state="filled"]')).toHaveCount(3);
  await expect(adi.getByText("Your turn", { exact: true })).toBeVisible();
  const answer = await adi.request.get(`${API}/test/answer?id=${id}`, { headers: { Authorization: "Bearer fixture-adi" } }).then(r => r.json()) as { answer: string };
  await adi.locator("h1").click(); for (let i = 0; i < 3; i++) await adi.keyboard.press("Backspace");
  await guess(adi, answer.answer);
  await expect(adi.getByText("Solved together", { exact: true })).toBeVisible();
  await expect(adi.locator('.row').nth(1).locator('[data-mark="hit"]')).toHaveCount(5);
  await expect(ananya.getByText("Solved together", { exact: true })).toBeVisible();
  await expect(adi.locator(".duo-streak")).toHaveText("1 day");
  await adi.goto("/friends"); await adi.getByRole("button", { name: /Ananya/ }).click();
  await expect(adi.locator(".duo-recent")).toContainText(answer.answer);
  await adi.screenshot({ path: "test-results/friend-detail-mobile.png" });
  await ananya.screenshot({ path: "test-results/shared-board-desktop.png" });
  await ananya.request.get(API! + "/test/advance?seconds=86400");
  await expect(ananya.getByRole("button", { name: "Today’s word" })).toBeVisible();
  await ananya.getByRole("button", { name: "Today’s word" }).click();
  await expect(ananya.locator(".row [data-mark]")).toHaveCount(0);
  await expect(ananya.locator(".duo-streak")).toHaveText("1 day");
  await adi.getByRole("button", { name: "End daily game", exact: true }).click();
  await expect(adi.getByText("End this daily game? Your friendship and past results stay.")).toBeVisible();
  await adi.getByRole("button", { name: "End daily game", exact: true }).click();
  await expect(adi.getByRole("button", { name: "Play together", exact: true })).toBeVisible();
  await expect(adi.locator(".duo-recent")).toContainText(answer.answer);
  // History remains readable after ending the partnership.
  await adi.locator(".duo-recent a").last().click();
  await expect(adi.getByText("Solved together", { exact: true })).toBeVisible();
  await expect(adi.locator('.row').nth(1).locator('[data-mark="hit"]')).toHaveCount(5);

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
  await expect(adi.getByRole("button", { name: /Outsider/ })).toBeVisible();
  await expect(adi.getByRole("button", { name: /Ananya/ })).toBeVisible();
  await adi.getByRole("button", { name: /Outsider/ }).click();
  await expect(adi.getByRole("dialog")).not.toContainText(answer.answer);
  await adi.getByRole("button", { name: "Close Outsider" }).click();
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
