// Apply supabase/migrations/*.sql in order to DATABASE_URL (or MIGRATION_DATABASE_URL),
// recording applied files in ft_meta.schema_migrations. Each file runs in its own
// transaction. Alternative: `supabase db push` with the Supabase CLI.
//
// Usage: DATABASE_URL=... node scripts/migrate.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import postgres from "postgres";

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (or MIGRATION_DATABASE_URL) to your Supabase connection string.");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  const [{ server_version_num }] = await sql`show server_version_num`;
  if (Number(server_version_num) < 150000) throw new Error("PostgreSQL 15 or newer is required.");
  await sql`create schema if not exists ft_meta`;
  await sql`revoke all on schema ft_meta from public`;
  await sql`create table if not exists ft_meta.schema_migrations (filename text primary key, checksum text not null, applied_at timestamptz not null default now())`;
  const applied = new Map((await sql`select filename, checksum from ft_meta.schema_migrations`).map((r) => [r.filename, r.checksum]));
  const dir = path.resolve("supabase/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const f of files) {
    const body = fs.readFileSync(path.join(dir, f), "utf8");
    const sum = crypto.createHash("sha256").update(body).digest("hex");
    if (applied.has(f)) {
      if (applied.get(f) !== sum) console.warn(`! ${f} changed after it was applied; not re-running it.`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into ft_meta.schema_migrations (filename, checksum) values (${f}, ${sum})`;
    });
    console.log(`✓ applied ${f}`);
    count++;
  }
  console.log(count ? `Done: ${count} migration(s) applied.` : "Database is up to date.");
} catch (e) {
  console.error(`Migration failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
