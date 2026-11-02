import type { NextRequest } from "next/server";
import { userRoute } from "@/server/route";
import { loadHealthFacts } from "@/server/services/health";

export async function GET(req: NextRequest) {
  return userRoute(req, "health", async ({ tx, userId }) => loadHealthFacts(tx, userId));
}
