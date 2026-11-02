import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Sql } from "@/server/db";
import {
  createTask,
  getActivities,
  getTask,
  logFollowUp,
  restoreTask,
  snoozeTask,
  softDeleteTask,
  updateTask,
} from "@/server/services/tasks";
import { updateSettings } from "@/server/services/profile";
import { runDispatch } from "@/server/services/dispatcher";
import { DEFAULT_PREFS } from "@/lib/domain/types";
import { addDevice, asService, asUser, createUser, FakeSender, freshDb, hasDb, minutes, reminders, TestClock } from "./helpers";

// Kolkata has no DST: Mon 26 Oct 2026 10:00 local = 04:30Z.
const START = "2026-10-26T04:30:00Z";

describe.skipIf(!hasDb)("task lifecycle and reminder invalidation", () => {
  let sql: Sql;
  let drop: () => Promise<void>;
  let user: string;
  const clock = new TestClock(new Date(START));

  beforeAll(async () => {
    ({ sql, drop } = await freshDb());
    user = await createUser(sql, "lifecycle@example.test");
  });
  afterAll(async () => drop?.());
  beforeEach(() => clock.set(START));

  it("captures an Inbox task with only a title", async () => {
    const { task } = await asUser(sql, user, (tx) => createTask(tx, user, { title: "Idea: quarterly review" }, clock.now()));
    expect(task).toMatchObject({ status: "inbox", priority: "normal", followUpAt: null, dueDate: null });
    expect(await reminders(sql, task.id)).toHaveLength(0);
    const acts = await asUser(sql, user, (tx) => getActivities(tx, task.id));
    expect(acts.map((a) => a.kind)).toEqual(["created"]);
  });

  it("edits without clearing untouched fields and keeps history", async () => {
    const { task } = await asUser(sql, user, (tx) =>
      createTask(tx, user, { title: "Draft SOW", notes: "Scope v1", tags: ["Legal", "legal", " sow "] }, clock.now()),
    );
    expect(task.tags).toEqual(["legal", "sow"]);
    const { task: edited } = await asUser(sql, user, (tx) => updateTask(tx, user, task.id, { title: "Draft SOW v2" }, clock.now()));
    expect(edited.title).toBe("Draft SOW v2");
    expect(edited.notes).toBe("Scope v1");
    const acts = await asUser(sql, user, (tx) => getActivities(tx, task.id));
    expect(acts[0]).toMatchObject({ kind: "updated", changes: { title: { from: "Draft SOW", to: "Draft SOW v2" } } });
  });

  it("schedules, reschedules and cancels follow-up reminders", async () => {
    const { task } = await asUser(sql, user, (tx) =>
      createTask(tx, user, { title: "Get revised proposal from Anita", status: "waiting_on", followUpLocal: "2026-10-28T11:00" }, clock.now()),
    );
    let rs = await reminders(sql, task.id);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ kind: "follow_up", status: "pending", taskVersion: 1 });
    expect((rs[0].scheduledFor as Date).toISOString()).toBe("2026-10-28T05:30:00.000Z");

    await asUser(sql, user, (tx) => updateTask(tx, user, task.id, { followUpLocal: "2026-10-29T15:00" }, clock.now()));
    rs = await reminders(sql, task.id);
    expect(rs.map((r) => [r.status, r.taskVersion])).toEqual([
      ["cancelled", 1],
      ["pending", 2],
    ]);
    expect(rs[0].statusReason).toBe("task_changed");

    await asUser(sql, user, (tx) => updateTask(tx, user, task.id, { status: "completed" }, clock.now()));
    rs = await reminders(sql, task.id);
    expect(rs.every((r) => r.status === "cancelled")).toBe(true);
    expect(rs[1].statusReason).toBe("task_completed");
    const done = await asUser(sql, user, (tx) => getTask(tx, task.id));
    expect(done?.completedAt).toBeInstanceOf(Date);
  });

  it("keeps the deadline separate from the follow-up and plans both reminders", async () => {
    const { task } = await asUser(sql, user, (tx) =>
      createTask(
        tx,
        user,
        {
          title: "Board pack",
          status: "next_action",
          dueDate: "2026-10-30",
          dueTime: "17:00",
          followUpLocal: "2026-10-28T11:00",
          deadlineReminderMinutes: 120,
        },
        clock.now(),
      ),
    );
    const rs = await reminders(sql, task.id);
    expect(rs.map((r) => r.kind).sort()).toEqual(["deadline", "follow_up"]);
    const dl = rs.find((r) => r.kind === "deadline")!;
    expect((dl.scheduledFor as Date).toISOString()).toBe("2026-10-30T09:30:00.000Z"); // 15:00 IST
    expect(task.dueAt?.toISOString()).toBe("2026-10-30T11:30:00.000Z");
  });

  it("date-only deadlines remind at the configured time, not midnight", async () => {
    const { task } = await asUser(sql, user, (tx) =>
      createTask(tx, user, { title: "File return", dueDate: "2026-10-30", deadlineReminderMinutes: 0 }, clock.now()),
    );
    const [r] = await reminders(sql, task.id);
    expect((r.scheduledFor as Date).toISOString()).toBe("2026-10-30T03:30:00.000Z"); // 09:00 IST default
    expect(task.dueAt?.toISOString()).toBe("2026-10-30T18:30:00.000Z"); // end of local day
  });

  it("snoozing keeps the deadline and follow-up and shows the snoozed state", async () => {
    const { task } = await asUser(sql, user, (tx) =>
      createTask(
        tx,
        user,
        { title: "Chase invoice", status: "waiting_on", followUpLocal: "2026-10-26T10:30", dueDate: "2026-10-30", dueTime: "17:00" },
        clock.now(),
      ),
    );
    const { task: snoozed } = await asUser(sql, user, (tx) => snoozeTask(tx, user, task.id, { option: "1h" }, clock.now()));
    expect(snoozed.followUpAt).toEqual(task.followUpAt);
    expect(snoozed.dueDate).toBe("2026-10-30");
    expect(snoozed.dueTime).toBe("17:00");
    expect(snoozed.snoozedUntil?.toISOString()).toBe("2026-10-26T05:30:00.000Z");
    const rs = await reminders(sql, task.id);
    const fu = rs.find((r) => r.kind === "follow_up")!;
    expect(fu).toMatchObject({ status: "cancelled", statusReason: "snoozed" });
    expect(rs.find((r) => r.kind === "snooze")).toMatchObject({ status: "pending" });
    expect(rs.find((r) => r.kind === "deadline")).toMatchObject({ status: "pending" }); // after the snooze, untouched
  });

  it("logs a follow-up with note, outcome and next follow-up in one step", async () => {
    const { task } = await asUser(sql, user, (tx) =>
      createTask(tx, user, { title: "Collect documents from Raj", status: "waiting_on", followUpLocal: "2026-10-27T10:00" }, clock.now()),
    );
    clock.set("2026-10-27T04:40:00Z");
    const { task: after } = await asUser(sql, user, (tx) =>
      logFollowUp(
        tx,
        user,
        task.id,
        { method: "phone", note: "Called; Raj will send documents Friday", outcome: "Promised Friday", nextFollowUpLocal: "2026-10-30T15:00" },
        clock.now(),
      ),
    );
    expect(after.followUpAt?.toISOString()).toBe("2026-10-30T09:30:00.000Z");
    expect(after.lastFollowedUpAt?.toISOString()).toBe("2026-10-27T04:40:00.000Z");
    expect(after.status).toBe("waiting_on");
    const acts = await asUser(sql, user, (tx) => getActivities(tx, task.id));
    expect(acts[0]).toMatchObject({ kind: "follow_up_logged", method: "phone", note: "Called; Raj will send documents Friday", outcome: "Promised Friday" });
    const rs = await reminders(sql, task.id);
    expect(rs.map((r) => r.status)).toEqual(["cancelled", "pending"]);
  });

  it("rejects a next follow-up in the past and rolls back", async () => {
    const { task } = await asUser(sql, user, (tx) => createTask(tx, user, { title: "Past check", status: "waiting_on" }, clock.now()));
    await expect(
      asUser(sql, user, (tx) => logFollowUp(tx, user, task.id, { method: "email", note: "x", nextFollowUpLocal: "2026-10-25T10:00" }, clock.now())),
    ).rejects.toThrow(/future/);
    const acts = await asUser(sql, user, (tx) => getActivities(tx, task.id));
    expect(acts.map((a) => a.kind)).toEqual(["created"]);
  });

  it("moves tasks to the trash and restores them with reminders", async () => {
    const { task } = await asUser(sql, user, (tx) =>
      createTask(tx, user, { title: "Recoverable", status: "next_action", followUpLocal: "2026-10-28T09:00" }, clock.now()),
    );
    await asUser(sql, user, (tx) => softDeleteTask(tx, user, task.id, clock.now()));
    let rs = await reminders(sql, task.id);
    expect(rs.map((r) => r.status)).toEqual(["cancelled"]);
    const restored = await asUser(sql, user, (tx) => restoreTask(tx, user, task.id, clock.now()));
    expect(restored.deletedAt).toBeNull();
    rs = await reminders(sql, task.id);
    expect(rs.map((r) => r.status)).toEqual(["cancelled", "pending"]);
  });

  it("re-plans reminders when the time zone changes (deadline keeps wall-clock time)", async () => {
    const { task } = await asUser(sql, user, (tx) =>
      createTask(tx, user, { title: "TZ move", dueDate: "2026-11-02", dueTime: "17:00", deadlineReminderMinutes: 60 }, clock.now()),
    );
    await asUser(sql, user, (tx) =>
      updateSettings(tx, user, { ...DEFAULT_PREFS, displayName: null, timezone: "Europe/London", quietHoursEnabled: false }, clock.now()),
    );
    const moved = await asUser(sql, user, (tx) => getTask(tx, task.id));
    expect(moved?.dueAt?.toISOString()).toBe("2026-11-02T17:00:00.000Z"); // 17:00 GMT
    const rs = await reminders(sql, task.id);
    expect(rs.filter((r) => r.status === "pending").map((r) => (r.scheduledFor as Date).toISOString())).toEqual([
      "2026-11-02T16:00:00.000Z",
    ]);
    await asUser(sql, user, (tx) =>
      updateSettings(tx, user, { ...DEFAULT_PREFS, displayName: null, timezone: "Asia/Kolkata", quietHoursEnabled: false }, clock.now()),
    );
  });
});

describe.skipIf(!hasDb)("reminder dispatcher", () => {
  let sql: Sql;
  let drop: () => Promise<void>;
  let user: string;
  const clock = new TestClock(new Date(START));
  const PHONE = "https://push.example.test/phone";
  const LAPTOP = "https://push.example.test/laptop";

  beforeAll(async () => {
    ({ sql, drop } = await freshDb());
    user = await createUser(sql, "dispatch@example.test");
    await addDevice(sql, user, PHONE);
    await addDevice(sql, user, LAPTOP);
  });
  afterAll(async () => drop?.());
  beforeEach(async () => {
    clock.set(START);
    // Isolate tests: clear queue state.
    await asService(sql, (tx) => tx`delete from ft.reminders`);
    await asService(sql, (tx) => tx`update ft.push_subscriptions set enabled = true, disabled_reason = null, consecutive_failures = 0`);
  });

  async function followUpTask(title: string, local: string, extra: Record<string, unknown> = {}) {
    const { task } = await asUser(sql, user, (tx) =>
      createTask(tx, user, { title, status: "waiting_on", followUpLocal: local, ...extra }, clock.now()),
    );
    return task;
  }

  const dispatch = (sender: FakeSender, extra: Partial<Parameters<typeof runDispatch>[0]> = {}) =>
    runDispatch({ sql, sender, now: clock.now, ...extra });

  it("sends nothing before the follow-up time and sends to every device at the time", async () => {
    const task = await followUpTask("Call Raj", "2026-10-26T11:00");
    const sender = new FakeSender();
    await dispatch(sender);
    expect(sender.calls).toHaveLength(0);
    clock.set("2026-10-26T05:30:30Z");
    const s = await dispatch(sender);
    expect(s).toMatchObject({ claimed: 1, sent: 1, ok: true });
    expect(sender.calls.map((c) => c.endpoint).sort()).toEqual([LAPTOP, PHONE]);
    const payload = sender.calls[0].payload;
    expect(payload).toMatchObject({ title: "FollowThrough", body: "You have a follow-up due.", url: `/tasks/${task.id}?from=notification` });
    expect(String(payload.body)).not.toContain("Raj"); // discreet by default
    expect(sender.calls[0].opts.topic).toHaveLength(32);
    const [r] = await reminders(sql, task.id);
    expect(r).toMatchObject({ status: "sent", attempts: 1 });
    // Running again sends nothing more.
    await dispatch(sender);
    expect(sender.calls).toHaveLength(2);
  });

  it("does not send an obsolete reminder (final state check)", async () => {
    const task = await followUpTask("Will complete", "2026-10-26T11:00");
    // Simulate a race: the task completes after the reminder was planned, without resync.
    await asService(sql, (tx) => tx`update ft.tasks set status = 'completed', completed_at = now(), schedule_version = schedule_version + 1 where id = ${task.id}`);
    clock.set("2026-10-26T05:31:00Z");
    const sender = new FakeSender();
    const s = await dispatch(sender);
    expect(sender.calls).toHaveLength(0);
    expect(s.cancelled).toBe(1);
    const [r] = await reminders(sql, task.id);
    expect(r.statusReason).toBe("task_completed");
  });

  it("claims atomically: concurrent runs send each reminder once", async () => {
    for (let i = 0; i < 3; i++) await followUpTask(`Concurrent ${i}`, "2026-10-26T11:00");
    clock.set("2026-10-26T05:31:00Z");
    const sender = new FakeSender();
    sender.delayMs = 20;
    const results = await Promise.all([dispatch(sender), dispatch(sender), dispatch(sender), dispatch(sender)]);
    expect(results.reduce((n, r) => n + r.claimed, 0)).toBe(3);
    expect(sender.calls).toHaveLength(6); // 3 reminders x 2 devices, no duplicates
    const pairs = sender.calls.map((c) => `${c.payload.reminderId}|${c.endpoint}`);
    expect(new Set(pairs).size).toBe(6);
  });

  it("recovers reminders whose worker crashed after the lease expires", async () => {
    const task = await followUpTask("Crash", "2026-10-26T11:00");
    clock.set("2026-10-26T05:31:00Z");
    // A worker claims and then dies.
    const claimed = await asService(sql, (tx) =>
      tx`select * from ft.claim_due_reminders(${"00000000-0000-4000-8000-000000000001"}, ${clock.now()}, 10, 3, 120)`,
    );
    expect(claimed).toHaveLength(1);
    const sender = new FakeSender();
    clock.advance(minutes(1));
    expect((await dispatch(sender)).claimed).toBe(0); // lease still held
    clock.advance(minutes(2));
    const s = await dispatch(sender);
    expect(s).toMatchObject({ claimed: 1, sent: 1 });
    const [r] = await reminders(sql, task.id);
    expect(r.status).toBe("sent");
  });

  it("retries only the failed device after a transient failure", async () => {
    const task = await followUpTask("Flaky", "2026-10-26T11:00");
    clock.set("2026-10-26T05:31:00Z");
    const sender = new FakeSender();
    sender.script(LAPTOP, { ok: false, status: 503, kind: "transient", error: "HTTP 503: push service error" });
    const s1 = await dispatch(sender);
    expect(s1.retried).toBe(1);
    let [r] = await reminders(sql, task.id);
    expect(r).toMatchObject({ status: "pending", deferredReason: "retry", attempts: 1 });
    clock.advance(minutes(1));
    await dispatch(sender);
    [r] = await reminders(sql, task.id);
    expect(r).toMatchObject({ status: "sent", attempts: 2 });
    expect(sender.to(PHONE)).toHaveLength(1); // accepted device not resent
    expect(sender.to(LAPTOP)).toHaveLength(2);
    const attempts = await asService(sql, (tx) => tx`select outcome from ft.delivery_attempts a join ft.reminders r on r.id = a.reminder_id where r.task_id = ${task.id} order by a.created_at`);
    expect(attempts.map((a) => a.outcome).sort()).toEqual(["accepted", "accepted", "transient_failure"]);
  });

  it("bounds retries and reports partial delivery when one device keeps failing", async () => {
    const task = await followUpTask("Partial", "2026-10-26T11:00");
    clock.set("2026-10-26T05:31:00Z");
    const sender = new FakeSender();
    const fail = { ok: false as const, status: 500, kind: "transient" as const, error: "HTTP 500: push service error" };
    sender.script(LAPTOP, fail, fail, fail, fail, fail, fail);
    for (let i = 0; i < 8; i++) {
      await dispatch(sender);
      clock.advance(minutes(16));
    }
    const [r] = await reminders(sql, task.id);
    expect(r.status).toBe("partial");
    expect(sender.to(PHONE)).toHaveLength(1);
    expect(sender.to(LAPTOP).length).toBeLessThanOrEqual(5);
  });

  it("disables expired subscriptions and reports no devices", async () => {
    const task = await followUpTask("Expired", "2026-10-26T11:00");
    clock.set("2026-10-26T05:31:00Z");
    const sender = new FakeSender();
    sender.script(PHONE, { ok: false, status: 410, kind: "gone", error: "HTTP 410: subscription expired" });
    sender.script(LAPTOP, { ok: false, status: 404, kind: "gone", error: "HTTP 404: subscription expired" });
    await dispatch(sender);
    const [r] = await reminders(sql, task.id);
    expect(r).toMatchObject({ status: "no_devices", statusReason: "all_subscriptions_expired" });
    const subs = await asService(sql, (tx) => tx`select enabled, disabled_reason from ft.push_subscriptions where user_id = ${user}`);
    expect(subs.every((s) => s.enabled === false)).toBe(true);
    // Next reminder: nothing to send to.
    const t2 = await followUpTask("After expiry", "2026-10-26T11:05");
    clock.set("2026-10-26T05:36:00Z");
    await dispatch(sender);
    const [r2] = await reminders(sql, t2.id);
    expect(r2.status).toBe("no_devices");
  });

  it("defers during quiet hours at send time without changing the task", async () => {
    const task = await followUpTask("Late call", "2026-10-26T22:30");
    await asService(sql, (tx) => tx`update ft.profiles set quiet_hours_enabled = true, quiet_start = '21:00', quiet_end = '07:30' where id = ${user}`);
    clock.set("2026-10-26T17:01:00Z"); // 22:31 IST
    const sender = new FakeSender();
    const s = await dispatch(sender);
    expect(s.deferred).toBe(1);
    expect(sender.calls).toHaveLength(0);
    const [r] = await reminders(sql, task.id);
    expect(r).toMatchObject({ status: "pending", deferredReason: "quiet_hours" });
    expect((r.availableAt as Date).toISOString()).toBe("2026-10-27T02:00:00.000Z"); // 07:30 IST
    expect((r.scheduledFor as Date).toISOString()).toBe("2026-10-26T17:00:00.000Z");
    const t = await asUser(sql, user, (tx) => getTask(tx, task.id));
    expect(t?.followUpAt?.toISOString()).toBe("2026-10-26T17:00:00.000Z");
    clock.set("2026-10-27T02:00:30Z");
    await dispatch(sender);
    expect(sender.calls).toHaveLength(2);
    await asService(sql, (tx) => tx`update ft.profiles set quiet_hours_enabled = false where id = ${user}`);
  });

  it("after an outage, marks stale reminders missed and sends one catch-up summary", async () => {
    for (let i = 0; i < 4; i++) await followUpTask(`Outage ${i}`, "2026-10-26T11:00");
    clock.set("2026-10-26T08:00:00Z"); // 2.5 hours later
    const sender = new FakeSender();
    const s = await dispatch(sender);
    expect(s.missed).toBe(4);
    await dispatch(sender); // catch-up is due now
    const bodies = sender.calls.map((c) => c.payload.kind);
    expect(bodies.every((k) => k === "catch_up")).toBe(true);
    expect(sender.calls).toHaveLength(2); // one summary x 2 devices
    expect(String(sender.calls[0].payload.body)).toContain("4 reminders");
  });

  it("limits how many reminders one person gets per run", async () => {
    for (let i = 0; i < 5; i++) await followUpTask(`Burst ${i}`, "2026-10-26T11:00");
    clock.set("2026-10-26T05:31:00Z");
    const sender = new FakeSender();
    expect((await dispatch(sender)).claimed).toBe(3);
    clock.advance(minutes(1));
    expect((await dispatch(sender)).claimed).toBe(2);
  });

  it("schedules a daily repeat only when enabled, and stops when rescheduled", async () => {
    const task = await followUpTask("Repeat me", "2026-10-26T11:00", { repeatDaily: true });
    clock.set("2026-10-26T05:31:00Z");
    const sender = new FakeSender();
    await dispatch(sender);
    let rs = await reminders(sql, task.id);
    const repeat = rs.find((r) => r.kind === "repeat")!;
    expect((repeat.scheduledFor as Date).toISOString()).toBe("2026-10-27T05:30:00.000Z");
    await asUser(sql, user, (tx) => updateTask(tx, user, task.id, { followUpLocal: "2026-10-29T11:00" }, clock.now()));
    rs = await reminders(sql, task.id);
    expect(rs.find((r) => r.kind === "repeat")!.status).toBe("cancelled");
  });

  it("skips demo accounts", async () => {
    const demo = await createUser(sql, "demo@example.test");
    await asService(sql, (tx) => tx`update ft.profiles set is_demo = true where id = ${demo}`);
    await addDevice(sql, demo, "https://push.example.test/demo");
    const { task } = await asUser(sql, demo, (tx) =>
      createTask(tx, demo, { title: "Demo", status: "waiting_on", followUpLocal: "2026-10-26T11:00" }, clock.now()),
    );
    clock.set("2026-10-26T05:31:00Z");
    const sender = new FakeSender();
    await dispatch(sender);
    expect(sender.calls).toHaveLength(0);
    const [r] = await reminders(sql, task.id);
    expect(r).toMatchObject({ status: "skipped", statusReason: "demo_account" });
  });

  it("records a failed run when push is not configured", async () => {
    await followUpTask("No VAPID", "2026-10-26T11:00");
    clock.set("2026-10-26T05:31:00Z");
    const s = await runDispatch({ sql, sender: null, now: clock.now });
    expect(s.ok).toBe(false);
    expect(s.error).toMatch(/not configured/);
    const [run] = await asService(sql, (tx) => tx`select ok, error from ft.scheduler_runs order by id desc limit 1`);
    expect(run.ok).toBe(false);
  });

  it("sends a briefing with counts that opens Today", async () => {
    await asService(sql, (tx) => tx`update ft.profiles set briefing_enabled = true, briefing_time = '08:30', briefing_working_days_only = false where id = ${user}`);
    clock.set("2026-10-27T03:01:00Z"); // 08:31 IST Tue
    const sender = new FakeSender();
    await dispatch(sender); // plans + sends
    const briefing = sender.calls.find((c) => c.payload.kind === "briefing");
    expect(briefing?.payload).toMatchObject({ title: "Daily briefing", url: "/today?from=notification" });
    expect(String(briefing?.payload.body)).toMatch(/overdue .* follow-up/);
    const before = sender.calls.length;
    await dispatch(sender);
    expect(sender.calls.length).toBe(before); // once per day
    await asService(sql, (tx) => tx`update ft.profiles set briefing_enabled = false where id = ${user}`);
  });
});
