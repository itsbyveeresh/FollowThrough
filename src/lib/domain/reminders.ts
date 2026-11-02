import type { Prefs, ReminderKind, TaskSchedule } from "./types";
import { isActiveStatus } from "./types";
import { addDays, localDate, localTime, minutesOf, resolveLocal, weekdayOf } from "./time";

/**
 * Reminder rules
 * --------------
 * follow_up  At the task's next follow-up instant (if the task's follow-up reminder is on).
 * deadline   Before a deadline (if enabled): N minutes before a timed deadline, or for a
 *            date-only deadline at the user's "date-only reminder time" on the due date
 *            (or N whole days earlier when the offset is >= 1 day). Never at midnight.
 * snooze     A one-off reminder at the snooze time. Snoozing never changes the task's
 *            deadline or follow-up; it suppresses this task's reminders until then.
 * repeat     Optional (off by default). After a follow-up reminder has been sent and the
 *            task is still unresolved and not rescheduled, remind again the next day at
 *            the same local time, at most `repeatMaxPerTask` times.
 * briefing   Optional daily summary at a chosen local time (working days only by default).
 * catch_up   One summary sent after reminders were missed (e.g. scheduler outage).
 *
 * Quiet hours defer every kind except "test" to the next allowed local time
 * (urgent tasks may bypass if the user opts in). The task's dates never change.
 *
 * Stale policy: a reminder that could not be sent within STALE_MINUTES of the time it
 * became eligible is marked "missed" instead of being sent late; the affected tasks stay
 * visible on Today and one catch-up summary is sent.
 */

export const STALE_MINUTES: Record<ReminderKind, number> = {
  follow_up: 60,
  deadline: 60,
  snooze: 60,
  repeat: 60,
  briefing: 90,
  catch_up: 60,
  test: 10,
};

export interface PlannedReminder {
  kind: ReminderKind;
  occurrenceKey: string;
  taskId: string | null;
  taskVersion: number | null;
  repeatIndex: number;
  scheduledFor: Date;
  availableAt: Date;
  staleAfter: Date;
  deferredReason: "quiet_hours" | null;
}

/** Is the instant inside quiet hours? Handles windows that cross midnight. */
export function isQuietTime(instant: Date, prefs: Prefs): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const m = minutesOf(localTime(instant, prefs.timezone));
  const start = minutesOf(prefs.quietStart);
  const end = minutesOf(prefs.quietEnd);
  if (start === end) return false;
  return start < end ? m >= start && m < end : m >= start || m < end;
}

/** First instant >= `instant` that is outside quiet hours. */
export function nextAllowedTime(instant: Date, prefs: Prefs): Date {
  if (!isQuietTime(instant, prefs)) return instant;
  const date = localDate(instant, prefs.timezone);
  const m = minutesOf(localTime(instant, prefs.timezone));
  const start = minutesOf(prefs.quietStart);
  const end = minutesOf(prefs.quietEnd);
  // Window crossing midnight and we are in the evening part => ends tomorrow.
  const endDate = start > end && m >= start ? addDays(date, 1) : date;
  const resolved = resolveLocal(endDate, prefs.quietEnd, prefs.timezone).instant;
  return resolved.getTime() > instant.getTime() ? resolved : instant;
}

function withDelivery(
  base: Omit<PlannedReminder, "availableAt" | "staleAfter" | "deferredReason">,
  prefs: Prefs,
  bypassQuiet: boolean,
): PlannedReminder {
  const availableAt = bypassQuiet ? base.scheduledFor : nextAllowedTime(base.scheduledFor, prefs);
  const deferred = availableAt.getTime() !== base.scheduledFor.getTime();
  return {
    ...base,
    availableAt,
    staleAfter: new Date(availableAt.getTime() + STALE_MINUTES[base.kind] * 60_000),
    deferredReason: deferred ? "quiet_hours" : null,
  };
}

function bypassesQuiet(task: Pick<TaskSchedule, "priority">, prefs: Prefs): boolean {
  return prefs.urgentBypassesQuiet && task.priority === "urgent";
}

/** When should the deadline reminder fire? null if none applies. */
export function deadlineReminderTime(task: TaskSchedule, prefs: Prefs): Date | null {
  if (task.deadlineReminderMinutes == null || !task.dueDate) return null;
  if (task.dueTime) {
    const due = task.dueAt ?? resolveLocal(task.dueDate, task.dueTime, prefs.timezone).instant;
    return new Date(due.getTime() - task.deadlineReminderMinutes * 60_000);
  }
  // Date-only: on the due date (or whole days before) at the configured time.
  const daysBefore = Math.floor(task.deadlineReminderMinutes / 1440);
  return resolveLocal(addDays(task.dueDate, -daysBefore), prefs.dateOnlyReminderTime, prefs.timezone).instant;
}

/**
 * Plan the reminder occurrences a task should currently have. The caller cancels
 * pending occurrences from older schedule versions and inserts these.
 */
export function planTaskReminders(task: TaskSchedule, prefs: Prefs, now: Date): PlannedReminder[] {
  if (!isActiveStatus(task.status) || task.deletedAt) return [];
  const out: PlannedReminder[] = [];
  const bypass = bypassesQuiet(task, prefs);
  const graceMs = 60_000; // a follow-up set for "right now" still fires

  if (task.followUpAt && task.followUpReminder && task.followUpAt.getTime() > now.getTime() - graceMs) {
    out.push(
      withDelivery(
        {
          kind: "follow_up",
          occurrenceKey: `follow_up:${task.id}:v${task.scheduleVersion}`,
          taskId: task.id,
          taskVersion: task.scheduleVersion,
          repeatIndex: 0,
          scheduledFor: task.followUpAt,
        },
        prefs,
        bypass,
      ),
    );
  }

  const dl = deadlineReminderTime(task, prefs);
  if (dl && dl.getTime() > now.getTime() - graceMs) {
    const sameAsFollowUp = out.some((r) => Math.abs(r.scheduledFor.getTime() - dl.getTime()) < 60_000);
    if (!sameAsFollowUp) {
      out.push(
        withDelivery(
          {
            kind: "deadline",
            occurrenceKey: `deadline:${task.id}:v${task.scheduleVersion}`,
            taskId: task.id,
            taskVersion: task.scheduleVersion,
            repeatIndex: 0,
            scheduledFor: dl,
          },
          prefs,
          bypass,
        ),
      );
    }
  }

  // While snoozed, the snooze reminder replaces anything due before it.
  if (task.snoozedUntil && task.snoozedUntil.getTime() > now.getTime()) {
    const until = task.snoozedUntil.getTime();
    return out.filter((r) => r.availableAt.getTime() >= until);
  }
  return out;
}

export type SnoozeOption = "15m" | "1h" | "tomorrow_morning" | "custom";

/** Target instant for a snooze choice. "Tomorrow morning" = start of working hours tomorrow. */
export function snoozeTarget(option: SnoozeOption, now: Date, prefs: Prefs, custom?: Date): Date {
  switch (option) {
    case "15m":
      return new Date(now.getTime() + 15 * 60_000);
    case "1h":
      return new Date(now.getTime() + 60 * 60_000);
    case "tomorrow_morning":
      return resolveLocal(addDays(localDate(now, prefs.timezone), 1), prefs.workStart, prefs.timezone).instant;
    case "custom":
      if (!custom || custom.getTime() <= now.getTime()) throw new Error("Snooze time must be in the future");
      return custom;
  }
}

export function planSnooze(task: TaskSchedule, until: Date, prefs: Prefs): PlannedReminder {
  return withDelivery(
    {
      kind: "snooze",
      occurrenceKey: `snooze:${task.id}:v${task.scheduleVersion}:${until.getTime()}`,
      taskId: task.id,
      taskVersion: task.scheduleVersion,
      repeatIndex: 0,
      scheduledFor: until,
    },
    prefs,
    bypassesQuiet(task, prefs),
  );
}

/**
 * Next daily repeat of an unresolved follow-up, or null when repeats are off, the
 * limit is reached, or the task is no longer actionable. Repeats keep the original
 * local time of day and never fire twice on the same local day.
 */
export function planNextRepeat(
  task: TaskSchedule,
  prefs: Prefs,
  previousIndex: number,
  now: Date,
): PlannedReminder | null {
  if (!task.repeatDaily || !task.followUpAt || !task.followUpReminder) return null;
  if (!isActiveStatus(task.status) || task.deletedAt) return null;
  const index = previousIndex + 1;
  if (index > prefs.repeatMaxPerTask) return null;
  const time = localTime(task.followUpAt, prefs.timezone);
  let date = addDays(localDate(task.followUpAt, prefs.timezone), index);
  const today = localDate(now, prefs.timezone);
  if (date <= today) date = addDays(today, 1);
  return withDelivery(
    {
      kind: "repeat",
      occurrenceKey: `repeat:${task.id}:v${task.scheduleVersion}:${index}`,
      taskId: task.id,
      taskVersion: task.scheduleVersion,
      repeatIndex: index,
      scheduledFor: resolveLocal(date, time, prefs.timezone).instant,
    },
    prefs,
    bypassesQuiet(task, prefs),
  );
}

/**
 * The briefing occurrence that should exist now: today's if it is still fresh
 * (not past its stale window), otherwise the next eligible day's.
 */
export function planBriefing(prefs: Prefs, now: Date): PlannedReminder | null {
  if (!prefs.briefingEnabled) return null;
  const today = localDate(now, prefs.timezone);
  for (let i = 0; i <= 8; i++) {
    const date = addDays(today, i);
    if (prefs.briefingWorkingDaysOnly && !prefs.workingDays.includes(weekdayOf(date))) continue;
    const at = resolveLocal(date, prefs.briefingTime, prefs.timezone).instant;
    const planned = withDelivery(
      {
        kind: "briefing",
        occurrenceKey: `briefing:${date}`,
        taskId: null,
        taskVersion: null,
        repeatIndex: 0,
        scheduledFor: at,
      },
      prefs,
      false,
    );
    if (planned.staleAfter.getTime() > now.getTime()) return planned;
  }
  return null;
}
