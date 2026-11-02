import type { Prefs, ReminderKind } from "@/lib/domain/types";
import { formatRelativeDateTime } from "@/lib/domain/format";

/** What the service worker receives. Kept small (push payloads are limited to ~4 KB). */
export interface NotificationPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  reminderId: string;
  kind: ReminderKind;
}

export interface ContentInput {
  reminderId: string;
  kind: ReminderKind;
  scheduledFor: Date;
  task?: { id: string; title: string; clientName: string | null; contactName: string | null } | null;
  briefing?: { overdue: number; followUpsToday: number; importantSoon: number } | null;
  missedCount?: number;
}

const DISCREET: Record<ReminderKind, string> = {
  follow_up: "You have a follow-up due.",
  repeat: "You have a follow-up that is still open.",
  deadline: "You have a deadline coming up.",
  snooze: "A snoozed reminder is due.",
  briefing: "Your daily briefing is ready.",
  catch_up: "Some reminders could not be sent on time. Open FollowThrough to review.",
  test: "Test notification from FollowThrough. If you can see this, reminders reach this device.",
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Build notification text. Lock-screen content is discreet by default; task and
 * client details are only included when the user opted into "detailed".
 * Tapping opens the task (or Today for summaries) — never completes anything.
 */
export function notificationContent(input: ContentInput, prefs: Prefs, now: Date): NotificationPayload {
  const detailed = prefs.notificationDetail === "detailed";
  const base = { reminderId: input.reminderId, kind: input.kind, tag: `ft-${input.reminderId}` };
  if (input.kind === "briefing") {
    const b = input.briefing ?? { overdue: 0, followUpsToday: 0, importantSoon: 0 };
    const parts = [
      plural(b.overdue, "overdue item", "overdue items"),
      plural(b.followUpsToday, "follow-up today", "follow-ups today"),
      plural(b.importantSoon, "important deadline soon", "important deadlines soon"),
    ];
    return { ...base, title: "Daily briefing", body: parts.join(" · "), url: "/today?from=notification" };
  }
  if (input.kind === "catch_up") {
    const n = input.missedCount;
    return {
      ...base,
      title: "FollowThrough",
      body: n ? `${plural(n, "reminder", "reminders")} could not be sent on time. Open Today to review.` : DISCREET.catch_up,
      url: "/today?from=notification",
    };
  }
  if (input.kind === "test") {
    return { ...base, title: "FollowThrough", body: DISCREET.test, url: `/settings/notifications?test=${input.reminderId}` };
  }
  const url = input.task ? `/tasks/${input.task.id}?from=notification` : "/today?from=notification";
  if (!detailed || !input.task) return { ...base, title: "FollowThrough", body: DISCREET[input.kind], url };

  const who = [input.task.contactName, input.task.clientName].filter(Boolean).join(" · ");
  const when = formatRelativeDateTime(input.scheduledFor, prefs, now);
  const title =
    input.kind === "deadline" ? `Deadline: ${input.task.title}` : `Follow up: ${input.task.title}`;
  const body = [who, input.kind === "deadline" ? `Reminder for ${when}` : `Scheduled ${when}`].filter(Boolean).join(" — ");
  return { ...base, title: title.slice(0, 120), body: body.slice(0, 240), url };
}
