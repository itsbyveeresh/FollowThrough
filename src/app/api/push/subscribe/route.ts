import type { NextRequest } from "next/server";
import { readJson, userRoute } from "@/server/route";
import { registerDevice } from "@/server/services/devices";
import { getProfile } from "@/server/services/profile";
import { UserError } from "@/server/services/model";

export async function POST(req: NextRequest) {
  return userRoute(req, "push.subscribe", async ({ tx, userId }) => {
    const profile = await getProfile(tx, userId);
    if (profile.isDemo) throw new UserError("Demo accounts cannot enable reminders.", undefined, "forbidden");
    const body = await readJson(req);
    const deviceId = await registerDevice(tx, body, req.headers.get("user-agent"));
    return { deviceId };
  });
}
