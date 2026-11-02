import type { NextRequest } from "next/server";
import { userRoute } from "@/server/route";
import { reminderStatusFor } from "@/server/services/devices";
import { UserError } from "@/server/services/model";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return userRoute(req, "reminders.get", async ({ tx }) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new UserError("Not found.", undefined, "not_found");
    const r = await reminderStatusFor(tx, id);
    if (!r) throw new UserError("Not found.", undefined, "not_found");
    return r;
  });
}
