import { createHash } from "node:crypto";
import type { Sql, Tx } from "../db";
import { withService } from "../db";
import { pushSubscriptionSchema, fieldErrors } from "@/lib/validation";
import { STALE_MINUTES } from "@/lib/domain/reminders";
import { toReminderView, UserError, type ReminderView } from "./model";

export interface DeviceView {
  id: string;
  endpointHash: string;
  deviceLabel: string | null;
  userAgent: string | null;
  enabled: boolean;
  disabledReason: string | null;
  confirmedAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  createdAt: Date;
}

export const hashEndpoint = (endpoint: string) => createHash("sha256").update(endpoint, "utf8").digest("hex");

export async function rateLimit(tx: Tx, bucket: string, max: number, windowSeconds: number) {
  const [r] = await tx`select ft.hit_rate_limit(${bucket}, ${max}, ${windowSeconds}) as ok`;
  if (!r.ok) throw new UserError("Too many requests. Please wait a few minutes and try again.", undefined, "rate_limited");
}

/** Friendly default name like "iPhone · Safari" from the user agent. */
export function labelFromUserAgent(ua: string | null): string {
  if (!ua) return "This device";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "Device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  return `${os} · ${browser}`;
}

export async function registerDevice(tx: Tx, raw: unknown, userAgent: string | null): Promise<string> {
  await rateLimit(tx, "push-subscribe", 10, 3600);
  const parsed = pushSubscriptionSchema.safeParse(raw);
  if (!parsed.success) throw new UserError("The browser sent an invalid subscription.", fieldErrors(parsed.error));
  const v = parsed.data;
  const label = v.deviceLabel ?? labelFromUserAgent(userAgent);
  try {
    const [r] = await tx`
      select ft.register_push_subscription(${v.endpoint}, ${v.keys.p256dh}, ${v.keys.auth}, ${label}, ${userAgent ?? ""}) as id`;
    return r.id as string;
  } catch (e) {
    if (String((e as Error).message).includes("too_many_devices"))
      throw new UserError("You have 20 devices registered. Remove an old one first.", undefined, "conflict");
    throw e;
  }
}

export async function listDevices(tx: Tx): Promise<DeviceView[]> {
  return (await tx`
    select id, endpoint_hash, device_label, user_agent, enabled, disabled_reason, confirmed_at,
           last_success_at, last_failure_at, consecutive_failures, created_at
      from ft.push_subscriptions order by created_at desc`) as unknown as DeviceView[];
}

export async function updateDevice(tx: Tx, id: string, patch: { enabled?: boolean; deviceLabel?: string | null }) {
  const label = patch.deviceLabel === undefined ? undefined : (patch.deviceLabel ?? "").trim().slice(0, 100) || null;
  const rows = await tx`
    update ft.push_subscriptions set
      enabled = coalesce(${patch.enabled ?? null}, enabled),
      disabled_reason = case when ${patch.enabled ?? null}::boolean is false then 'Turned off by you'
                             when ${patch.enabled ?? null}::boolean is true then null else disabled_reason end,
      device_label = case when ${label !== undefined} then ${label ?? null} else device_label end
     where id = ${id} returning id`;
  if (!rows.length) throw new UserError("Device not found.", undefined, "not_found");
}

export async function confirmDevice(tx: Tx, id: string, now: Date) {
  const rows = await tx`update ft.push_subscriptions set confirmed_at = ${now} where id = ${id} returning id`;
  if (!rows.length) throw new UserError("Device not found.", undefined, "not_found");
}

export async function removeDevice(tx: Tx, id: string) {
  await tx`delete from ft.push_subscriptions where id = ${id}`;
}

/** Remove this installation's subscription from the signed-in account (sign-out). */
export async function removeByEndpoint(tx: Tx, endpoint: string) {
  await tx`delete from ft.push_subscriptions where endpoint_hash = ${hashEndpoint(endpoint)}`;
}

/**
 * Called when the app opens with an existing browser subscription. If this
 * installation is still registered to a different account (e.g. a session ended
 * without signing out), detach it from that account so its reminders stop
 * arriving here. Possessing the endpoint proves this is that installation.
 */
export async function syncEndpoint(sql: Sql, userId: string, endpoint: string) {
  const hash = hashEndpoint(endpoint);
  return withService(sql, async (tx) => {
    const rows = await tx`select id, user_id, enabled from ft.push_subscriptions where endpoint_hash = ${hash}`;
    if (!rows.length) return { registered: false as const, deviceId: null, enabled: false, detachedFromOtherAccount: false };
    if (rows[0].userId === userId)
      return { registered: true as const, deviceId: rows[0].id as string, enabled: rows[0].enabled as boolean, detachedFromOtherAccount: false };
    await tx`delete from ft.push_subscriptions where id = ${rows[0].id}`;
    return { registered: false as const, deviceId: null, enabled: false, detachedFromOtherAccount: true };
  });
}

/** Queue a test notification, either now or a few minutes ahead (to test the scheduler with the app closed). */
export async function createTestReminder(sql: Sql, tx: Tx, userId: string, now: Date, delayMinutes: number): Promise<string> {
  await rateLimit(tx, "push-test", 6, 600);
  const at = new Date(now.getTime() + delayMinutes * 60_000);
  return withService(sql, async (stx) => {
    const [r] = await stx`
      insert into ft.reminders (user_id, kind, occurrence_key, scheduled_for, available_at, stale_after)
      values (${userId}, 'test', ${`test:${at.getTime()}:${Math.random().toString(36).slice(2, 8)}`}, ${at}, ${at},
              ${new Date(at.getTime() + STALE_MINUTES.test * 60_000)})
      returning id`;
    return r.id as string;
  });
}

export interface AttemptView {
  id: string;
  reminderId: string;
  deviceLabel: string | null;
  attemptNo: number;
  outcome: string;
  httpStatus: number | null;
  error: string | null;
  createdAt: Date;
}

export async function reminderHistory(tx: Tx, limit = 60): Promise<{ reminders: ReminderView[]; attempts: AttemptView[] }> {
  const rows = await tx`
    select r.*, t.title as task_title from ft.reminders r left join ft.tasks t on t.id = r.task_id
     order by greatest(r.scheduled_for, r.updated_at) desc limit ${limit}`;
  const reminders = rows.map(toReminderView);
  const ids = reminders.map((r) => r.id);
  const attempts = ids.length
    ? ((await tx`
        select a.id, a.reminder_id, s.device_label, a.attempt_no, a.outcome, a.http_status, a.error, a.created_at
          from ft.delivery_attempts a left join ft.push_subscriptions s on s.id = a.subscription_id
         where a.reminder_id = any(${ids}::uuid[]) order by a.created_at`) as unknown as AttemptView[])
    : [];
  return { reminders, attempts };
}

export async function reminderStatusFor(tx: Tx, reminderId: string) {
  const rows = await tx`select * from ft.reminders where id = ${reminderId}`;
  if (!rows.length) return null;
  const attempts = (await tx`
    select a.id, a.reminder_id, s.device_label, a.attempt_no, a.outcome, a.http_status, a.error, a.created_at
      from ft.delivery_attempts a left join ft.push_subscriptions s on s.id = a.subscription_id
     where a.reminder_id = ${reminderId} order by a.created_at`) as unknown as AttemptView[];
  return { reminder: toReminderView(rows[0]), attempts };
}
