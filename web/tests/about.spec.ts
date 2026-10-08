import { test, expect } from "@playwright/test";

const API = process.env.PW_API_URL ?? "http://localhost:8082";

test("the question mark on the home page opens the word facts, straight from the server", async ({ page }) => {
  await page.route("**/api/auth/token", route => route.fulfill({ status: 401, body: "{}", contentType: "application/json" }));
  const stats = await page.request.get(`${API}/api/words/stats`).then(r => r.json()) as {
    answers: number; dictionary: number; lengths: { length: number; total: number; challenging: number }[];
  };

  await page.goto("/");
  await page.screenshot({ path: "test-results/home-with-about.png" });
  await page.getByRole("link", { name: "About the words" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { name: "About the words" })).toBeVisible();

  // Every figure is the server's, so a bank change cannot leave this page stale.
  const total = stats.answers.toLocaleString("en-GB");
  await expect(page.locator(".about-big")).toHaveText(total);
  await expect(page.getByText(`${stats.dictionary.toLocaleString("en-GB")} words`)).toBeVisible();
  for (const l of stats.lengths) {
    const row = page.locator(".about-length").filter({ hasText: `${l.length} letters` });
    await expect(row.locator(".about-length-head span")).toHaveText(l.total.toLocaleString("en-GB"));
    await expect(row.getByText(`Challenging ${l.challenging.toLocaleString("en-GB")}`)).toBeVisible();
  }

  // The licences that require a credit are credited where the data is shown.
  await expect(page.getByRole("link", { name: "Wiktionary" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Tatoeba" })).toBeVisible();
  await expect(page.getByRole("link", { name: "CC BY-SA 4.0" })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/about-mobile.png", fullPage: true });
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("a failed load says so and recovers on retry", async ({ page }) => {
  await page.route("**/api/auth/token", route => route.fulfill({ status: 401, body: "{}", contentType: "application/json" }));
  // Fail every request until the retry: development mode runs effects twice,
  // so failing only the first call would be quietly papered over.
  let failing = true;
  await page.route("**/api/words/stats", async route => {
    if (failing) await route.fulfill({ status: 404, body: "{}", contentType: "application/json" });
    else await route.continue();
  });
  await page.goto("/about");
  await expect(page.getByText("The word figures could not be loaded just now.")).toBeVisible();
  failing = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".about-big")).toBeVisible();
  await expect(page.getByText("The word figures could not be loaded just now.")).toHaveCount(0);
});
