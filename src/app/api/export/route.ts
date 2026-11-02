import type { NextRequest } from "next/server";
import { userRoute } from "@/server/route";
import { exportJson, exportTasksCsv } from "@/server/services/export";

export async function GET(req: NextRequest) {
  const format = req.nextUrl.searchParams.get("format") === "csv" ? "csv" : "json";
  return userRoute(req, "export", async ({ tx, userId, now }) => {
    const stamp = now.toISOString().slice(0, 10);
    const headers = {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="followthrough-${format === "csv" ? "tasks" : "export"}-${stamp}.${format}"`,
    };
    if (format === "csv") {
      return new Response(await exportTasksCsv(tx), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
    }
    return new Response(JSON.stringify(await exportJson(tx, userId), null, 2), {
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  });
}
