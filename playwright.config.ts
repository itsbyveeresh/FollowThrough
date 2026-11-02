import { defineConfig, devices } from "@playwright/test";
import webpush from "web-push";

/**
 * End-to-end tests run the production build against a real local Postgres
 * (TEST_DATABASE_URL, superuser) and a test-only Supabase Auth stand-in
 * (tests/e2e/auth-emulator.ts). Run with: npm run test:e2e
 */
const admin = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const e2eDb = (() => {
  const u = new URL(admin);
  u.pathname = "/ft_e2e";
  return u.toString();
})();
const vapid = webpush.generateVAPIDKeys();
export const CRON_SECRET = "e2e-cron-secret-0123456789abcdef0123456789";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npx tsx tests/e2e/auth-emulator.ts",
      url: "http://127.0.0.1:54331/auth/v1/health",
      env: { E2E_DATABASE_URL: e2eDb, AUTH_EMULATOR_PORT: "54331" },
      reuseExistingServer: false,
    },
    {
      command: "npx next start -p 3100",
      url: "http://localhost:3100/login",
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54331",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "e2e-publishable-key",
        DATABASE_URL: e2eDb,
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
        VAPID_SUBJECT: "mailto:e2e@example.test",
        CRON_SECRET,
        NEXT_PUBLIC_SITE_URL: "http://localhost:3100",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Same build with no configuration at all: setup problems must be visible.
      command: "npx next start -p 3101",
      url: "http://localhost:3101/setup",
      env: { NEXT_TELEMETRY_DISABLED: "1" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
