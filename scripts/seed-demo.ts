/**
 * Create a SEPARATE demo account filled with fictional consultancy data.
 *
 * Explicit by design: it never touches an existing account and refuses to run
 * unless you confirm. The account is flagged as demo, the app shows a "Demo
 * account" banner, and the dispatcher never sends push reminders for it.
 *
 * Usage:
 *   ALLOW_DEMO_SEED=yes npx tsx scripts/seed-demo.ts --email demo@example.com --password 'a-long-password'
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL.
 */
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { deadlineInstant } from "../src/lib/domain/time";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const password = arg("password");
  if (process.env.ALLOW_DEMO_SEED !== "yes") throw new Error("Refusing to run: set ALLOW_DEMO_SEED=yes to confirm you want a demo account.");
  if (!email || !password || password.length < 8) throw new Error("Pass --email and --password (8+ characters) for the NEW demo account.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dbUrl = process.env.DATABASE_URL;
  if (!url || !serviceKey || !dbUrl) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL.");

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { demo: true } });
  if (error || !data.user) throw new Error(`Could not create the demo user (it may already exist — demo seeding never reuses accounts): ${error?.message}`);
  const userId = data.user.id;

  const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx`insert into ft.profiles (id) values (${userId}) on conflict (id) do nothing`;
      await tx`update ft.profiles set is_demo = true, display_name = 'Demo Consultant', timezone = 'Europe/London', quiet_hours_enabled = true where id = ${userId}`;
      const day = (n: number) => new Date(Date.now() + n * 86400_000);
      const ymd = (d: Date) => d.toISOString().slice(0, 10);
      const at = (n: number, h: number) => {
        const d = day(n);
        d.setUTCHours(h, 0, 0, 0);
        return d;
      };
      const client = async (name: string) => (await tx`insert into ft.clients (user_id, name, notes) values (${userId}, ${name}, 'Fictional demo client') returning id`)[0].id as string;
      const project = async (clientId: string, name: string) => (await tx`insert into ft.projects (user_id, client_id, name) values (${userId}, ${clientId}, ${name}) returning id`)[0].id as string;
      const person = async (clientId: string, name: string, email: string) =>
        (await tx`insert into ft.contacts (user_id, client_id, name, email) values (${userId}, ${clientId}, ${name}, ${email}) returning id`)[0].id as string;
      const acme = await client("Acme Demo Co (fictional)");
      const nimbus = await client("Nimbus Demo Labs (fictional)");
      const expansion = await project(acme, "Expansion");
      const audit = await project(nimbus, "Process audit");
      const anita = await person(acme, "Anita (demo)", "anita@example.com");
      const raj = await person(nimbus, "Raj (demo)", "raj@example.com");
      const task = async (t: Record<string, unknown>) => {
        if (t.dueDate && !t.dueAt) t.dueAt = deadlineInstant(t.dueDate as string, (t.dueTime as string) ?? null, "Europe/London");
        const [row] = await tx`
          insert into ft.tasks (user_id, title, notes, client_id, project_id, contact_id, status, priority, due_date, due_time, due_at, follow_up_at, tags)
          values (${userId}, ${t.title as string}, ${(t.notes as string) ?? null}, ${(t.client as string) ?? null}, ${(t.project as string) ?? null},
                  ${(t.contact as string) ?? null}, ${(t.status as string) ?? "next_action"}, ${(t.priority as string) ?? "normal"},
                  ${(t.dueDate as string) ?? null}, ${(t.dueTime as string) ?? null}, ${(t.dueAt as Date) ?? null}, ${(t.followUpAt as Date) ?? null}, ${(t.tags as string[]) ?? []})
          returning id`;
        await tx`insert into ft.task_activities (user_id, task_id, kind, changes) values (${userId}, ${row.id}, 'created', '{"demo": true}')`;
        return row.id as string;
      };
      const proposal = await task({ title: "Get revised proposal from Anita", client: acme, project: expansion, contact: anita, status: "waiting_on", priority: "high", dueDate: ymd(day(3)), dueTime: "17:00", followUpAt: at(1, 11), tags: ["proposal"] });
      await tx`insert into ft.task_activities (user_id, task_id, kind, method, note, outcome) values (${userId}, ${proposal}, 'follow_up_logged', 'phone', 'Called Monday; Anita promised a revision Wednesday.', 'Promised Wednesday')`;
      await task({ title: "Collect documents from Raj", client: nimbus, project: audit, contact: raj, status: "waiting_on", followUpAt: at(-1, 10) });
      await task({ title: "Draft steering committee update", client: acme, project: expansion, status: "next_action", dueDate: ymd(day(0)) });
      await task({ title: "Invoice October retainer", client: nimbus, status: "next_action", priority: "urgent", dueDate: ymd(day(-2)) });
      await task({ title: "Chase signed SOW", client: nimbus, status: "waiting_on" });
      await task({ title: "Idea: workshop offer for Q1", status: "inbox" });
    });
    console.log(`Demo account created: ${email}. It is labelled as demo in the app and never receives push reminders.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
