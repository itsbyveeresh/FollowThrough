import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { db, withUser, type Sql, type Tx } from "./db";
import { getSessionUser } from "./auth";
import { ConfigError } from "./env";
import { UserError } from "./services/model";
import { logServerError } from "./action";

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** Reject cross-site requests to cookie-authenticated endpoints (CSRF). */
export function sameOrigin(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (!origin) return req.method === "GET";
  return origin === req.nextUrl.origin;
}

export interface RouteContext {
  userId: string;
  sql: Sql;
  tx: Tx;
  now: Date;
}

/** Authenticated JSON route running inside a user-scoped (RLS) transaction. */
export async function userRoute(req: NextRequest, scope: string, fn: (ctx: RouteContext) => Promise<unknown>) {
  if (!sameOrigin(req)) return json({ error: "Cross-site request rejected" }, 403);
  try {
    const user = await getSessionUser();
    if (!user) return json({ error: "Please sign in again." }, 401);
    const sql = db();
    const out = await withUser(sql, user.id, (tx) => fn({ userId: user.id, sql, tx, now: new Date() }));
    return out instanceof Response ? out : json(out ?? { ok: true });
  } catch (e) {
    if (e instanceof UserError) {
      const status = e.code === "rate_limited" ? 429 : e.code === "not_found" ? 404 : e.code === "conflict" ? 409 : 400;
      return json({ error: e.message, fields: e.fields }, status);
    }
    if (e instanceof ConfigError) return json({ error: e.message }, 503);
    logServerError(scope, e);
    return json({ error: "Server error. Nothing was changed." }, 500);
  }
}

export async function readJson(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  if (text.length > 10_000) throw new UserError("Request too large.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new UserError("Invalid JSON.");
  }
}
