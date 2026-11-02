import "server-only";
import { revalidatePath } from "next/cache";
import { db, pgErrorCode, withUser, type Tx } from "./db";
import { getSessionUser } from "./auth";
import { ConfigError } from "./env";
import { UserError } from "./services/model";

import type { ActionResult } from "@/lib/action-result";
export type { ActionResult };

export interface ActionContext {
  tx: Tx;
  userId: string;
  now: Date;
  /** Informational messages to show with the success (e.g. daylight-saving adjustments). */
  notices: string[];
}

/** Log without private content: error class, Postgres code and constraint only. */
export function logServerError(scope: string, e: unknown) {
  const code = pgErrorCode(e);
  const constraint = typeof e === "object" && e && "constraint_name" in e ? String((e as { constraint_name: unknown }).constraint_name) : undefined;
  const name = e instanceof Error ? e.name : typeof e;
  console.error(`[${scope}] failed`, { name, code, constraint });
}

/**
 * Run a mutation as the signed-in user inside one transaction. Success is only
 * reported after the transaction commits; any error rolls everything back.
 */
export async function runAction<T>(
  scope: string,
  fn: (ctx: ActionContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false, error: "Your session has ended. Please sign in again.", code: "not_authenticated" };
    const notices: string[] = [];
    const data = await withUser(db(), user.id, (tx) => fn({ tx, userId: user.id, now: new Date(), notices }));
    revalidatePath("/", "layout");
    return { ok: true, data, notices: notices.length ? notices : undefined };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message, fields: e.fields, code: e.code };
    if (e instanceof ConfigError) return { ok: false, error: `${e.message}. See the setup guide.`, code: "config" };
    logServerError(scope, e);
    return { ok: false, error: "Something went wrong on the server. Your change was not saved.", code: "server" };
  }
}

export function assertId(id: unknown): string {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new UserError("Invalid id.", undefined, "not_found");
  return id;
}
