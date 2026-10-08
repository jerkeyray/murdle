import { test, expect, type Page } from "@playwright/test";

const API = process.env.PW_API_URL ?? "http://localhost:8182";
const profile = { displayName: "Me", needsName: false, inviteCode: "MECDEF", streak: { current: 1, longest: 2, playedToday: true }, wordsLearned: 3 };
const friends = [
  { id: "anna", displayName: "Anna", status: "accepted", incoming: false, online: true, dayStreak: 2, sharedStreak: 3, playInvite: false },
  { id: "ben", displayName: "Ben", status: "accepted", incoming: false, online: false, dayStreak: 1, sharedStreak: 1, playInvite: false },
  { id: "cara", displayName: "Cara", status: "accepted", incoming: false, online: false, dayStreak: 1, sharedStreak: 0, playInvite: false },
  { id: "new", displayName: "New friend", status: "pending", incoming: true, online: false, dayStreak: 0, sharedStreak: 0, playInvite: true },
];
const game = (id: string, friendshipId: string, state: string, currentPlayer: string) => ({ id, friendshipId, status: "active", inviterId: "me", viewerId: "me", version: 0, recent: [], members: [], timezone: "UTC", today: { state, currentPlayer, rows: [], streak: 3 } });
const duos = [game("g1", "anna", "playing", "me"), game("g2", "ben", "playing", "them"), game("g3", "cara", "won", "me")];
async function setup(page: Page, available = true) {
  await page.route("**/api/auth/token", r => r.fulfill({ body: JSON.stringify({ token: "fixture" }), contentType: "application/json" }));
  await page.route(`${API}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    const body = path === "/api/capabilities" ? { sharedGames: available } : path === "/api/me/home" ? { streak: profile.streak } : path.startsWith("/api/duos/") ? { ...duos[0], today: { ...duos[0].today, board: "2026-10-08", date: "2026-10-08", maxRows: 6, wordLength: 5, passed: [], version: 0, deadline: "2026-10-09T00:00:00Z" } } : path === "/api/me" ? profile : path === "/api/me/friends" ? friends : path === "/api/me/duos" ? duos : path === "/api/me/friends/anna" ? {
      id: "anna", displayName: "Anna", online: true, joinedAt: "2026-01-10T00:00:00Z", streak: { current: 2, longest: 8 }, wordsSolved: 27, together: { current: 3, longest: 5, wordsSolved: 11 }, duo: { ...duos[0], recent: [{ duoId: "g1", board: "2026-10-07", date: "2026-10-07", seq: 0, state: "won", answer: "apple", rows: [{ guess: "apple" }] }] },
    } : {};
    return r.fulfill({ body: JSON.stringify(body), contentType: "application/json" });
  });
}

test("compact hub groups games and separates profile links from board actions", async ({ page }) => {
  await setup(page);
  await page.goto("/friends");
  await expect(page.getByRole("region", { name: "Your friends" })).toBeVisible();
  expect(await page.getByRole("heading", { level: 2 }).allTextContents()).toEqual(["Invitations", "Your turn", "Waiting for friend", "Finished today", "Your friends"]);
  const list = page.getByRole("region", { name: "Your friends" });
  await expect(list.getByRole("link", { name: /Anna/ })).toContainText("3 days together");
  await expect(page.getByRole("region", { name: "Your turn" }).getByRole("link", { name: "Open board" })).toHaveAttribute("href", "/duos/g1");
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/friends-hub-${width}.png` });
  }
  await list.getByRole("link", { name: /Anna/ }).click();
  await expect(page).toHaveURL(/\/friends\/anna$/);
  await expect(page.getByText("Online · Joined January 2026")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "27" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Open board" })).toHaveAttribute("href", "/duos/g1");
  await expect(page.getByRole("region", { name: "Recent shared results" })).toContainText("apple");
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/friend-profile-${width}.png` });
  }
});

test("adding stays collapsed and shared codes require an explicit submission", async ({ page }) => {
  await setup(page);
  let posts = 0;
  await page.route(`${API}/api/me/play-invites`, r => {
    posts++;
    expect(r.request().postDataJSON()).toMatchObject({ inviteCode: "ABCDEF" });
    return r.fulfill({ body: JSON.stringify({ friendshipId: "outgoing", status: "pending" }), contentType: "application/json" });
  });
  await page.goto("/friends");
  await expect(page.getByRole("region", { name: "Your friends" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/friends?code=ABCDEF");
  const dialog = page.getByRole("dialog", { name: "Add & play", exact: true });
  await expect(dialog.getByPlaceholder("Enter code")).toHaveValue("ABCDEF");
  expect(posts).toBe(0);
  await dialog.getByRole("button", { name: "Add & play", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Add & play invitation sent");
  expect(posts).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("one acceptance starts a board and uses a durable request ID", async ({ page }) => {
  await setup(page);
  const requests: string[] = [];
  await page.route(`${API}/api/me/play-invites/new/accept`, r => {
    requests.push(r.request().postDataJSON().requestId);
    return r.fulfill({ body: JSON.stringify({ friendshipId: "new", status: "accepted", duo: { id: "new-game", status: "active" } }), contentType: "application/json" });
  });
  await page.goto("/friends");
  await page.getByRole("button", { name: "Accept & play", exact: true }).click();
  await expect(page).toHaveURL(/\/duos\/new-game$/);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatch(/^[0-9a-f-]{36}$/);
});

test("shared games unavailable disables new combined invitations", async ({ page }) => {
  await setup(page, false);
  await page.goto("/friends");
  await expect(page.getByText("Shared games are unavailable on this server.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add & play", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Accept & play", exact: true })).toBeDisabled();
});

test("home badge counts incoming friendships once", async ({ page }) => {
  await setup(page);
  await page.route(`${API}/api/me/duos`, r => r.fulfill({ body: JSON.stringify([...duos, { id: "duplicate", status: "pending", friendshipId: "new", inviterId: "them", viewerId: "me" }]), contentType: "application/json" }));
  await page.goto("/");
  const entry = page.getByRole("link", { name: "Friends, 1 turn waiting on you, 1 invitation" });
  await expect(entry.locator(".home-friends-badge")).toHaveText("2");
});
