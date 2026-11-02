import "server-only";
import postgres from "postgres";
import { ConfigError, serverConfig } from "./env";

/** A connection or an open transaction. Services always receive a transaction. */
export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export function createDb(url: string, max = Number(process.env.DATABASE_POOL_MAX ?? 3)): Sql {
  return postgres(url, {
    max,
    // Required for Supabase's transaction-mode pooler (Supavisor, port 6543).
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: { column: { from: postgres.toCamel } },
    types: {
      // Keep calendar dates as "yyyy-MM-dd" strings; never shift them through a JS Date.
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
    onnotice: () => {},
  });
}

const globalForDb = globalThis as unknown as { __ftDb?: Sql };

export function db(): Sql {
  if (!globalForDb.__ftDb) {
    const url = serverConfig().databaseUrl;
    if (!url) throw new ConfigError("DATABASE_URL");
    globalForDb.__ftDb = createDb(url);
  }
  return globalForDb.__ftDb;
}

/**
 * Run `fn` in a transaction as the signed-in user. Switches to the
 * "authenticated" role and sets the JWT claims Supabase's auth.uid() reads, so
 * every statement is subject to Row Level Security.
 */
export async function withUser<T>(sql: Sql, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user id");
  return (await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  })) as T;
}

/** Run `fn` in a transaction as service_role (bypasses RLS). Dispatcher and admin tasks only. */
export async function withService<T>(sql: Sql, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`set local role service_role`;
    return fn(tx);
  })) as T;
}

/** Postgres error helpers. */
export function pgErrorCode(e: unknown): string | undefined {
  return typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

export function pgErrorMessage(e: unknown): string | undefined {
  return typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : undefined;
}
