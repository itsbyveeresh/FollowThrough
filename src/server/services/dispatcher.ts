import { randomUUID } from "node:crypto";
import type { Sql, Tx } from "../db";
import { withService } from "../db";
import type { PushSender, SendOptions } from "../push";
import { STALE_MINUTES, isQuietTime, nextAllowedTime, planBriefing, planNextRepeat } from "@/lib/domain/reminders";
import { groupForToday, importantUpcoming } from "@/lib/domain/today";
import { isActiveStatus, type ReminderKind, type ReminderStatus } from "@/lib/domain/types";
import { toProfileView, toSchedule, toTaskView, type ProfileView, type TaskView } from "./model";
import { notificationContent } from "./notifications";
import { insertPlanned } from "./reminder-sync";
import { TASK_SELECT } from "./tasks";

/**
 * Reminder dispatcher
 * -------------------
 * Invoked every minute by Supabase Cron (pg_cron + pg_net) through POST /api/dispatch.
 * Browser timers are never involved. Each run:
 *   1. records a heartbeat row in ft.scheduler_runs;
 *   2. plans upcoming daily briefings;
 *   3. marks reminders that are too old to be useful as "missed" and queues one
 *      catch-up summary per affected user (no flood after an outage);
 *   4. atomically claims due reminders (FOR UPDATE SKIP LOCKED + lease), at most
 *      a few per user per run, reclaiming leases left by crashed runs;
 *   5. for each claim, re-checks the task right before sending (stale version,
 *      completed, deleted, snoozed, quiet hours), then sends Web Push to every
 *      enabled device that has not already accepted this reminder, recording one
 *      delivery attempt per device immediately after each send;
 *   6. finalizes the reminder (sent / partial / retry with backoff / failed /
 *      no_devices) guarded by the claim token, and schedules a daily repeat if
 *      the user enabled it.
 *
 * Duplicate window (documented): if the process dies after a push service accepted
 * a message but before the attempt row is written, the lease expires and a later
 * run sends it again. The notification tag and the push Topic header make the
 * device replace rather than stack such a duplicate where supported.
 */

export interface DispatchOptions {
  sql: Sql;
  sender: PushSender | null;
  now: () => Date;
  workerId?: string;
  batchLimit?: number;
  perUserLimit?: number;
  leaseSeconds?: number;
  /** Only process this reminder (used for "send test now"). */
  onlyReminderId?: string;
}

export interface DispatchSummary {
  runId: number | null;
  ok: boolean;
  error: string | null;
  claimed: number;
  sent: number;
  partial: number;
  retried: number;
  failed: number;
  deferred: number;
  cancelled: number;
  missed: number;
  noDevices: number;
}

export const MAX_CLAIMS = 6;

/** Retry backoff after a transient failure: 1, 2, 4, 8 … minutes, capped at 15. */
export function retryDelayMs(attempt: number): number {
  return Math.min(15, 2 ** Math.max(0, attempt - 1)) * 60_000;
}

const TTL_SECONDS: Record<ReminderKind, number> = {
  follow_up: 12 * 3600,
  repeat: 12 * 3600,
  deadline: 12 * 3600,
  snooze: 12 * 3600,
  briefing: 6 * 3600,
  catch_up: 12 * 3600,
  test: 600,
};

interface ClaimedReminder {
  id: string;
  userId: string;
  taskId: string | null;
  kind: ReminderKind;
  occurrenceKey: string;
  taskVersion: number | null;
  repeatIndex: number;
  scheduledFor: Date;
  availableAt: Date;
  staleAfter: Date;
  attempts: number;
  maxAttempts: number;
  claimCount: number;
  claimToken: string;
  statusReason: string | null;
}

type Outcome =
  | { status: Exclude<ReminderStatus, "pending" | "processing">; reason?: string; error?: string }
  | { status: "pending"; availableAt: Date; staleAfter?: Date; deferredReason: "quiet_hours" | "retry"; error?: string; attempted?: boolean };

export async function runDispatch(opts: DispatchOptions): Promise<DispatchSummary> {
  const { sql, sender } = opts;
  const workerId = opts.workerId ?? randomUUID();
  const summary: DispatchSummary = {
    runId: null, ok: true, error: null, claimed: 0, sent: 0, partial: 0, retried: 0,
    failed: 0, deferred: 0, cancelled: 0, missed: 0, noDevices: 0,
  };
  const startedAt = opts.now();
  const [run] = await withService(sql, (tx) =>
    tx`insert into ft.scheduler_runs (worker_id, started_at) values (${workerId}, ${startedAt}) returning id`,
  );
  summary.runId = Number(run.id);

  try {
    if (!opts.onlyReminderId) {
      await planBriefings(sql, opts.now());
      summary.missed += await markStale(sql, opts.now());
    }
    if (!sender) {
      throw new Error("Push is not configured on the server (VAPID keys missing)");
    }
    const claimed = await withService(sql, async (tx) => {
      if (opts.onlyReminderId) {
        return (await tx`
          update ft.reminders set status = 'processing', claim_token = ${workerId}, claimed_at = ${opts.now()},
                 claim_expires_at = ${new Date(opts.now().getTime() + (opts.leaseSeconds ?? 120) * 1000)},
                 claim_count = claim_count + 1
           where id = ${opts.onlyReminderId} and status = 'pending'
          returning *`) as unknown as ClaimedReminder[];
      }
      return (await tx`
        select * from ft.claim_due_reminders(${workerId}, ${opts.now()}, ${opts.batchLimit ?? 50},
                                             ${opts.perUserLimit ?? 3}, ${opts.leaseSeconds ?? 120})`) as unknown as ClaimedReminder[];
    });
    summary.claimed = claimed.length;

    const profiles = new Map<string, ProfileView>();
    for (const r of claimed) {
      try {
        const outcome = await processReminder(sql, sender, r, profiles, opts.now);
        const finalized = await finalize(sql, r, outcome, opts.now());
        if (!finalized) continue;
        count(summary, outcome);
      } catch (e) {
        // Leave the claim to expire; a later run retries it (bounded by MAX_CLAIMS).
        summary.ok = false;
        summary.error = sanitize(e);
      }
    }
  } catch (e) {
    summary.ok = false;
    summary.error = sanitize(e);
  }

  await withService(sql, (tx) => tx`
    update ft.scheduler_runs set finished_at = ${opts.now()}, ok = ${summary.ok}, claimed = ${summary.claimed},
      sent = ${summary.sent}, partial = ${summary.partial}, retried = ${summary.retried}, failed = ${summary.failed},
      deferred = ${summary.deferred}, cancelled = ${summary.cancelled}, missed = ${summary.missed},
      no_devices = ${summary.noDevices}, error = ${summary.error}
    where id = ${summary.runId}`);
  if (!opts.onlyReminderId && opts.now().getUTCMinutes() % 30 === 0) await housekeeping(sql, opts.now());
  return summary;
}

function count(s: DispatchSummary, o: Outcome) {
  if (o.status === "pending") {
    if (o.deferredReason === "retry") s.retried++;
    else s.deferred++;
    return;
  }
  if (o.status === "sent") s.sent++;
  else if (o.status === "partial") s.partial++;
  else if (o.status === "failed") s.failed++;
  else if (o.status === "cancelled" || o.status === "skipped") s.cancelled++;
  else if (o.status === "missed") s.missed++;
  else if (o.status === "no_devices") s.noDevices++;
}

export function sanitize(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Strip anything URL-like or token-like before storing/logging.
  return msg
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .slice(0, 300);
}

async function loadProfile(tx: Tx, userId: string, cache: Map<string, ProfileView>) {
  if (!cache.has(userId)) {
    const rows = await tx`select * from ft.profiles where id = ${userId}`;
    if (rows.length) cache.set(userId, toProfileView(rows[0]));
  }
  return cache.get(userId) ?? null;
}

async function processReminder(
  sql: Sql,
  sender: PushSender,
  r: ClaimedReminder,
  profiles: Map<string, ProfileView>,
  clock: () => Date,
): Promise<Outcome> {
  const now = clock();
  const ctx = await withService(sql, async (tx) => {
    const prefs = await loadProfile(tx, r.userId, profiles);
    let task: TaskView | null = null;
    if (r.taskId) {
      const rows = await tx.unsafe(`${TASK_SELECT} where t.id = $1`, [r.taskId]);
      task = rows.length ? toTaskView(rows[0]) : null;
    }
    return { prefs, task };
  });
  const { prefs, task } = ctx;
  if (!prefs) return { status: "cancelled", reason: "no_profile" };
  if (prefs.isDemo) return { status: "skipped", reason: "demo_account" };
  if (r.claimCount > MAX_CLAIMS) return { status: "failed", reason: "worker_crashed_repeatedly", error: "Gave up after repeated interrupted runs" };
  if (now.getTime() > r.staleAfter.getTime()) {
    const [acc] = await withService(sql, (tx) => tx`
      select count(*)::int as n from ft.delivery_attempts where reminder_id = ${r.id} and outcome = 'accepted'`);
    if (acc.n > 0) return { status: "partial", reason: "retries_timed_out" };
    if (r.taskId) await queueCatchUp(sql, r.userId, now);
    return { status: "missed", reason: "not_sent_in_time" };
  }

  // Final state check right before sending.
  if (r.taskId) {
    if (!task || task.deletedAt) return { status: "cancelled", reason: "task_deleted" };
    if (!isActiveStatus(task.status)) return { status: "cancelled", reason: `task_${task.status}` };
    if (r.taskVersion !== task.scheduleVersion) return { status: "cancelled", reason: "task_changed" };
    if (r.kind !== "snooze" && task.snoozedUntil && task.snoozedUntil.getTime() > now.getTime())
      return { status: "cancelled", reason: "snoozed" };
    if ((r.kind === "follow_up" || r.kind === "repeat") && (!task.followUpReminder || !task.followUpAt))
      return { status: "cancelled", reason: "reminder_turned_off" };
    if (r.kind === "deadline" && task.deadlineReminderMinutes === null) return { status: "cancelled", reason: "reminder_turned_off" };
  }
  if (r.kind === "briefing" && !prefs.briefingEnabled) return { status: "cancelled", reason: "briefing_disabled" };

  // Quiet hours (re-checked at send time in case settings changed after planning).
  const bypass = r.kind === "test" || (prefs.urgentBypassesQuiet && task?.priority === "urgent");
  if (!bypass && isQuietTime(now, prefs)) {
    const availableAt = nextAllowedTime(now, prefs);
    return {
      status: "pending",
      availableAt,
      staleAfter: new Date(availableAt.getTime() + STALE_MINUTES[r.kind] * 60_000),
      deferredReason: "quiet_hours",
    };
  }

  // Content.
  let briefing = null;
  let missedCount: number | undefined;
  if (r.kind === "briefing") briefing = await briefingCounts(sql, r.userId, prefs, now);
  if (r.kind === "catch_up") {
    const [m] = await withService(sql, (tx) => tx`
      select count(*)::int as n from ft.reminders
       where user_id = ${r.userId} and status = 'missed' and task_id is not null
         and finished_at > ${new Date(now.getTime() - 24 * 3600_000)}`);
    missedCount = m.n;
  }
  const payload = notificationContent(
    {
      reminderId: r.id,
      kind: r.kind,
      scheduledFor: r.scheduledFor,
      task: task ? { id: task.id, title: task.title, clientName: task.clientName, contactName: task.contactName } : null,
      briefing,
      missedCount,
    },
    prefs,
    now,
  );

  // Targets: enabled devices that have not already accepted this reminder.
  const { targets, alreadyAccepted } = await withService(sql, async (tx) => {
    const subs = await tx`
      select s.id, s.endpoint, s.p256dh, s.auth_secret from ft.push_subscriptions s
       where s.user_id = ${r.userId} and s.enabled
         and not exists (select 1 from ft.delivery_attempts a
                          where a.reminder_id = ${r.id} and a.subscription_id = s.id and a.outcome = 'accepted')`;
    const [acc] = await tx`
      select count(*)::int as n from ft.delivery_attempts where reminder_id = ${r.id} and outcome = 'accepted'`;
    return { targets: subs, alreadyAccepted: acc.n as number };
  });
  if (!targets.length) {
    return alreadyAccepted > 0 ? { status: "sent" } : { status: "no_devices", reason: "no_enabled_device" };
  }

  const opts: SendOptions = {
    ttlSeconds: TTL_SECONDS[r.kind],
    urgency: r.kind === "briefing" ? "normal" : "high",
    topic: r.id.replace(/-/g, "").slice(0, 32),
  };
  const body = JSON.stringify(payload);
  const attemptNo = r.attempts + 1;
  let accepted = 0;
  let transient = 0;
  let permanent = 0;
  let lastError: string | undefined;
  for (const s of targets) {
    const res = await sender.send({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.authSecret }, body, opts);
    // Record immediately so a crash after this point never resends to this device.
    await withService(sql, async (tx) => {
      const outcome = res.ok ? "accepted" : res.kind === "gone" ? "subscription_gone" : res.kind === "transient" ? "transient_failure" : "permanent_failure";
      await tx`
        insert into ft.delivery_attempts (user_id, reminder_id, subscription_id, attempt_no, outcome, http_status, error, created_at)
        values (${r.userId}, ${r.id}, ${s.id}, ${attemptNo}, ${outcome}, ${res.status}, ${res.ok ? null : res.error}, ${clock()})
        on conflict do nothing`;
      if (res.ok) {
        await tx`update ft.push_subscriptions set last_success_at = ${clock()}, consecutive_failures = 0 where id = ${s.id}`;
      } else if (res.kind === "gone") {
        await tx`update ft.push_subscriptions set enabled = false, disabled_reason = 'Subscription expired or was removed by the browser',
                 last_failure_at = ${clock()} where id = ${s.id}`;
      } else {
        await tx`update ft.push_subscriptions set last_failure_at = ${clock()}, consecutive_failures = consecutive_failures + 1,
                 enabled = case when ${res.kind === "permanent"} and consecutive_failures + 1 >= 5 then false else enabled end,
                 disabled_reason = case when ${res.kind === "permanent"} and consecutive_failures + 1 >= 5
                                        then 'Disabled after repeated delivery failures' else disabled_reason end
                 where id = ${s.id}`;
      }
    });
    if (res.ok) accepted++;
    else {
      lastError = res.error;
      if (res.kind === "transient") transient++;
      else if (res.kind === "permanent") permanent++;
    }
  }

  const totalAccepted = alreadyAccepted + accepted;
  if (transient > 0 && attemptNo < r.maxAttempts) {
    const retryAt = new Date(now.getTime() + retryDelayMs(attemptNo));
    if (retryAt.getTime() <= r.staleAfter.getTime())
      return { status: "pending", availableAt: retryAt, deferredReason: "retry", error: lastError, attempted: true };
  }
  if (totalAccepted > 0) {
    if (transient + permanent === 0) return { status: "sent" };
    return { status: "partial", reason: "some_devices_failed", error: lastError };
  }
  if (transient + permanent === 0) return { status: "no_devices", reason: "all_subscriptions_expired" };
  return { status: "failed", reason: transient ? "retries_exhausted" : "push_rejected", error: lastError };
}

/** Write the outcome, guarded by the claim token. Returns false if the claim was lost. */
async function finalize(sql: Sql, r: ClaimedReminder, o: Outcome, now: Date): Promise<boolean> {
  return withService(sql, async (tx) => {
    let rows;
    if (o.status === "pending") {
      rows = await tx`
        update ft.reminders set status = 'pending', available_at = ${o.availableAt},
               stale_after = ${o.staleAfter ?? r.staleAfter}, deferred_reason = ${o.deferredReason},
               attempts = attempts + ${o.attempted ? 1 : 0}, last_error = ${o.error ?? null},
               claim_token = null, claimed_at = null, claim_expires_at = null
         where id = ${r.id} and claim_token = ${r.claimToken} and status = 'processing'
        returning id`;
    } else {
      const attempted = ["sent", "partial", "failed"].includes(o.status);
      rows = await tx`
        update ft.reminders set status = ${o.status}, status_reason = ${"reason" in o ? (o.reason ?? null) : null},
               last_error = ${"error" in o ? (o.error ?? null) : null}, finished_at = ${now},
               attempts = attempts + ${attempted ? 1 : 0},
               first_accepted_at = case when ${o.status === "sent" || o.status === "partial"}
                                        then coalesce(first_accepted_at, ${now}) else first_accepted_at end,
               claim_token = null, claim_expires_at = null
         where id = ${r.id} and claim_token = ${r.claimToken} and status = 'processing'
        returning id`;
      if (rows.length && (o.status === "sent" || o.status === "partial") && (r.kind === "follow_up" || r.kind === "repeat")) {
        await scheduleRepeat(tx, r, now);
      }
    }
    return rows.length > 0;
  });
}

async function scheduleRepeat(tx: Tx, r: ClaimedReminder, now: Date) {
  const [p] = await tx`select * from ft.profiles where id = ${r.userId}`;
  const rows = await tx.unsafe(`${TASK_SELECT} where t.id = $1`, [r.taskId]);
  if (!p || !rows.length) return;
  const task = toTaskView(rows[0]);
  if (task.scheduleVersion !== r.taskVersion) return;
  const next = planNextRepeat(toSchedule(task), toProfileView(p), r.repeatIndex, now);
  if (next) await insertPlanned(tx, r.userId, [next]);
}

async function queueCatchUp(sql: Sql, userId: string, now: Date) {
  const hourKey = now.toISOString().slice(0, 13);
  await withService(sql, (tx) => tx`
    insert into ft.reminders (user_id, kind, occurrence_key, scheduled_for, available_at, stale_after)
    values (${userId}, 'catch_up', ${`catch_up:${hourKey}`}, ${now}, ${now}, ${new Date(now.getTime() + STALE_MINUTES.catch_up * 60_000)})
    on conflict (user_id, occurrence_key) where status <> 'cancelled' do nothing`);
}

async function markStale(sql: Sql, now: Date): Promise<number> {
  const rows = await withService(sql, (tx) => tx`select * from ft.mark_stale_reminders(${now})`);
  let total = 0;
  for (const row of rows) {
    total += row.missedCount as number;
    await queueCatchUp(sql, row.userId as string, now);
  }
  return total;
}

async function planBriefings(sql: Sql, now: Date) {
  await withService(sql, async (tx) => {
    const rows = await tx`select * from ft.profiles where briefing_enabled and not is_demo`;
    for (const row of rows) {
      const prefs = toProfileView(row);
      const plan = planBriefing(prefs, now);
      if (plan) await insertPlanned(tx, prefs.id, [plan]);
    }
  });
}

async function briefingCounts(sql: Sql, userId: string, prefs: ProfileView, now: Date) {
  const tasks = await withService(sql, async (tx) => {
    const rows = await tx.unsafe(
      `${TASK_SELECT} where t.user_id = $1 and t.deleted_at is null
         and t.status in ('inbox', 'next_action', 'in_progress', 'waiting_on')`,
      [userId],
    );
    return rows.map(toTaskView);
  });
  const { counts } = groupForToday(tasks, prefs, now);
  return {
    overdue: counts.overdue,
    followUpsToday: counts.followUpsToday,
    importantSoon: importantUpcoming(tasks, prefs.timezone, now).length,
  };
}

async function housekeeping(sql: Sql, now: Date) {
  await withService(sql, async (tx) => {
    await tx`delete from ft.scheduler_runs where started_at < ${new Date(now.getTime() - 14 * 86400_000)}`;
    await tx`delete from ft.rate_limits where window_start < ${new Date(now.getTime() - 86400_000)}`;
    await tx`delete from ft.reminders where finished_at < ${new Date(now.getTime() - 90 * 86400_000)}
               and status not in ('pending', 'processing')`;
  });
}
