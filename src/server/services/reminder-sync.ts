import type { Tx } from "../db";
import type { PlannedReminder } from "@/lib/domain/reminders";
import { planTaskReminders } from "@/lib/domain/reminders";
import { isActiveStatus, type Prefs } from "@/lib/domain/types";
import { toSchedule, type TaskView } from "./model";

export async function insertPlanned(tx: Tx, userId: string, plans: PlannedReminder[]): Promise<number> {
  let inserted = 0;
  for (const p of plans) {
    const rows = await tx`
      insert into ft.reminders (user_id, task_id, kind, occurrence_key, task_version, repeat_index,
                                scheduled_for, available_at, stale_after, deferred_reason)
      values (${userId}, ${p.taskId}, ${p.kind}, ${p.occurrenceKey}, ${p.taskVersion}, ${p.repeatIndex},
              ${p.scheduledFor}, ${p.availableAt}, ${p.staleAfter}, ${p.deferredReason})
      on conflict (user_id, occurrence_key) where status <> 'cancelled' do nothing
      returning id`;
    inserted += rows.length;
  }
  return inserted;
}

/**
 * Bring a task's pending reminders in line with its current state: cancel any
 * pending occurrence planned for an older schedule version (or every pending one
 * if the task is no longer active), then insert the current plan. Runs inside the
 * same transaction as the task change, so the two never disagree.
 */
export async function resyncTaskReminders(tx: Tx, userId: string, task: TaskView, prefs: Prefs, now: Date) {
  const plans = planTaskReminders(toSchedule(task), prefs, now);
  const inactive = !!task.deletedAt || !isActiveStatus(task.status);
  const reason = task.deletedAt
    ? "task_deleted"
    : task.status === "completed"
      ? "task_completed"
      : task.status === "cancelled"
        ? "task_cancelled"
        : "task_changed";
  await tx`
    update ft.reminders
       set status = 'cancelled', status_reason = ${reason}, finished_at = ${now}
     where task_id = ${task.id}
       and status = 'pending'
       and (${inactive} or task_version is distinct from ${task.scheduleVersion})`;
  await insertPlanned(tx, userId, plans);
}
