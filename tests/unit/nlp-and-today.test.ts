import { describe, expect, it } from "vitest";
import { suggestDates } from "@/lib/domain/nlp";
import { groupForToday, planningGaps, type TaskLike } from "@/lib/domain/today";
import { DEFAULT_PREFS, type Prefs } from "@/lib/domain/types";
import { deadlineInstant, resolveLocal } from "@/lib/domain/time";

const P: Prefs = { ...DEFAULT_PREFS, timezone: "Asia/Kolkata" };
// Monday 26 Oct 2026, 10:00 in Kolkata
const now = new Date("2026-10-26T04:30:00Z");

describe("natural-language date suggestions", () => {
  it("parses 'Follow up with Raj tomorrow at 11 AM' as a follow-up", () => {
    const s = suggestDates("Follow up with Raj tomorrow at 11 AM", now, P)!;
    expect(s).toMatchObject({ field: "follow_up", date: "2026-10-27", time: "11:00", timeDefaulted: false });
  });

  it("parses 'Send proposal next Monday at 4 PM' as a due date", () => {
    const s = suggestDates("Send proposal next Monday at 4 PM", now, P)!;
    expect(s).toMatchObject({ field: "due", date: "2026-11-02", time: "16:00" });
  });

  it("asks which Friday for 'next Friday' said early in the week", () => {
    const s = suggestDates("Call Anita next Friday", now, P)!;
    expect(s.date).toBeNull();
    expect(s.dateChoices?.map((c) => c.value)).toEqual(["2026-10-30", "2026-11-06"]);
  });

  it("asks AM or PM for a bare hour", () => {
    const s = suggestDates("Chase invoice Wednesday at 4", now, P)!;
    expect(s.date).toBe("2026-10-28");
    expect(s.time).toBeNull();
    expect(s.timeChoices?.map((c) => c.value)).toEqual(["16:00", "04:00"]);
    expect(s.timeQuestion).toBe("Did you mean 4 AM or 4 PM?");
  });

  it("asks about ambiguous numeric dates and resolves unambiguous ones", () => {
    expect(suggestDates("Submit report 3/11", now, P)!.dateChoices?.map((c) => c.value)).toEqual([
      "2026-11-03",
      "2027-03-11",
    ]);
    expect(suggestDates("Submit report 25/11", now, P)!.date).toBe("2026-11-25");
  });

  it("understands month names, ISO dates, relative phrases and 'by'", () => {
    expect(suggestDates("Board pack due 3rd November", now, P)!.date).toBe("2026-11-03");
    expect(suggestDates("Renewal Jan 15", now, P)!.date).toBe("2027-01-15");
    expect(suggestDates("Audit 2026-12-01", now, P)!.date).toBe("2026-12-01");
    expect(suggestDates("Check in with Mei in 3 days", now, P)!).toMatchObject({ date: "2026-10-29", time: "10:00", timeDefaulted: true });
    expect(suggestDates("Ping legal in 2 hours", now, P)!).toMatchObject({ date: "2026-10-26", time: "12:00" });
    expect(suggestDates("Send deck by Friday", now, P)!).toMatchObject({ field: "due", date: "2026-10-30" });
    expect(suggestDates("Wrap up EOD", now, P)!).toMatchObject({ date: "2026-10-26", time: "18:00" });
  });

  it("uses today or tomorrow for a time without a date", () => {
    expect(suggestDates("Call Raj at 3pm", now, P)!.date).toBe("2026-10-26");
    expect(suggestDates("Call Raj at 9am", now, P)!.date).toBe("2026-10-27");
  });

  it("returns null when nothing looks like a date", () => {
    expect(suggestDates("Collect documents from Raj", now, P)).toBeNull();
  });
});

function t(over: Partial<TaskLike> & { id: string }): TaskLike {
  return {
    title: over.id,
    status: "next_action",
    priority: "normal",
    contactId: null,
    dueDate: null,
    dueTime: null,
    dueAt: null,
    followUpAt: null,
    createdAt: now,
    deletedAt: null,
    ...over,
  };
}

describe("Today grouping", () => {
  const z = P.timezone;
  const due = (d: string, time: string | null = null) => ({ dueDate: d, dueTime: time, dueAt: deadlineInstant(d, time, z) });

  it("puts each task in exactly one section, most urgent first", () => {
    const tasks = [
      t({ id: "late-deadline", ...due("2026-10-23") }),
      t({ id: "old-follow-up", status: "waiting_on", contactId: "c", followUpAt: resolveLocal("2026-10-24", "11:00", z).instant }),
      // Follows up today AND due today: shows once, under follow-ups.
      t({ id: "fu-today", status: "waiting_on", contactId: "c", followUpAt: resolveLocal("2026-10-26", "11:00", z).instant, ...due("2026-10-26", "17:00") }),
      t({ id: "due-today", ...due("2026-10-26") }),
      t({ id: "waiting-no-date", status: "waiting_on" }),
      t({ id: "soon", followUpAt: resolveLocal("2026-10-28", "11:00", z).instant }),
      t({ id: "important", priority: "high", ...due("2026-11-01") }),
      t({ id: "far", ...due("2026-12-01") }),
      t({ id: "done", status: "completed", ...due("2026-10-20") }),
      t({ id: "inbox", status: "inbox" }),
    ];
    const { sections, counts } = groupForToday(tasks, P, now);
    const ids = (k: keyof typeof sections) => sections[k].map((x) => x.id);
    expect(ids("overdue")).toEqual(["late-deadline", "old-follow-up"]);
    expect(ids("follow_up_today")).toEqual(["fu-today"]);
    expect(ids("due_today")).toEqual(["due-today"]);
    expect(ids("needs_planning")).toEqual(["waiting-no-date"]);
    expect(ids("upcoming")).toEqual(["soon", "important"]);
    expect(counts).toEqual({ overdue: 2, followUpsToday: 1, waitingOn: 3, inbox: 1 });
  });

  it("reports what a waiting task is missing", () => {
    expect(planningGaps(t({ id: "w", status: "waiting_on" }))).toEqual(["No person set", "No follow-up date"]);
    expect(planningGaps(t({ id: "w", status: "waiting_on", contactId: "c", followUpAt: now }))).toEqual([]);
  });
});
