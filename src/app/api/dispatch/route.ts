import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";
import { serverConfig } from "@/server/env";
import { createWebPushSender } from "@/server/push";
import { runDispatch } from "@/server/services/dispatcher";
import { logServerError } from "@/server/action";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Protected reminder dispatcher. Called every minute by Supabase Cron with
 * "Authorization: Bearer <CRON_SECRET>". Returns counts only.
 */
export async function POST(req: NextRequest) {
  const secret = serverConfig().cronSecret;
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: "Dispatcher disabled: CRON_SECRET is not configured" }, { status: 503 });
  }
  if (!authorized(req, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const summary = await runDispatch({ sql: db(), sender: createWebPushSender(), now: () => new Date() });
    return NextResponse.json(summary, { status: summary.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    logServerError("dispatch", e);
    return NextResponse.json({ error: "Dispatcher failed" }, { status: 500 });
  }
}
