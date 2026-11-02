import type { Tx } from "../db";
import { configProblems, pushConfigured } from "../env";
import { getProfile } from "./profile";

/** Server-side facts for the reminder status view (no secrets, no other users' data). */
export async function loadHealthFacts(tx: Tx, userId: string) {
  const profile = await getProfile(tx, userId);
  const [sched] = await tx`select * from ft.scheduler_health()`;
  const [devices] = await tx`
    select count(*) filter (where enabled)::int as enabled, count(*)::int as total from ft.push_subscriptions`;
  const [accepted] = await tx`select max(created_at) as at from ft.delivery_attempts where outcome = 'accepted'`;
  const [failures] = await tx`
    select count(*)::int as n from ft.delivery_attempts
     where outcome <> 'accepted' and created_at > now() - interval '24 hours'`;
  return {
    isDemo: profile.isDemo,
    missingConfig: configProblems().map((p) => p.variable),
    pushConfigured: pushConfigured(),
    scheduler: {
      lastStartedAt: sched?.lastStartedAt ?? null,
      lastFinishedAt: sched?.lastFinishedAt ?? null,
      lastOk: sched?.lastOk ?? null,
      lastErrorAt: sched?.lastErrorAt ?? null,
    },
    enabledDevices: devices.enabled as number,
    totalDevices: devices.total as number,
    lastAcceptedAt: (accepted?.at as Date) ?? null,
    recentFailures: failures.n as number,
  };
}
