import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createDb, withService, withUser, type Sql, type Tx } from "@/server/db";
import type { PushSender, PushTarget, SendOptions, SendResult } from "@/server/push";
import { withDatabase } from "./global-setup";

export const DB_URL = process.env.TEST_DATABASE_URL;
export const hasDb = !!DB_URL;

/** Clone the migrated template into a database for one test file. */
export async function freshDb(): Promise<{ sql: Sql; drop: () => Promise<void> }> {
  const name = `ft_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = postgres(DB_URL!, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name} template ft_template`);
  await admin.end();
  const sql = createDb(withDatabase(DB_URL!, name), 8);
  return {
    sql,
    drop: async () => {
      await sql.end();
      const a = postgres(DB_URL!, { max: 1, onnotice: () => {} });
      await a.unsafe(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

export async function createUser(sql: Sql, email: string, timezone = "Asia/Kolkata"): Promise<string> {
  const [u] = await sql`insert into auth.users (email) values (${email}) returning id`;
  await sql`update ft.profiles set timezone = ${timezone}, quiet_hours_enabled = false where id = ${u.id}`;
  return u.id as string;
}

export const asUser = <T>(sql: Sql, userId: string, fn: (tx: Tx) => Promise<T>) => withUser(sql, userId, fn);
export const asService = <T>(sql: Sql, fn: (tx: Tx) => Promise<T>) => withService(sql, fn);

/** Mutable test clock. */
export class TestClock {
  constructor(public current: Date) {}
  now = () => new Date(this.current);
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(iso: string) {
    this.current = new Date(iso);
  }
}

export const minutes = (n: number) => n * 60_000;

/** Records sends; behaviour per endpoint can be scripted. */
export class FakeSender implements PushSender {
  calls: { endpoint: string; payload: Record<string, unknown>; opts: SendOptions }[] = [];
  scripts = new Map<string, SendResult[]>();
  delayMs = 0;
  script(endpoint: string, ...results: SendResult[]) {
    this.scripts.set(endpoint, results);
  }
  async send(target: PushTarget, payload: string, opts: SendOptions): Promise<SendResult> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    this.calls.push({ endpoint: target.endpoint, payload: JSON.parse(payload), opts });
    const q = this.scripts.get(target.endpoint);
    if (q && q.length) return q.shift()!;
    return { ok: true, status: 201 };
  }
  to(endpoint: string) {
    return this.calls.filter((c) => c.endpoint === endpoint);
  }
}

export async function addDevice(sql: Sql, userId: string, endpoint: string): Promise<string> {
  return asUser(sql, userId, async (tx) => {
    const [r] = await tx`
      select ft.register_push_subscription(${endpoint}, ${"BP".padEnd(87, "x")}, ${"authsecret123"}, ${"Test device"}, ${"vitest"}) as id`;
    return r.id as string;
  });
}

export async function reminders(sql: Sql, taskId: string) {
  return asService(sql, (tx) => tx`
    select kind, status, status_reason, scheduled_for, available_at, task_version, deferred_reason, attempts
      from ft.reminders where task_id = ${taskId} order by created_at, scheduled_for`);
}
