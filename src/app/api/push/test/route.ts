import type { NextRequest } from "next/server";
import { z } from "zod";
import { readJson, userRoute } from "@/server/route";
import { createTestReminder } from "@/server/services/devices";
import { getProfile } from "@/server/services/profile";
import { UserError } from "@/server/services/model";

/**
 * Queue a test notification. delayMinutes = 0 asks the dispatcher to send it right
 * away (the client then calls /api/push/test/send); 2 leaves it for the scheduler,
 * which is how you prove reminders arrive with the app closed.
 */
export async function POST(req: NextRequest) {
  return userRoute(req, "push.test", async ({ sql, tx, userId, now }) => {
    const parsed = z.object({ delayMinutes: z.union([z.literal(0), z.literal(2), z.literal(5)]) }).safeParse(await readJson(req));
    if (!parsed.success) throw new UserError("Invalid request.");
    const profile = await getProfile(tx, userId);
    if (profile.isDemo) throw new UserError("Demo accounts cannot send notifications.", undefined, "forbidden");
    const reminderId = await createTestReminder(sql, tx, userId, now, parsed.data.delayMinutes);
    return { reminderId, availableAt: new Date(now.getTime() + parsed.data.delayMinutes * 60_000) };
  });
}
