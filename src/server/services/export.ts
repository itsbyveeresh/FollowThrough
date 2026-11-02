import type { Tx } from "../db";

/** Full structured export (no push-subscription secrets). */
export async function exportJson(tx: Tx, userId: string) {
  const [profile] = await tx`select * from ft.profiles where id = ${userId}`;
  const clients = await tx`select * from ft.clients order by created_at`;
  const projects = await tx`select * from ft.projects order by created_at`;
  const contacts = await tx`select * from ft.contacts order by created_at`;
  const tasks = await tx`select * from ft.tasks order by created_at`;
  const activities = await tx`select * from ft.task_activities order by occurred_at`;
  const reminders = await tx`
    select id, task_id, kind, occurrence_key, scheduled_for, available_at, status, status_reason, attempts,
           first_accepted_at, finished_at, created_at
      from ft.reminders order by scheduled_for`;
  const devices = await tx`
    select id, device_label, enabled, disabled_reason, confirmed_at, last_success_at, created_at
      from ft.push_subscriptions order by created_at`;
  return {
    format: "followthrough-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    profile,
    clients,
    projects,
    contacts,
    tasks,
    activities,
    reminders,
    devices,
  };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join("; ") : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportTasksCsv(tx: Tx): Promise<string> {
  const rows = await tx`
    select t.id, t.title, t.status, t.priority, c.name as client, p.name as project, k.name as person,
           t.due_date, t.due_time, t.follow_up_at, t.tags, t.notes, t.created_at, t.updated_at, t.completed_at,
           t.last_followed_up_at, t.deleted_at
      from ft.tasks t
      left join ft.clients c on c.id = t.client_id
      left join ft.projects p on p.id = t.project_id
      left join ft.contacts k on k.id = t.contact_id
     order by t.created_at`;
  const headers = [
    "id", "title", "status", "priority", "client", "project", "person", "due_date", "due_time", "follow_up_at",
    "tags", "notes", "created_at", "updated_at", "completed_at", "last_followed_up_at", "deleted_at",
  ];
  const camel = (h: string) => h.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvCell((r as Record<string, unknown>)[camel(h)])).join(","));
  return lines.join("\r\n") + "\r\n";
}
