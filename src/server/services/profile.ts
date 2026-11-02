import type { Tx } from "../db";
import { planBriefing } from "@/lib/domain/reminders";
import { deadlineInstant } from "@/lib/domain/time";
import { settingsSchema, fieldErrors, type SettingsInput } from "@/lib/validation";
import { toProfileView, toTaskView, UserError, type ProfileView } from "./model";
import { insertPlanned, resyncTaskReminders } from "./reminder-sync";

export async function getProfile(tx: Tx, userId: string): Promise<ProfileView> {
  let rows = await tx`select * from ft.profiles where id = ${userId}`;
  if (!rows.length) {
    await tx`select ft.ensure_profile()`;
    rows = await tx`select * from ft.profiles where id = ${userId}`;
  }
  if (!rows.length) throw new UserError("Profile not found", undefined, "not_found");
  return toProfileView(rows[0]);
}

/** Fields whose change requires re-planning task reminders. */
const SCHEDULE_FIELDS: (keyof SettingsInput)[] = [
  "timezone",
  "quietHoursEnabled",
  "quietStart",
  "quietEnd",
  "urgentBypassesQuiet",
  "dateOnlyReminderTime",
  "workStart",
];

/**
 * Save settings. When anything that affects reminder times changes, every active
 * task is re-planned in the same transaction: deadlines keep their wall-clock
 * date/time (re-anchored to the new time zone), follow-ups keep their exact
 * instant, and pending reminders are replaced.
 */
export async function updateSettings(tx: Tx, userId: string, raw: unknown, now: Date): Promise<ProfileView> {
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) throw new UserError("Please fix the highlighted settings.", fieldErrors(parsed.error));
  const v = parsed.data;
  const before = await getProfile(tx, userId);

  const rows = await tx`
    update ft.profiles set
      display_name = ${v.displayName}, timezone = ${v.timezone}, date_style = ${v.dateStyle}, time_style = ${v.timeStyle},
      working_days = ${v.workingDays}::smallint[], work_start = ${v.workStart}, work_end = ${v.workEnd},
      quiet_hours_enabled = ${v.quietHoursEnabled}, quiet_start = ${v.quietStart}, quiet_end = ${v.quietEnd},
      urgent_bypasses_quiet = ${v.urgentBypassesQuiet}, date_only_reminder_time = ${v.dateOnlyReminderTime},
      default_follow_up_time = ${v.defaultFollowUpTime}, default_follow_up_reminder = ${v.defaultFollowUpReminder},
      default_deadline_reminder_minutes = ${v.defaultDeadlineReminderMinutes}, repeat_max_per_task = ${v.repeatMaxPerTask},
      briefing_enabled = ${v.briefingEnabled}, briefing_time = ${v.briefingTime},
      briefing_working_days_only = ${v.briefingWorkingDaysOnly}, notification_detail = ${v.notificationDetail}
    where id = ${userId}
    returning *`;
  const after = toProfileView(rows[0]);

  const scheduleChanged = SCHEDULE_FIELDS.some((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (scheduleChanged) {
    const tasks = await tx`
      select * from ft.tasks
       where user_id = ${userId} and deleted_at is null
         and status in ('inbox', 'next_action', 'in_progress', 'waiting_on')
       for update`;
    for (const r of tasks) {
      const t = toTaskView(r);
      const dueAt = t.dueDate ? deadlineInstant(t.dueDate, t.dueTime, after.timezone) : null;
      const updated = await tx`
        update ft.tasks set due_at = ${dueAt}, schedule_version = schedule_version + 1
         where id = ${t.id} returning *`;
      await resyncTaskReminders(tx, userId, toTaskView(updated[0]), after, now);
    }
  }

  const briefingChanged =
    before.briefingEnabled !== after.briefingEnabled ||
    before.briefingTime !== after.briefingTime ||
    before.briefingWorkingDaysOnly !== after.briefingWorkingDaysOnly ||
    JSON.stringify(before.workingDays) !== JSON.stringify(after.workingDays) ||
    scheduleChanged;
  if (briefingChanged) {
    await tx`
      update ft.reminders set status = 'cancelled', status_reason = 'settings_changed', finished_at = ${now}
       where user_id = ${userId} and kind = 'briefing' and status = 'pending'`;
    const plan = planBriefing(after, now);
    if (plan && !after.isDemo) await insertPlanned(tx, userId, [plan]);
  }
  return after;
}
