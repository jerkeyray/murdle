import { test, expect } from "@playwright/test";
import { safeReturnTo } from "../src/lib/returnTo";

test("return paths preserve internal invitations and reject external destinations", () => {
  expect(safeReturnTo("/friends?code=ABCDEF")).toBe("/friends?code=ABCDEF");
  expect(safeReturnTo("/duos/abc")).toBe("/duos/abc");
  for (const value of ["https://evil.example", "//evil.example", "/\\evil.example", "/%2fevil.example", "/\nevil", "/sign-in", "javascript:alert(1)"]) expect(safeReturnTo(value)).toBe("/profile");
});

test("friend links prefill a code without sending a request before consent", async ({ page }) => {
  await page.route("**/api/auth/token", r => r.fulfill({ status: 401, body: "{}", contentType: "application/json" }));
  await page.route("http://localhost:8080/**", r => r.fulfill({ status: r.request().url().endsWith("capabilities") ? 200 : 401, body: JSON.stringify({ sharedGames: false }), contentType: "application/json" }));
  await page.goto("/friends?code=ABCDEF");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/sign-in?returnTo=%2Ffriends%3Fcode%3DABCDEF");
});

test("nickname setup returns to the original friend invitation", async ({ page }) => {
  await page.route("**/api/auth/token", r => r.fulfill({ body: JSON.stringify({ token: "fixture" }), contentType: "application/json" }));
  let needsName = true;
  const requests: string[] = [];
  await page.route("http://localhost:8080/**", r => {
    const path = new URL(r.request().url()).pathname;
    if (r.request().method() === "POST") requests.push(path);
    if (path === "/api/me/name") { needsName = false; return r.fulfill({ body: JSON.stringify({ displayName: "Adi" }), contentType: "application/json" }); }
    const body = path === "/api/capabilities" ? { sharedGames: true } : path === "/api/me" ? {
      displayName: needsName ? "" : "Adi", needsName, inviteCode: "ADICDE", streak: { current: 0, longest: 0, playedToday: false }, wordsLearned: 0,
    } : [];
    return r.fulfill({ body: JSON.stringify(body), contentType: "application/json" });
  });
  await page.goto("/friends?code=ABCDEF");
  await expect(page).toHaveURL(/\/profile\?returnTo=/);
  await page.getByLabel("Your name").fill("Adi");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page).toHaveURL(/\/friends\?code=ABCDEF$/);
  await expect(page.getByLabel("Friend code", { exact: true })).toHaveValue("ABCDEF");
  expect(requests).not.toContain("/api/me/friends");
});
