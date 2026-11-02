import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

/** Fresh E2E database: Supabase test shim + all migrations. */
export default async function globalSetup() {
  const admin = process.env.TEST_DATABASE_URL!;
  const a = postgres(admin, { max: 1, onnotice: () => {} });
  await a.unsafe("drop database if exists ft_e2e with (force)");
  await a.unsafe("create database ft_e2e");
  await a.end();
  const u = new URL(admin);
  u.pathname = "/ft_e2e";
  const db = postgres(u.toString(), { max: 1, onnotice: () => {} });
  await db.unsafe(fs.readFileSync(path.join(process.cwd(), "tests/db/supabase-shim.sql"), "utf8"));
  const dir = path.join(process.cwd(), "supabase/migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await db.unsafe(fs.readFileSync(path.join(dir, f), "utf8"));
  await db.end();
}
