import type { Tx } from "../db";
import { pgErrorCode, pgErrorMessage } from "../db";
import { planSnooze, snoozeTarget, type SnoozeOption } from "@/lib/domain/reminders";
import { deadlineInstant, resolveLocalDateTime, startOfLocalDay, type LocalAdjustment } from "@/lib/domain/time";
import { isActiveStatus, type Prefs, type TaskStatus } from "@/lib/domain/types";
import {
  createTaskSchema,
  fieldErrors,
  logFollowUpSchema,
  noteSchema,
  snoozeSchema,
  updateTaskSchema,
  type UpdateTaskInput,
} from "@/lib/validation";
import { toReminderView, toSchedule, toTaskView, UserError, type ActivityView, type ReminderView, type TaskView } from "./model";
import { insertPlanned, resyncTaskReminders } from "./reminder-sync";
import { getProfile } from "./profile";

export const TASK_SELECT = `
  select t.*, c.name as client_name, p.name as project_name, k.name as contact_name
    from ft.tasks t
    left join ft.clients c on c.id = t.client_id
    left join ft.projects p on p.id = t.project_id
    left join ft.contacts k on k.id = t.contact_id`;

export interface SaveResult {
  task: TaskView;
  notices: string[];
}

function adjustmentNotice(adj: LocalAdjustment, what: string): string | null {
  if (adj === "shifted_forward")
    return `The ${what} time doesn't exist on that day because clocks move forward, so it was moved to the first valid time after it.`;
  if (adj === "ambiguous_earlier")
    return `The ${what} time happens twice that day because clocks move back; the first occurrence was used.`;
  return null;
}

/** Translate database errors into safe, user-facing messages. */
function mapDbError(e: unknown): never {
  const code = pgErrorCode(e);
  const msg = pgErrorMessage(e) ?? "";
  if (msg.includes("project_client_mismatch"))
    throw new UserError("That project belongs to a different client.", { projectId: "Choose a project for this client" });
  if (code === "23503") throw new UserError("A selected client, project or person no longer exists.", undefined, "not_found");
  if (code === "23514" || code === "22001") throw new UserError("Some values are invalid or too long.");
  throw e;
}

export async function getTask(tx: Tx, taskId: string): Promise<TaskView | null> {
  const rows = await tx.unsafe(`${TASK_SELECT} where t.id = $1`, [taskId]);
  return rows.length ? toTaskView(rows[0]) : null;
}

async function lockTask(tx: Tx, taskId: string): Promise<TaskView> {
  const rows = await tx`select id from ft.tasks where id = ${taskId} for update`;
  if (!rows.length) throw new UserError("Task not found.", undefined, "not_found");
  return (await getTask(tx, taskId))!;
}

/**
 * Check that related records exist and belong to the caller (RLS hides anything
 * else) and that the project matches the client. Never trusts ids from the browser.
 */
async function resolveRelations(
  tx: Tx,
  input: { clientId?: string | null; projectId?: string | null; contactId?: string | null },
) {
  let clientId = input.clientId ?? null;
  if (clientId) {
    const c = await tx`select id from ft.clients where id = ${clientId}`;
    if (!c.length) throw new UserError("That client was not found.", { clientId: "Client not found" }, "not_found");
  }
  if (input.projectId) {
    const p = await tx`select id, client_id from ft.projects where id = ${input.projectId}`;
    if (!p.length) throw new UserError("That project was not found.", { projectId: "Project not found" }, "not_found");
    const projectClient = (p[0].clientId as string) ?? null;
    if (projectClient && clientId && projectClient !== clientId)
      throw new UserError("That project belongs to a different client.", { projectId: "Choose a project for this client" });
    if (projectClient && !clientId) clientId = projectClient;
  }
  if (input.contactId) {
    const k = await tx`select id from ft.contacts where id = ${input.contactId}`;
    if (!k.length) throw new UserError("That person was not found.", { contactId: "Person not found" }, "not_found");
  }
  return { clientId, projectId: input.projectId ?? null, contactId: input.contactId ?? null };
}

async function addActivity(
  tx: Tx,
  userId: string,
  taskId: string,
  kind: string,
  now: Date,
  extra: { method?: string | null; note?: string | null; outcome?: string | null; changes?: Record<string, unknown> } = {},
) {
  await tx`
    insert into ft.task_activities (user_id, task_id, kind, method, note, outcome, changes, occurred_at)
    values (${userId}, ${taskId}, ${kind}, ${extra.method ?? null}, ${extra.note ?? null}, ${extra.outcome ?? null},
            ${tx.json((extra.changes ?? {}) as never)}, ${now})`;
}

function statusTimestamps(status: TaskStatus, prev: TaskView | null, now: Date) {
  return {
    completedAt: status === "completed" ? (prev?.status === "completed" ? prev.completedAt : now) : null,
    cancelledAt: status === "cancelled" ? (prev?.status === "cancelled" ? prev.cancelledAt : now) : null,
  };
}

export async function createTask(tx: Tx, userId: string, raw: unknown, now: Date): Promise<SaveResult> {
  const parsed = createTaskSchema.safeParse(raw);
  if (!parsed.success) throw new UserError("Please check the task details.", fieldErrors(parsed.error));
  const v = parsed.data;
  const prefs = await getProfile(tx, userId);
  const rel = await resolveRelations(tx, v);
  const notices: string[] = [];

  const status = v.status ?? "inbox";
  const dueDate = v.dueDate ?? null;
  const dueTime = dueDate ? (v.dueTime ?? null) : null;
  let dueAt: Date | null = null;
  if (dueDate) {
    dueAt = deadlineInstant(dueDate, dueTime, prefs.timezone);
  }
  let followUpAt: Date | null = null;
  if (v.followUpLocal) {
    const r = resolveLocalDateTime(v.followUpLocal, prefs.timezone);
    followUpAt = r.instant;
    const n = adjustmentNotice(r.adjustment, "follow-up");
    if (n) notices.push(n);
  }
  const ts = statusTimestamps(status, null, now);

  let row;
  try {
    [row] = await tx`
      insert into ft.tasks (user_id, title, notes, client_id, project_id, contact_id, status, priority,
                            due_date, due_time, due_at, follow_up_at, follow_up_reminder, deadline_reminder_minutes,
                            repeat_daily, tags, completed_at, cancelled_at, created_at)
      values (${userId}, ${v.title}, ${v.notes ?? null}, ${rel.clientId}, ${rel.projectId}, ${rel.contactId},
              ${status}, ${v.priority ?? "normal"}, ${dueDate}, ${dueTime}, ${dueAt}, ${followUpAt},
              ${v.followUpReminder ?? prefs.defaultFollowUpReminder},
              ${v.deadlineReminderMinutes !== undefined ? v.deadlineReminderMinutes : dueDate ? prefs.defaultDeadlineReminderMinutes : null},
              ${v.repeatDaily ?? false}, ${v.tags ?? []}, ${ts.completedAt}, ${ts.cancelledAt}, ${now})
      returning id`;
  } catch (e) {
    mapDbError(e);
  }
  const task = (await getTask(tx, row.id as string))!;
  await addActivity(tx, userId, task.id, "created", now, {
    changes: { status, ...(followUpAt ? { followUpAt: followUpAt.toISOString() } : {}), ...(dueDate ? { due: dueTime ? `${dueDate} ${dueTime}` : dueDate } : {}) },
  });
  await resyncTaskReminders(tx, userId, task, prefs, now);
  return { task, notices };
}

const SCHEDULE_KEYS = [
  "status",
  "priority",
  "dueDate",
  "dueTime",
  "followUpAt",
  "followUpReminder",
  "deadlineReminderMinutes",
  "repeatDaily",
] as const;

interface Merged {
  title: string;
  notes: string | null;
  clientId: string | null;
  projectId: string | null;
  contactId: string | null;
  status: TaskStatus;
  priority: TaskView["priority"];
  dueDate: string | null;
  dueTime: string | null;
  followUpAt: Date | null;
  followUpReminder: boolean;
  deadlineReminderMinutes: number | null;
  repeatDaily: boolean;
  tags: string[];
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date)
    return (a as Date | null)?.getTime?.() === (b as Date | null)?.getTime?.();
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Apply a change set to a task in one transaction: validate, update, record the
 * activity, and — if anything schedule-related changed — bump the schedule
 * version, clear any snooze, cancel obsolete reminders and plan new ones.
 */
async function applyChanges(
  tx: Tx,
  userId: string,
  current: TaskView,
  patch: UpdateTaskInput & { followUpAt?: Date | null },
  prefs: Prefs,
  now: Date,
  activity?: { kind: string; method?: string | null; note?: string | null; outcome?: string | null },
): Promise<TaskView> {
  const relInput = {
    clientId: patch.clientId !== undefined ? patch.clientId : current.clientId,
    projectId: patch.projectId !== undefined ? patch.projectId : current.projectId,
    contactId: patch.contactId !== undefined ? patch.contactId : current.contactId,
  };
  const relChanged = patch.clientId !== undefined || patch.projectId !== undefined || patch.contactId !== undefined;
  const rel = relChanged ? await resolveRelations(tx, relInput) : relInput;

  const next: Merged = {
    title: patch.title ?? current.title,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
    clientId: rel.clientId,
    projectId: rel.projectId,
    contactId: rel.contactId,
    status: patch.status ?? current.status,
    priority: patch.priority ?? current.priority,
    dueDate: patch.dueDate !== undefined ? patch.dueDate : current.dueDate,
    dueTime: patch.dueTime !== undefined ? patch.dueTime : current.dueTime,
    followUpAt: patch.followUpAt !== undefined ? patch.followUpAt : current.followUpAt,
    followUpReminder: patch.followUpReminder ?? current.followUpReminder,
    deadlineReminderMinutes:
      patch.deadlineReminderMinutes !== undefined ? patch.deadlineReminderMinutes : current.deadlineReminderMinutes,
    repeatDaily: patch.repeatDaily ?? current.repeatDaily,
    tags: patch.tags ?? current.tags,
  };
  if (!next.dueDate) next.dueTime = null;
  if (next.dueDate && !current.dueDate && patch.deadlineReminderMinutes === undefined && next.deadlineReminderMinutes === null)
    next.deadlineReminderMinutes = prefs.defaultDeadlineReminderMinutes;

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(next) as (keyof Merged)[]) {
    const prev = (current as unknown as Record<string, unknown>)[k];
    if (!same(prev, next[k])) {
      changes[k] = k === "notes" ? { from: "…", to: "…" } : { from: prev ?? null, to: next[k] ?? null };
    }
  }
  if (!Object.keys(changes).length && !activity) return current;

  const scheduleChanged = SCHEDULE_KEYS.some((k) => k in changes);
  const dueAt = next.dueDate ? deadlineInstant(next.dueDate, next.dueTime, prefs.timezone) : null;
  const ts = statusTimestamps(next.status, current, now);

  try {
    await tx`
      update ft.tasks set
        title = ${next.title}, notes = ${next.notes}, client_id = ${next.clientId}, project_id = ${next.projectId},
        contact_id = ${next.contactId}, status = ${next.status}, priority = ${next.priority},
        due_date = ${next.dueDate}, due_time = ${next.dueTime}, due_at = ${dueAt}, follow_up_at = ${next.followUpAt},
        follow_up_reminder = ${next.followUpReminder}, deadline_reminder_minutes = ${next.deadlineReminderMinutes},
        repeat_daily = ${next.repeatDaily}, tags = ${next.tags},
        completed_at = ${ts.completedAt}, cancelled_at = ${ts.cancelledAt},
        last_followed_up_at = ${activity?.kind === "follow_up_logged" ? now : current.lastFollowedUpAt},
        snoozed_until = ${scheduleChanged ? null : current.snoozedUntil},
        schedule_version = schedule_version + ${scheduleChanged ? 1 : 0}
      where id = ${current.id}`;
  } catch (e) {
    mapDbError(e);
  }

  const kind =
    activity?.kind ??
    (changes.status
      ? next.status === "completed"
        ? "completed"
        : next.status === "cancelled"
          ? "cancelled"
          : !isActiveStatus(current.status)
            ? "reopened"
            : "status_changed"
      : changes.followUpAt || changes.dueDate || changes.dueTime
        ? "rescheduled"
        : "updated");
  const serialisable = Object.fromEntries(
    Object.entries(changes).map(([k, v]) => [
      k,
      { from: v.from instanceof Date ? v.from.toISOString() : v.from, to: v.to instanceof Date ? v.to.toISOString() : v.to },
    ]),
  );
  await addActivity(tx, userId, current.id, kind, now, { ...activity, changes: serialisable });

  const updated = (await getTask(tx, current.id))!;
  if (scheduleChanged) await resyncTaskReminders(tx, userId, updated, prefs, now);
  return updated;
}

export async function updateTask(tx: Tx, userId: string, taskId: string, raw: unknown, now: Date): Promise<SaveResult> {
  const parsed = updateTaskSchema.safeParse(raw);
  if (!parsed.success) throw new UserError("Please check the task details.", fieldErrors(parsed.error));
  const { followUpLocal, ...rest } = parsed.data;
  const prefs = await getProfile(tx, userId);
  const current = await lockTask(tx, taskId);
  if (current.deletedAt) throw new UserError("This task is in the trash. Restore it first.", undefined, "conflict");
  const notices: string[] = [];
  const patch: UpdateTaskInput & { followUpAt?: Date | null } = { ...rest };
  if (followUpLocal !== undefined) {
    if (followUpLocal === null) patch.followUpAt = null;
    else {
      const r = resolveLocalDateTime(followUpLocal, prefs.timezone);
      patch.followUpAt = r.instant;
      const n = adjustmentNotice(r.adjustment, "follow-up");
      if (n) notices.push(n);
    }
  }
  const task = await applyChanges(tx, userId, current, patch, prefs, now);
  return { task, notices };
}

/**
 * Log a follow-up: note + method + outcome, the new follow-up time (or none) and an
 * optional status change, saved together. The previous follow-up is considered
 * handled, so it is cleared unless a new time is given.
 */
export async function logFollowUp(tx: Tx, userId: string, taskId: string, raw: unknown, now: Date): Promise<SaveResult> {
  const parsed = logFollowUpSchema.safeParse(raw);
  if (!parsed.success) throw new UserError("Please check the follow-up details.", fieldErrors(parsed.error));
  const v = parsed.data;
  const prefs = await getProfile(tx, userId);
  const current = await lockTask(tx, taskId);
  if (current.deletedAt) throw new UserError("This task is in the trash. Restore it first.", undefined, "conflict");
  const notices: string[] = [];
  let followUpAt: Date | null = null;
  if (v.nextFollowUpLocal) {
    const r = resolveLocalDateTime(v.nextFollowUpLocal, prefs.timezone);
    followUpAt = r.instant;
    if (followUpAt.getTime() <= now.getTime())
      throw new UserError("The next follow-up must be in the future.", { nextFollowUpLocal: "Choose a future time" });
    const n = adjustmentNotice(r.adjustment, "follow-up");
    if (n) notices.push(n);
  }
  const patch: UpdateTaskInput & { followUpAt?: Date | null } = { followUpAt };
  if (v.status) patch.status = v.status;
  const task = await applyChanges(tx, userId, current, patch, prefs, now, {
    kind: "follow_up_logged",
    method: v.method,
    note: v.note,
    outcome: v.outcome,
  });
  // A follow-up was logged even if the schedule happened to stay the same.
  return { task, notices };
}

export async function addNote(tx: Tx, userId: string, taskId: string, raw: unknown, now: Date) {
  const parsed = noteSchema.safeParse(raw);
  if (!parsed.success) throw new UserError("Please write a note.", fieldErrors(parsed.error));
  await lockTask(tx, taskId);
  await addActivity(tx, userId, taskId, "note", now, { note: parsed.data.note });
  await tx`update ft.tasks set updated_at = now() where id = ${taskId}`;
}

export async function setStatus(tx: Tx, userId: string, taskId: string, status: TaskStatus, now: Date) {
  return updateTask(tx, userId, taskId, { status }, now);
}

/**
 * Snooze this task's reminders until a later time. The deadline and follow-up do
 * not change; reminders due before the snooze time are cancelled and one snooze
 * reminder is scheduled.
 */
export async function snoozeTask(tx: Tx, userId: string, taskId: string, raw: unknown, now: Date): Promise<SaveResult> {
  const parsed = snoozeSchema.safeParse(raw);
  if (!parsed.success) throw new UserError("Choose when to be reminded.", fieldErrors(parsed.error));
  const prefs = await getProfile(tx, userId);
  const current = await lockTask(tx, taskId);
  if (current.deletedAt || !isActiveStatus(current.status))
    throw new UserError("Only open tasks can be snoozed.", undefined, "conflict");
  let custom: Date | undefined;
  if (parsed.data.option === "custom") {
    if (!parsed.data.customLocal) throw new UserError("Choose a time.", { customLocal: "Required" });
    custom = resolveLocalDateTime(parsed.data.customLocal, prefs.timezone).instant;
  }
  let until: Date;
  try {
    until = snoozeTarget(parsed.data.option as SnoozeOption, now, prefs, custom);
  } catch {
    throw new UserError("The snooze time must be in the future.", { customLocal: "Choose a future time" });
  }
  await tx`
    update ft.reminders set status = 'cancelled', status_reason = 'snoozed', finished_at = ${now}
     where task_id = ${taskId} and status = 'pending'
       and (kind = 'snooze' or available_at < ${until})`;
  await tx`update ft.tasks set snoozed_until = ${until} where id = ${taskId}`;
  const task = (await getTask(tx, taskId))!;
  await insertPlanned(tx, userId, [planSnooze(toSchedule(task), until, prefs)]);
  await addActivity(tx, userId, taskId, "snoozed", now, { changes: { snoozedUntil: until.toISOString() } });
  return { task, notices: [] };
}

/** Cancel a snooze and restore the normal reminder plan. */
export async function clearSnooze(tx: Tx, userId: string, taskId: string, now: Date): Promise<SaveResult> {
  const prefs = await getProfile(tx, userId);
  await lockTask(tx, taskId);
  await tx`update ft.tasks set snoozed_until = null, schedule_version = schedule_version + 1 where id = ${taskId}`;
  const task = (await getTask(tx, taskId))!;
  await resyncTaskReminders(tx, userId, task, prefs, now);
  await addActivity(tx, userId, taskId, "updated", now, { changes: { snoozedUntil: { from: "snoozed", to: null } } });
  return { task, notices: [] };
}

export async function softDeleteTask(tx: Tx, userId: string, taskId: string, now: Date) {
  const prefs = await getProfile(tx, userId);
  const current = await lockTask(tx, taskId);
  if (current.deletedAt) return current;
  await tx`update ft.tasks set deleted_at = ${now}, schedule_version = schedule_version + 1 where id = ${taskId}`;
  const task = (await getTask(tx, taskId))!;
  await resyncTaskReminders(tx, userId, task, prefs, now);
  await addActivity(tx, userId, taskId, "deleted", now);
  return task;
}

export async function restoreTask(tx: Tx, userId: string, taskId: string, now: Date) {
  const prefs = await getProfile(tx, userId);
  const current = await lockTask(tx, taskId);
  if (!current.deletedAt) return current;
  await tx`update ft.tasks set deleted_at = null, schedule_version = schedule_version + 1 where id = ${taskId}`;
  const task = (await getTask(tx, taskId))!;
  await resyncTaskReminders(tx, userId, task, prefs, now);
  await addActivity(tx, userId, taskId, "restored", now);
  return task;
}

/** Permanently delete a task that is already in the trash. */
export async function purgeTask(tx: Tx, taskId: string) {
  const rows = await tx`delete from ft.tasks where id = ${taskId} and deleted_at is not null returning id`;
  if (!rows.length) throw new UserError("Only tasks in the trash can be deleted permanently.", undefined, "conflict");
}

export async function getActivities(tx: Tx, taskId: string): Promise<ActivityView[]> {
  const rows = await tx`
    select id, task_id, kind, method, note, outcome, changes, occurred_at
      from ft.task_activities where task_id = ${taskId}
     order by occurred_at desc, created_at desc`;
  return rows.map((r) => ({
    id: r.id,
    taskId: r.taskId,
    kind: r.kind,
    method: r.method ?? null,
    note: r.note ?? null,
    outcome: r.outcome ?? null,
    changes: (r.changes as Record<string, unknown>) ?? {},
    occurredAt: r.occurredAt,
  }));
}

export async function getTaskReminders(tx: Tx, taskId: string): Promise<ReminderView[]> {
  const rows = await tx`
    select * from ft.reminders where task_id = ${taskId}
     order by scheduled_for desc limit 50`;
  return rows.map(toReminderView);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listOpenTasks(tx: Tx): Promise<TaskView[]> {
  const rows = await tx.unsafe(
    `${TASK_SELECT}
      where t.deleted_at is null and t.status in ('inbox', 'next_action', 'in_progress', 'waiting_on')
      order by t.created_at desc
      limit 2000`,
  );
  return rows.map(toTaskView);
}

export interface TaskFilters {
  q?: string;
  clientId?: string;
  projectId?: string;
  contactId?: string;
  statuses?: TaskStatus[];
  priorities?: string[];
  overdue?: boolean;
  missingNextAction?: boolean;
  includeClosed?: boolean;
  trash?: boolean;
  sort?: "due" | "follow_up" | "priority" | "updated" | "created" | "title";
}

/** "Missing next action": Inbox items not yet processed, and Waiting On items without a person or follow-up date. */
export async function searchTasks(tx: Tx, f: TaskFilters, now: Date, zone: string): Promise<TaskView[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  where.push(f.trash ? "t.deleted_at is not null" : "t.deleted_at is null");
  if (f.q && f.q.trim()) {
    const like = p(`%${f.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    where.push(`(t.title ilike ${like} or t.notes ilike ${like} or c.name ilike ${like} or p.name ilike ${like}
                or k.name ilike ${like} or array_to_string(t.tags, ' ') ilike ${like})`);
  }
  if (f.clientId) where.push(`t.client_id = ${p(f.clientId)}`);
  if (f.projectId) where.push(`t.project_id = ${p(f.projectId)}`);
  if (f.contactId) where.push(`t.contact_id = ${p(f.contactId)}`);
  if (f.statuses?.length) where.push(`t.status = any(${p(f.statuses)}::ft.task_status[])`);
  else if (!f.includeClosed && !f.trash) where.push(`t.status in ('inbox', 'next_action', 'in_progress', 'waiting_on')`);
  if (f.priorities?.length) where.push(`t.priority = any(${p(f.priorities)}::ft.task_priority[])`);
  if (f.overdue) {
    const n = p(now);
    const dayStart = p(startOfLocalDay(now, zone));
    where.push(`t.status in ('inbox', 'next_action', 'in_progress', 'waiting_on')
                and (t.due_at <= ${n} or t.follow_up_at < ${dayStart})`);
  }
  if (f.missingNextAction) {
    where.push(`t.status in ('inbox', 'next_action', 'in_progress', 'waiting_on')
                and (t.status = 'inbox' or (t.status = 'waiting_on' and (t.follow_up_at is null or t.contact_id is null)))`);
  }
  const order = {
    due: "t.due_at asc nulls last, t.follow_up_at asc nulls last",
    follow_up: "t.follow_up_at asc nulls last, t.due_at asc nulls last",
    priority:
      "case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, t.due_at asc nulls last",
    updated: "t.updated_at desc",
    created: "t.created_at desc",
    title: "lower(t.title) asc",
  }[f.sort ?? "due"];
  const rows = await tx.unsafe(`${TASK_SELECT} where ${where.join(" and ")} order by ${order}, t.id limit 500`, params as never[]);
  return rows.map(toTaskView);
}
