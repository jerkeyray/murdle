import { defineConfig } from "@playwright/test";

const webPort = Number(process.env.PW_WEB_PORT ?? 3100);
const apiPort = Number(process.env.PW_API_PORT ?? 8182);
const webURL = `http://localhost:${webPort}`;
const apiURL = `http://localhost:${apiPort}`;
const distDir = process.env.PW_NEXT_DIST_DIR ?? ".next-playwright";
process.env.PW_API_URL = apiURL;

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  use: { baseURL: webURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce", trace: "retain-on-failure" },
  webServer: [
    { command: `NEXT_DIST_DIR=${distDir} NEXT_PUBLIC_API_URL=${apiURL} pnpm exec next dev --port ${webPort}`, url: webURL, reuseExistingServer: !process.env.CI, timeout: 120000 },
    { command: `cd ../server && PORT=${apiPort} DATABASE_URL='' ALLOWED_ORIGINS=${webURL} go run ./cmd/wordled`, url: `${apiURL}/api/health`, reuseExistingServer: !process.env.CI, timeout: 120000 },
  ],
});
