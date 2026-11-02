import { describe, expect, it } from "vitest";
import { deadlineInstant, resolveLocal, resolveLocalDateTime } from "@/lib/domain/time";
import {
  isQuietTime,
  nextAllowedTime,
  planBriefing,
  planNextRepeat,
  planSnooze,
  planTaskReminders,
  snoozeTarget,
} from "@/lib/domain/reminders";
import { DEFAULT_PREFS, type Prefs, type TaskSchedule } from "@/lib/domain/types";
import { dueLabel, followUpLabel } from "@/lib/domain/format";

const NY: Prefs = { ...DEFAULT_PREFS, timezone: "America/New_York", quietStart: "21:00", quietEnd: "07:30" };
const iso = (s: string) => new Date(s);

function task(over: Partial<TaskSchedule> = {}): TaskSchedule {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    status: "waiting_on",
    priority: "normal",
    dueDate: null,
    dueTime: null,
    dueAt: null,
    followUpAt: null,
    followUpReminder: true,
    deadlineReminderMinutes: null,
    repeatDaily: false,
    snoozedUntil: null,
    scheduleVersion: 1,
    deletedAt: null,
    ...over,
  };
}

describe("local time conversion", () => {
  it("converts wall-clock time in a zone to UTC", () => {
    expect(resolveLocal("2026-10-28", "11:00", "America/New_York").instant.toISOString()).toBe("2026-10-28T15:00:00.000Z");
    expect(resolveLocal("2026-10-28", "11:00", "Asia/Kolkata").instant.toISOString()).toBe("2026-10-28T05:30:00.000Z");
  });

  it("shifts nonexistent spring-forward times forward by the gap", () => {
    const r = resolveLocal("2026-03-08", "02:30", "America/New_York");
    expect(r.adjustment).toBe("shifted_forward");
    expect(r.instant.toISOString()).toBe("2026-03-08T07:30:00.000Z"); // 03:30 EDT
  });

  it("resolves ambiguous fall-back times to the earlier instant", () => {
    const r = resolveLocal("2026-11-01", "01:30", "America/New_York");
    expect(r.adjustment).toBe("ambiguous_earlier");
    expect(r.instant.toISOString()).toBe("2026-11-01T05:30:00.000Z"); // 01:30 EDT, not EST
  });

  it("handles Europe DST (London last Sunday of October)", () => {
    expect(resolveLocal("2026-10-24", "09:00", "Europe/London").instant.toISOString()).toBe("2026-10-24T08:00:00.000Z");
    expect(resolveLocal("2026-10-26", "09:00", "Europe/London").instant.toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });

  it("parses local date-times", () => {
    expect(resolveLocalDateTime("2026-12-01T16:00", "Europe/Berlin").instant.toISOString()).toBe("2026-12-01T15:00:00.000Z");
  });

  it("treats date-only deadlines as passing at the end of the local day, not midnight at the start", () => {
    expect(deadlineInstant("2026-10-30", null, "America/New_York").toISOString()).toBe("2026-10-31T04:00:00.000Z");
  });
});

describe("quiet hours", () => {
  it("detects quiet time across midnight", () => {
    expect(isQuietTime(iso("2026-10-27T02:00:00Z"), NY)).toBe(true); // 22:00 NY
    expect(isQuietTime(iso("2026-10-27T09:00:00Z"), NY)).toBe(true); // 05:00 NY
    expect(isQuietTime(iso("2026-10-27T12:00:00Z"), NY)).toBe(false); // 08:00 NY
  });

  it("defers evening reminders to the next morning and early-morning ones to the same morning", () => {
    expect(nextAllowedTime(iso("2026-10-27T02:00:00Z"), NY).toISOString()).toBe("2026-10-27T11:30:00.000Z"); // 07:30 next day
    expect(nextAllowedTime(iso("2026-10-27T09:00:00Z"), NY).toISOString()).toBe("2026-10-27T11:30:00.000Z"); // 07:30 same day
    const open = iso("2026-10-27T14:00:00Z");
    expect(nextAllowedTime(open, NY)).toBe(open);
  });

  it("supports a same-day quiet window", () => {
    const lunch: Prefs = { ...NY, quietStart: "12:00", quietEnd: "13:00" };
    expect(nextAllowedTime(iso("2026-10-27T16:30:00Z"), lunch).toISOString()).toBe("2026-10-27T17:00:00.000Z");
  });

  it("does nothing when disabled", () => {
    const off: Prefs = { ...NY, quietHoursEnabled: false };
    expect(isQuietTime(iso("2026-10-27T02:00:00Z"), off)).toBe(false);
  });

  it("uses the post-transition offset when quiet hours end on a DST change day", () => {
    // 2026-11-01 NY falls back at 02:00. Quiet ends 07:30 EST = 12:30Z.
    expect(nextAllowedTime(iso("2026-11-01T04:00:00Z"), NY).toISOString()).toBe("2026-11-01T12:30:00.000Z");
  });
});

describe("reminder planning", () => {
  const now = iso("2026-10-26T14:00:00Z"); // Mon 10:00 NY

  it("plans a follow-up reminder at the follow-up time", () => {
    const fu = iso("2026-10-28T15:00:00Z");
    const plans = planTaskReminders(task({ followUpAt: fu }), NY, now);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ kind: "follow_up", occurrenceKey: expect.stringContaining(":v1") });
    expect(plans[0].scheduledFor).toEqual(fu);
    expect(plans[0].availableAt).toEqual(fu);
  });

  it("plans nothing for completed, cancelled or deleted tasks", () => {
    const fu = iso("2026-10-28T15:00:00Z");
    expect(planTaskReminders(task({ followUpAt: fu, status: "completed" }), NY, now)).toEqual([]);
    expect(planTaskReminders(task({ followUpAt: fu, status: "cancelled" }), NY, now)).toEqual([]);
    expect(planTaskReminders(task({ followUpAt: fu, deletedAt: now }), NY, now)).toEqual([]);
  });

  it("respects the follow-up reminder toggle", () => {
    expect(planTaskReminders(task({ followUpAt: iso("2026-10-28T15:00:00Z"), followUpReminder: false }), NY, now)).toEqual([]);
  });

  it("plans a reminder before a timed deadline", () => {
    const dueAt = resolveLocal("2026-10-30", "17:00", NY.timezone).instant;
    const plans = planTaskReminders(
      task({ dueDate: "2026-10-30", dueTime: "17:00", dueAt, deadlineReminderMinutes: 60 }),
      NY,
      now,
    );
    expect(plans.map((p) => p.kind)).toEqual(["deadline"]);
    expect(plans[0].scheduledFor.toISOString()).toBe("2026-10-30T20:00:00.000Z"); // 16:00 NY
  });

  it("uses the configured reminder time for date-only deadlines (never midnight)", () => {
    const p: Prefs = { ...NY, dateOnlyReminderTime: "08:15" };
    const t = task({ dueDate: "2026-10-30", dueAt: deadlineInstant("2026-10-30", null, p.timezone), deadlineReminderMinutes: 0 });
    expect(planTaskReminders(t, p, now)[0].scheduledFor.toISOString()).toBe("2026-10-30T12:15:00.000Z");
    const dayBefore = { ...t, deadlineReminderMinutes: 1440 };
    expect(planTaskReminders(dayBefore, p, now)[0].scheduledFor.toISOString()).toBe("2026-10-29T12:15:00.000Z");
  });

  it("defers reminders in quiet hours without touching the scheduled time", () => {
    const fu = iso("2026-10-28T02:30:00Z"); // 22:30 NY
    const [r] = planTaskReminders(task({ followUpAt: fu }), NY, now);
    expect(r.scheduledFor).toEqual(fu);
    expect(r.availableAt.toISOString()).toBe("2026-10-28T11:30:00.000Z");
    expect(r.deferredReason).toBe("quiet_hours");
  });

  it("lets urgent tasks bypass quiet hours only when opted in", () => {
    const fu = iso("2026-10-28T02:30:00Z");
    const urgent = task({ followUpAt: fu, priority: "urgent" });
    expect(planTaskReminders(urgent, NY, now)[0].deferredReason).toBe("quiet_hours");
    expect(planTaskReminders(urgent, { ...NY, urgentBypassesQuiet: true }, now)[0].availableAt).toEqual(fu);
  });

  it("does not plan reminders for times already in the past", () => {
    expect(planTaskReminders(task({ followUpAt: iso("2026-10-26T12:00:00Z") }), NY, now)).toEqual([]);
  });

  it("uses a new occurrence key per schedule version", () => {
    const fu = iso("2026-10-28T15:00:00Z");
    const a = planTaskReminders(task({ followUpAt: fu, scheduleVersion: 1 }), NY, now)[0];
    const b = planTaskReminders(task({ followUpAt: fu, scheduleVersion: 2 }), NY, now)[0];
    expect(a.occurrenceKey).not.toBe(b.occurrenceKey);
  });
});

describe("snooze", () => {
  const now = iso("2026-10-26T14:00:00Z"); // Mon 10:00 NY

  it("computes snooze targets", () => {
    expect(snoozeTarget("15m", now, NY).toISOString()).toBe("2026-10-26T14:15:00.000Z");
    expect(snoozeTarget("1h", now, NY).toISOString()).toBe("2026-10-26T15:00:00.000Z");
    expect(snoozeTarget("tomorrow_morning", now, NY).toISOString()).toBe("2026-10-27T13:00:00.000Z"); // 09:00 NY
    expect(() => snoozeTarget("custom", now, NY, iso("2026-10-26T13:00:00Z"))).toThrow();
  });

  it("creates a snooze reminder and leaves the task's dates alone", () => {
    const t = task({ followUpAt: iso("2026-10-26T14:30:00Z"), dueDate: "2026-10-30", dueTime: "17:00" });
    const until = snoozeTarget("1h", now, NY);
    const r = planSnooze(t, until, NY);
    expect(r.kind).toBe("snooze");
    expect(r.scheduledFor).toEqual(until);
    expect(t.followUpAt?.toISOString()).toBe("2026-10-26T14:30:00.000Z");
    expect(t.dueDate).toBe("2026-10-30");
  });

  it("suppresses reminders that fall before an active snooze", () => {
    const t = task({ followUpAt: iso("2026-10-26T14:30:00Z"), snoozedUntil: iso("2026-10-26T15:00:00Z") });
    expect(planTaskReminders(t, NY, now)).toEqual([]);
  });
});

describe("daily repeats", () => {
  const fu = iso("2026-10-26T15:00:00Z"); // Mon 11:00 NY

  it("is off by default", () => {
    expect(planNextRepeat(task({ followUpAt: fu }), NY, 0, iso("2026-10-26T15:01:00Z"))).toBeNull();
  });

  it("repeats next day at the same local time, across DST, up to the limit", () => {
    const t = task({ followUpAt: iso("2026-10-31T15:00:00Z"), repeatDaily: true }); // Sat 11:00 EDT
    const r1 = planNextRepeat(t, NY, 0, iso("2026-10-31T15:01:00Z"))!;
    expect(r1.scheduledFor.toISOString()).toBe("2026-11-01T16:00:00.000Z"); // Sun 11:00 EST
    expect(r1.repeatIndex).toBe(1);
    expect(planNextRepeat(t, { ...NY, repeatMaxPerTask: 1 }, 1, iso("2026-11-01T16:01:00Z"))).toBeNull();
  });

  it("stops for completed tasks", () => {
    expect(planNextRepeat(task({ followUpAt: fu, repeatDaily: true, status: "completed" }), NY, 0, fu)).toBeNull();
  });
});

describe("daily briefing", () => {
  it("plans today's briefing if still fresh, else the next working day", () => {
    const p: Prefs = { ...NY, briefingEnabled: true, briefingTime: "08:30" };
    const early = planBriefing(p, iso("2026-10-26T11:00:00Z"))!; // Mon 07:00
    expect(early.occurrenceKey).toBe("briefing:2026-10-26");
    const late = planBriefing(p, iso("2026-10-30T18:00:00Z"))!; // Fri 14:00 -> Mon
    expect(late.occurrenceKey).toBe("briefing:2026-11-02");
    expect(planBriefing({ ...p, briefingEnabled: false }, iso("2026-10-26T11:00:00Z"))).toBeNull();
  });
});

describe("plain labels", () => {
  const now = iso("2026-10-26T14:00:00Z"); // Mon 10:00 NY

  it("labels follow-ups", () => {
    expect(followUpLabel(iso("2026-10-26T15:00:00Z"), NY, now)).toBe("Follow up today at 11 AM");
    expect(followUpLabel(iso("2026-10-27T13:30:00Z"), NY, now)).toBe("Follow up tomorrow at 9:30 AM");
    expect(followUpLabel(iso("2026-10-28T15:00:00Z"), NY, now)).toBe("Follow up Wednesday at 11 AM");
    expect(followUpLabel(iso("2026-10-25T18:00:00Z"), NY, now)).toBe("Follow-up overdue since yesterday at 2 PM");
  });

  it("labels deadlines", () => {
    const fri = resolveLocal("2026-10-30", "17:00", NY.timezone).instant;
    expect(dueLabel("2026-10-30", "17:00", fri, NY, now)).toBe("Due Friday at 5 PM");
    expect(dueLabel("2026-10-26", null, deadlineInstant("2026-10-26", null, NY.timezone), NY, now)).toBe("Due today");
    expect(dueLabel("2026-10-22", null, deadlineInstant("2026-10-22", null, NY.timezone), NY, now)).toBe(
      "Overdue by 4 days (was due Thu 22 Oct)",
    );
  });
});
