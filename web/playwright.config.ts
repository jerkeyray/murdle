import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  use: { baseURL: "http://localhost:3000", viewport: { width: 390, height: 844 }, reducedMotion: "reduce", trace: "retain-on-failure" },
  webServer: [
    { command: "pnpm exec next dev --port 3000", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120000 },
    { command: "cd ../server && PORT=8082 DATABASE_URL='' ALLOWED_ORIGINS=http://localhost:3000 go run ./cmd/wordled", url: "http://localhost:8082/api/health", timeout: 120000 },
  ],
});
