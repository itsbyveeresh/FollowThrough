import type { NextRequest } from "next/server";
import { z } from "zod";
import { readJson, userRoute } from "@/server/route";
import { removeByEndpoint } from "@/server/services/devices";
import { UserError } from "@/server/services/model";

export async function POST(req: NextRequest) {
  return userRoute(req, "push.unsubscribe", async ({ tx }) => {
    const parsed = z.object({ endpoint: z.string().url().max(1000) }).safeParse(await readJson(req));
    if (!parsed.success) throw new UserError("Invalid request.");
    await removeByEndpoint(tx, parsed.data.endpoint);
    return { ok: true };
  });
}
