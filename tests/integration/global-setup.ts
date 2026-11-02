import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

/**
 * Builds a template database once per test run: the Supabase test shim
 * (roles, auth.users, auth.uid()) followed by every migration in order.
 * Each integration test file clones it into its own database.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable Postgres server
 * (superuser), e.g. postgres://postgres@127.0.0.1:54329/postgres.
 * Without it, integration tests are skipped.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ft_template`);
    await admin.unsafe(`create database ft_template`);
  } finally {
    await admin.end();
  }
  const tpl = postgres(withDatabase(url, "ft_template"), { max: 1, onnotice: () => {} });
  try {
    const root = process.cwd();
    await tpl.unsafe(fs.readFileSync(path.join(root, "tests/db/supabase-shim.sql"), "utf8"));
    const dir = path.join(root, "supabase/migrations");
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await tpl.unsafe(fs.readFileSync(path.join(dir, file), "utf8"));
    }
  } finally {
    await tpl.end();
  }
}

export function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}
