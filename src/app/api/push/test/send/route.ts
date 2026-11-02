import type { NextRequest } from "next/server";
import { z } from "zod";
import { readJson, userRoute } from "@/server/route";
import { createWebPushSender } from "@/server/push";
import { runDispatch } from "@/server/services/dispatcher";
import { reminderStatusFor } from "@/server/services/devices";
import { UserError } from "@/server/services/model";

/** Send one of the caller's queued test reminders immediately, through the normal dispatcher path. */
export async function POST(req: NextRequest) {
  return userRoute(req, "push.test.send", async ({ tx, sql }) => {
    const parsed = z.object({ reminderId: z.string().uuid() }).safeParse(await readJson(req));
    if (!parsed.success) throw new UserError("Invalid request.");
    const status = await reminderStatusFor(tx, parsed.data.reminderId); // RLS: must be the caller's
    if (!status || status.reminder.kind !== "test") throw new UserError("Test not found.", undefined, "not_found");
    const sender = createWebPushSender();
    if (!sender) throw new UserError("Push is not configured on the server (VAPID keys missing).", undefined, "conflict");
    const summary = await runDispatch({ sql, sender, now: () => new Date(), onlyReminderId: parsed.data.reminderId });
    return { ok: summary.ok, sent: summary.sent, noDevices: summary.noDevices, failed: summary.failed, retried: summary.retried };
  });
}
