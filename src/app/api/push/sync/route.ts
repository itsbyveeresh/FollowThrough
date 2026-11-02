import type { NextRequest } from "next/server";
import { z } from "zod";
import { readJson, userRoute } from "@/server/route";
import { syncEndpoint } from "@/server/services/devices";
import { UserError } from "@/server/services/model";

/** Is this browser's subscription registered to the signed-in account? Detaches it from any other account. */
export async function POST(req: NextRequest) {
  return userRoute(req, "push.sync", async ({ sql, userId }) => {
    const parsed = z.object({ endpoint: z.string().url().max(1000) }).safeParse(await readJson(req));
    if (!parsed.success) throw new UserError("Invalid request.");
    return syncEndpoint(sql, userId, parsed.data.endpoint);
  });
}
