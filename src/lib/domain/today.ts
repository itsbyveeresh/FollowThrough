import type { Prefs, TaskPriority, TaskStatus } from "./types";
import { PRIORITY_RANK, isActiveStatus } from "./types";
import { addDays, diffDays, localDate, startOfLocalDay } from "./time";

/** The fields Today / list views need. */
export interface TaskLike {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  contactId: string | null;
  dueDate: string | null;
  dueTime: string | null;
  dueAt: Date | null;
  followUpAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export type TodaySection = "overdue" | "follow_up_today" | "due_today" | "needs_planning" | "upcoming";

export const TODAY_SECTION_TITLES: Record<TodaySection, string> = {
  overdue: "Overdue",
  follow_up_today: "Follow-ups today",
  due_today: "Due today",
  needs_planning: "Needs planning",
  upcoming: "Coming up",
};

export const TODAY_SECTION_HINTS: Record<TodaySection, string> = {
  overdue: "Deadline passed, or a follow-up from an earlier day that hasn't been logged.",
  follow_up_today: "People to chase or actions to take today.",
  due_today: "Work that must be finished today.",
  needs_planning: "Waiting-on items missing a person or a follow-up date.",
  upcoming: "Follow-ups in the next 3 days and important deadlines this week.",
};

function isLive<T extends TaskLike>(t: T): boolean {
  return isActiveStatus(t.status) && !t.deletedAt;
}

export function isDeadlineOverdue(t: TaskLike, now: Date): boolean {
  return isLive(t) && !!t.dueAt && t.dueAt.getTime() <= now.getTime();
}

/** A follow-up from a previous local day that is still set (i.e. not logged / rescheduled). */
export function isFollowUpOverdue(t: TaskLike, now: Date, zone: string): boolean {
  return isLive(t) && !!t.followUpAt && t.followUpAt.getTime() < startOfLocalDay(now, zone).getTime();
}

export function isOverdue(t: TaskLike, now: Date, zone: string): boolean {
  return isDeadlineOverdue(t, now) || isFollowUpOverdue(t, now, zone);
}

/** Reasons a task needs planning (empty = fine). */
export function planningGaps(t: TaskLike): string[] {
  if (!isLive(t) || t.status !== "waiting_on") return [];
  const gaps: string[] = [];
  if (!t.contactId) gaps.push("No person set");
  if (!t.followUpAt) gaps.push("No follow-up date");
  return gaps;
}

export function needsPlanning(t: TaskLike): boolean {
  return planningGaps(t).length > 0;
}

/**
 * Group tasks for the Today screen. Each task appears in exactly one section — the
 * most urgent one that applies — in this order: Overdue, Follow-ups today, Due today,
 * Needs planning, Coming up.
 */
export function groupForToday<T extends TaskLike>(tasks: T[], prefs: Pick<Prefs, "timezone">, now: Date) {
  const zone = prefs.timezone;
  const today = localDate(now, zone);
  const sections: Record<TodaySection, T[]> = {
    overdue: [],
    follow_up_today: [],
    due_today: [],
    needs_planning: [],
    upcoming: [],
  };
  for (const t of tasks) {
    if (!isLive(t)) continue;
    const fuDate = t.followUpAt ? localDate(t.followUpAt, zone) : null;
    if (isOverdue(t, now, zone)) sections.overdue.push(t);
    else if (fuDate === today) sections.follow_up_today.push(t);
    else if (t.dueDate === today) sections.due_today.push(t);
    else if (needsPlanning(t)) sections.needs_planning.push(t);
    else if (isUpcoming(t, today, zone)) sections.upcoming.push(t);
  }
  const byInstant = (pick: (t: T) => Date | null) => (a: T, b: T) =>
    (pick(a)?.getTime() ?? Infinity) - (pick(b)?.getTime() ?? Infinity) ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  sections.overdue.sort(byInstant((t) => earliest(t.dueAt, t.followUpAt)));
  sections.follow_up_today.sort(byInstant((t) => t.followUpAt));
  sections.due_today.sort(byInstant((t) => t.dueAt));
  sections.needs_planning.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  sections.upcoming.sort(byInstant((t) => earliest(t.dueAt, t.followUpAt)));

  const live = tasks.filter(isLive);
  const counts = {
    overdue: sections.overdue.length,
    followUpsToday: sections.follow_up_today.length,
    waitingOn: live.filter((t) => t.status === "waiting_on").length,
    inbox: live.filter((t) => t.status === "inbox").length,
  };
  return { sections, counts, today };
}

function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

function isUpcoming(t: TaskLike, today: string, zone: string): boolean {
  if (t.followUpAt) {
    const d = diffDays(localDate(t.followUpAt, zone), today);
    if (d > 0 && d <= 3) return true;
  }
  if (t.dueDate) {
    const d = diffDays(t.dueDate, today);
    if (d > 0 && d <= 2) return true;
    if (d > 0 && d <= 7 && (t.priority === "high" || t.priority === "urgent")) return true;
  }
  return false;
}

/** Window used by the daily briefing for "important upcoming deadlines". */
export function importantUpcoming<T extends TaskLike>(tasks: T[], zone: string, now: Date): T[] {
  const today = localDate(now, zone);
  const limit = addDays(today, 3);
  return tasks.filter(
    (t) =>
      isLive(t) &&
      t.dueDate !== null &&
      t.dueDate >= today &&
      t.dueDate <= limit &&
      !isDeadlineOverdue(t, now) &&
      (t.priority === "high" || t.priority === "urgent"),
  );
}
