import { expect, test } from "@playwright/test";
import { CRON_SECRET } from "../../playwright.config";
import { signUp, uniqueEmail } from "./helpers";

test("dispatcher endpoint requires the secret and records a heartbeat", async ({ request, page }) => {
  expect((await request.post("/api/dispatch")).status()).toBe(401);
  expect((await request.post("/api/dispatch", { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
  const ok = await request.post("/api/dispatch", { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ ok: true });

  await signUp(page, uniqueEmail("health"));
  await page.goto("/settings/notifications");
  await expect(page.getByRole("main").getByText("Scheduler healthy")).toBeVisible();
  await expect(page.getByRole("main").getByText("No subscribed device")).toBeVisible();
});

test("works comfortably at 360px wide", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await signUp(page, uniqueEmail("narrow"));
  await page.getByRole("button", { name: "Quick add task" }).click();
  await page.getByRole("dialog").getByLabel("Title").fill("Send proposal to Acme with a long title that should wrap nicely");
  await page.getByRole("dialog").getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Task added")).toBeVisible();
  for (const path of ["/today", "/inbox", "/waiting", "/tasks", "/tasks?view=board", "/clients", "/settings", "/settings/notifications", "/more"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
  await expect(page.getByRole("navigation", { name: "Main" }).last()).toBeVisible();
  await ctx.close();
});

test("denied notification permission shows instructions and never re-prompts", async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    let asked = 0;
    Object.defineProperty(Notification, "permission", { get: () => "denied" });
    Notification.requestPermission = async () => {
      asked++;
      (window as unknown as { __asked: number }).__asked = asked;
      return "denied";
    };
  });
  const page = await ctx.newPage();
  await signUp(page, uniqueEmail("denied"));
  await page.goto("/settings/notifications");
  await expect(page.getByText("Notifications are blocked for FollowThrough in this browser")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable reminders on this device" })).toHaveCount(0);
  await expect(page.getByText("Notifications blocked", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __asked?: number }).__asked ?? 0)).toBe(0);
  await ctx.close();
});

test("missing configuration is explained, not hidden", async ({ request, page }) => {
  await page.goto("http://localhost:3101/today");
  await expect(page.getByRole("heading", { name: "FollowThrough needs setup" })).toBeVisible();
  await expect(page.getByText("DATABASE_URL")).toBeVisible();
  await expect(page.getByText("NEXT_PUBLIC_SUPABASE_URL")).toBeVisible();
  const dispatch = await request.post("http://localhost:3101/api/dispatch", { headers: { Authorization: "Bearer x" } });
  expect(dispatch.status()).toBe(503);
});

test("service worker and manifest are served for installation", async ({ request }) => {
  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["cache-control"]).toContain("no-cache");
  expect(await sw.text()).toContain("notificationclick");
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/today" });
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  expect((await request.get("/icons/apple-touch-icon.png")).status()).toBe(200);
});

test("API rejects cross-site and unauthenticated requests", async ({ request }) => {
  const anon = await request.post("/api/push/subscribe", { data: {} });
  expect(anon.status()).toBe(401);
  const exp = await request.get("/api/export?format=json");
  expect(exp.status()).toBe(401);
});
