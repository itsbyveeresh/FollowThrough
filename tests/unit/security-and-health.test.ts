import { describe, expect, it } from "vitest";
import { safeNextPath, isPublicPath } from "@/lib/next-path";
import { reminderHealth, schedulerState } from "@/lib/health";
import { notificationContent } from "@/server/services/notifications";
import { classifyPushError } from "@/server/push";
import { configProblems } from "@/server/env";
import { labelFromUserAgent } from "@/server/services/devices";
import { sanitize, retryDelayMs } from "@/server/services/dispatcher";
import { DEFAULT_PREFS } from "@/lib/domain/types";

describe("post-login redirect", () => {
  it("keeps the intended in-app destination, including the query", () => {
    expect(safeNextPath("/tasks/123?from=notification")).toBe("/tasks/123?from=notification");
    expect(safeNextPath("%2Ftasks%2F123%3Ffrom%3Dnotification")).toBe("/tasks/123?from=notification");
  });
  it("rejects open redirects and loops", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/login", "", null, "/x\u0000y"])
      expect(safeNextPath(bad as string)).toBe("/today");
  });
  it("knows which paths are public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/confirm")).toBe(true);
    expect(isPublicPath("/tasks/abc")).toBe(false);
    expect(isPublicPath("/today")).toBe(false);
  });
});

describe("reminder health", () => {
  const now = new Date("2026-10-26T10:00:00Z");
  const base = {
    now,
    isDemo: false,
    missingConfig: [],
    pushConfigured: true,
    scheduler: { lastStartedAt: new Date("2026-10-26T09:59:30Z"), lastFinishedAt: new Date("2026-10-26T09:59:31Z"), lastOk: true, lastErrorAt: null },
    enabledDevices: 1,
    totalDevices: 1,
    lastAcceptedAt: new Date("2026-10-26T09:00:00Z"),
    recentFailures: 0,
  };
  const ids = (input: Parameters<typeof reminderHealth>[0]) => Object.fromEntries(reminderHealth(input).map((i) => [i.id, i.title]));

  it("distinguishes scheduler states", () => {
    expect(schedulerState({ ...base.scheduler, lastStartedAt: null }, now)).toBe("not_configured");
    expect(schedulerState({ ...base.scheduler, lastStartedAt: new Date("2026-10-26T09:50:00Z") }, now)).toBe("stale");
    expect(schedulerState({ ...base.scheduler, lastOk: false }, now)).toBe("failing");
    expect(schedulerState(base.scheduler, now)).toBe("healthy");
  });

  it("reports each condition in plain language", () => {
    expect(ids(base)).toMatchObject({ scheduler: "Scheduler healthy", devices: "1 device subscribed", accepted: "Push service accepted the latest message" });
    expect(ids({ ...base, scheduler: { ...base.scheduler, lastStartedAt: null } }).scheduler).toBe("Scheduler not configured");
    expect(ids({ ...base, scheduler: { ...base.scheduler, lastOk: false } }).scheduler).toBe("Recent dispatch failure");
    expect(ids({ ...base, enabledDevices: 0, totalDevices: 0 }).devices).toBe("No subscribed device");
    expect(ids({ ...base, missingConfig: ["VAPID_PRIVATE_KEY"], pushConfigured: false }).config).toBe("Server setup incomplete");
    const blocked = ids({
      ...base,
      browser: { supported: true, permission: "denied", subscribedHere: false, registeredToThisAccount: false, standalone: false, iosNeedsInstall: false },
    });
    expect(blocked.browser).toBe("Notifications blocked");
    const ios = ids({
      ...base,
      browser: { supported: false, permission: "unsupported", subscribedHere: false, registeredToThisAccount: false, standalone: false, iosNeedsInstall: true },
    });
    expect(ios.browser).toBe("Install to Home Screen first");
  });

  it("never claims the phone displayed a notification", () => {
    const accepted = reminderHealth(base).find((i) => i.id === "accepted")!;
    expect(accepted.detail).toMatch(/does not prove the phone displayed it/);
  });

  it("does not pretend demo accounts get reminders", () => {
    expect(reminderHealth({ ...base, isDemo: true }).map((i) => i.id)).toEqual(["demo"]);
  });
});

describe("notification content", () => {
  const input = {
    reminderId: "11111111-1111-4111-8111-111111111111",
    kind: "follow_up" as const,
    scheduledFor: new Date("2026-10-26T11:00:00Z"),
    task: { id: "t1", title: "Revised proposal", clientName: "Acme", contactName: "Anita" },
  };
  it("is discreet by default", () => {
    const n = notificationContent(input, DEFAULT_PREFS, new Date("2026-10-26T10:00:00Z"));
    expect(n.body).toBe("You have a follow-up due.");
    expect(JSON.stringify(n)).not.toMatch(/Acme|Anita|proposal/);
    expect(n.url).toBe("/tasks/t1?from=notification");
    expect(n.tag).toBe(`ft-${input.reminderId}`);
  });
  it("shows details only when opted in", () => {
    const n = notificationContent(input, { ...DEFAULT_PREFS, notificationDetail: "detailed" }, new Date("2026-10-26T10:00:00Z"));
    expect(n.title).toBe("Follow up: Revised proposal");
    expect(n.body).toContain("Anita · Acme");
  });
  it("briefings open Today with counts", () => {
    const n = notificationContent(
      { ...input, kind: "briefing", task: null, briefing: { overdue: 2, followUpsToday: 1, importantSoon: 0 } },
      DEFAULT_PREFS,
      new Date(),
    );
    expect(n.url).toBe("/today?from=notification");
    expect(n.body).toBe("2 overdue items · 1 follow-up today · 0 important deadlines soon");
  });
});

describe("push error handling and logging hygiene", () => {
  it("classifies push-service responses", () => {
    expect(classifyPushError({ statusCode: 410 })).toMatchObject({ kind: "gone" });
    expect(classifyPushError({ statusCode: 404 })).toMatchObject({ kind: "gone" });
    expect(classifyPushError({ statusCode: 429 })).toMatchObject({ kind: "transient" });
    expect(classifyPushError({ statusCode: 502 })).toMatchObject({ kind: "transient" });
    expect(classifyPushError({ statusCode: 403 })).toMatchObject({ kind: "permanent" });
    expect(classifyPushError({ code: "ECONNRESET" })).toMatchObject({ kind: "transient", error: "Network error (ECONNRESET)" });
  });
  it("sanitizes errors before storing them", () => {
    const s = sanitize(new Error("failed for https://fcm.googleapis.com/fcm/send/abcDEF123 token eyJhbGciOiJIUzI1NiJ9abcdefghijklmnopqrstuvwxyz"));
    expect(s).not.toContain("fcm.googleapis.com");
    expect(s).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });
  it("backs off retries and caps the delay", () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs).map((ms) => ms / 60_000)).toEqual([1, 2, 4, 8, 15, 15]);
  });
  it("lists missing configuration by name only", () => {
    const problems = configProblems({
      supabaseUrl: null, supabaseKey: null, databaseUrl: null, vapidPublicKey: null, vapidPrivateKey: null,
      vapidSubject: null, cronSecret: "s3cr3tVALUE", siteUrl: null,
    });
    expect(problems.map((p) => p.variable)).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "DATABASE_URL",
      "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT",
      "CRON_SECRET",
    ]);
    expect(JSON.stringify(problems)).not.toContain("s3cr3tVALUE");
  });
  it("labels devices from the user agent", () => {
    expect(labelFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(labelFromUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36")).toBe("Android · Chrome");
  });
});
