import { defineConfig } from "@playwright/test";
// A dedicated local frontend with synthetic public credentials; no real external service.
const baseURL = "http://127.0.0.1:3102";
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["admin.spec.ts", "home-navigation.spec.ts"],
  timeout: 45000,
  workers: 1,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH },
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3102",
    url: baseURL,
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-public-anon",
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:8000",
      AI_EDU_BUILD_DIR: ".next-admin-qa",
    },
    timeout: 60000,
  },
  reporter: [
    ["list"],
    ["junit", { outputFile: "../docs/frontend-admin-test-results.xml" }],
  ],
  outputDir: "test-results/admin",
});
