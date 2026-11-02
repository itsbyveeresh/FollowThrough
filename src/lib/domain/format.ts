import { DateTime } from "luxon";
import type { Prefs } from "./types";
import { addDays, diffDays, localDate, toZoned } from "./time";

type DisplayPrefs = Pick<Prefs, "timezone" | "dateStyle" | "timeStyle">;

const DATE_FORMATS: Record<Prefs["dateStyle"], { short: string; withYear: string }> = {
  "d MMM": { short: "d MMM", withYear: "d MMM yyyy" },
  "MMM d": { short: "MMM d", withYear: "MMM d, yyyy" },
  "yyyy-MM-dd": { short: "yyyy-MM-dd", withYear: "yyyy-MM-dd" },
  "dd/MM": { short: "dd/MM", withYear: "dd/MM/yyyy" },
  "MM/dd": { short: "MM/dd", withYear: "MM/dd/yyyy" },
};

/** "11 AM", "11:30 AM" or "11:00" / "23:30". */
export function formatClock(time: string, prefs: Pick<Prefs, "timeStyle">): string {
  const [h, m] = time.split(":").map(Number);
  if (prefs.timeStyle === "24h") return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function formatTimeOf(instant: Date, prefs: DisplayPrefs): string {
  return formatClock(toZoned(instant, prefs.timezone).toFormat("HH:mm"), prefs);
}

/** Calendar date like "Wed 28 Oct" (year added when not the current year). */
export function formatDate(date: string, prefs: DisplayPrefs, now: Date, withWeekday = true): string {
  const dt = DateTime.fromISO(date, { zone: "UTC" });
  const thisYear = toZoned(now, prefs.timezone).year;
  const f = DATE_FORMATS[prefs.dateStyle];
  const body = dt.toFormat(dt.year === thisYear ? f.short : f.withYear);
  return withWeekday ? `${dt.toFormat("ccc")} ${body}` : body;
}

/** "today", "tomorrow", "yesterday", "Wed" (within a week ahead) or a full date. */
export function relativeDay(date: string, prefs: DisplayPrefs, now: Date): string {
  const today = localDate(now, prefs.timezone);
  const d = diffDays(date, today);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  if (d > 1 && d < 7) return DateTime.fromISO(date, { zone: "UTC" }).toFormat("cccc");
  return formatDate(date, prefs, now);
}

export function formatDateTime(instant: Date, prefs: DisplayPrefs, now: Date): string {
  const date = localDate(instant, prefs.timezone);
  return `${formatDate(date, prefs, now)}, ${formatTimeOf(instant, prefs)}`;
}

/** e.g. "today at 11 AM", "tomorrow at 9:30 AM", "Wed 28 Oct at 3 PM". */
export function formatRelativeDateTime(instant: Date, prefs: DisplayPrefs, now: Date): string {
  const date = localDate(instant, prefs.timezone);
  return `${relativeDay(date, prefs, now)} at ${formatTimeOf(instant, prefs)}`;
}

/** Plain label for a follow-up: "Follow up today at 11 AM" / "Follow-up overdue since yesterday at 2 PM". */
export function followUpLabel(at: Date, prefs: DisplayPrefs, now: Date): string {
  const today = localDate(now, prefs.timezone);
  const date = localDate(at, prefs.timezone);
  const when = formatRelativeDateTime(at, prefs, now);
  if (at.getTime() <= now.getTime()) {
    return date === today ? `Follow-up was due ${when}` : `Follow-up overdue since ${when}`;
  }
  return `Follow up ${when}`;
}

/** Plain label for a deadline: "Due Fri 30 Oct, 5 PM", "Due today", "Overdue: was due yesterday". */
export function dueLabel(
  dueDate: string,
  dueTime: string | null,
  dueAt: Date,
  prefs: DisplayPrefs,
  now: Date,
): string {
  const rel = relativeDay(dueDate, prefs, now);
  const time = dueTime ? formatClock(dueTime, prefs) : null;
  const when = time ? `${rel} at ${time}` : rel;
  if (dueAt.getTime() <= now.getTime()) {
    const today = localDate(now, prefs.timezone);
    const days = diffDays(today, dueDate);
    if (days >= 2) return `Overdue by ${days} days (was due ${formatDate(dueDate, prefs, now)})`;
    return `Overdue: was due ${when}`;
  }
  return `Due ${when}`;
}

export function snoozeLabel(until: Date, prefs: DisplayPrefs, now: Date): string {
  return `Reminder snoozed until ${formatRelativeDateTime(until, prefs, now)}`;
}

export function tomorrowDate(now: Date, prefs: DisplayPrefs): string {
  return addDays(localDate(now, prefs.timezone), 1);
}
