import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3104";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "account-auth.spec.ts",
  timeout: 45000,
  workers: 1,
  use: { baseURL, headless: true, viewport: { width: 1280, height: 900 } },
  webServer: {
    command: "npm run dev -- --webpack --hostname 127.0.0.1 --port 3104",
    url: baseURL,
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-public-anon",
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:8000",
      AI_EDU_BUILD_DIR: ".next-auth-qa",
    },
    timeout: 60000,
  },
  reporter: [["list"]],
  outputDir: "test-results/auth",
});
