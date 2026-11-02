import type { Tx } from "../db";
import { pgErrorCode } from "../db";
import { clientSchema, contactSchema, fieldErrors, projectSchema } from "@/lib/validation";
import { UserError } from "./model";

export interface ClientRow {
  id: string;
  name: string;
  notes: string | null;
  archivedAt: Date | null;
}
export interface ProjectRow {
  id: string;
  name: string;
  clientId: string | null;
  clientName: string | null;
  notes: string | null;
  archivedAt: Date | null;
}
export interface ContactRow {
  id: string;
  name: string;
  clientId: string | null;
  clientName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  archivedAt: Date | null;
}

function duplicate(e: unknown, what: string): never {
  if (pgErrorCode(e) === "23505") throw new UserError(`You already have a ${what} with that name.`, { name: "Name already used" });
  if (pgErrorCode(e) === "23503") throw new UserError("The selected client was not found.", { clientId: "Client not found" }, "not_found");
  throw e;
}

async function assertClient(tx: Tx, clientId: string | null) {
  if (!clientId) return;
  const r = await tx`select id from ft.clients where id = ${clientId}`;
  if (!r.length) throw new UserError("The selected client was not found.", { clientId: "Client not found" }, "not_found");
}

export async function listClients(tx: Tx, includeArchived = false): Promise<ClientRow[]> {
  return (await tx`
    select id, name, notes, archived_at from ft.clients
     where ${includeArchived} or archived_at is null
     order by archived_at nulls first, lower(name)`) as unknown as ClientRow[];
}

export async function listProjects(tx: Tx, includeArchived = false): Promise<ProjectRow[]> {
  return (await tx`
    select p.id, p.name, p.client_id, c.name as client_name, p.notes, p.archived_at
      from ft.projects p left join ft.clients c on c.id = p.client_id
     where ${includeArchived} or p.archived_at is null
     order by lower(coalesce(c.name, '')), lower(p.name)`) as unknown as ProjectRow[];
}

export async function listContacts(tx: Tx, includeArchived = false): Promise<ContactRow[]> {
  return (await tx`
    select k.id, k.name, k.client_id, c.name as client_name, k.email, k.phone, k.notes, k.archived_at
      from ft.contacts k left join ft.clients c on c.id = k.client_id
     where ${includeArchived} or k.archived_at is null
     order by lower(k.name)`) as unknown as ContactRow[];
}

export async function createClient(tx: Tx, userId: string, raw: unknown): Promise<ClientRow> {
  const parsed = clientSchema.safeParse(raw);
  if (!parsed.success) throw new UserError("Please check the client details.", fieldErrors(parsed.error));
  try {
    const [row] = await tx`
      insert into ft.clients (user_id, name, notes) values (${userId}, ${parsed.data.name}, ${parsed.data.notes})
      returning id, name, notes, archived_at`;
    return row as unknown as ClientRow;
  } catch (e) {
    duplicate(e, "client");
  }
}

export async function updateClient(tx: Tx, id: string, raw: unknown): Promise<ClientRow> {
  const parsed = clientSchema.safeParse(raw);
  if (!parsed.success) throw new UserError("Please check the client details.", fieldErrors(parsed.error));
  try {
    const rows = await tx`
      update ft.clients set name = ${parsed.data.name}, notes = ${parsed.data.notes} where id = ${id}
      returning id, name, notes, archived_at`;
    if (!rows.length) throw new UserError("Client not found.", undefined, "not_found");
    return rows[0] as unknown as ClientRow;
  } catch (e) {
    if (e instanceof UserError) throw e;
    duplicate(e, "client");
  }
}

export async function setClientArchived(tx: Tx, id: string, archived: boolean, now: Date) {
  try {
    const rows = await tx`update ft.clients set archived_at = ${archived ? now : null} where id = ${id} returning id`;
    if (!rows.length) throw new UserError("Client not found.", undefined, "not_found");
  } catch (e) {
    if (e instanceof UserError) throw e;
    duplicate(e, "client");
  }
}

export async function createProject(tx: Tx, userId: string, raw: unknown): Promise<ProjectRow> {
  const parsed = projectSchema.safeParse(raw);
  if (!parsed.success) throw new UserError("Please check the project details.", fieldErrors(parsed.error));
  await assertClient(tx, parsed.data.clientId);
  try {
    const [row] = await tx`
      insert into ft.projects (user_id, name, client_id, notes)
      values (${userId}, ${parsed.data.name}, ${parsed.data.clientId}, ${parsed.data.notes})
      returning id`;
    return (await getProject(tx, row.id as string))!;
  } catch (e) {
    duplicate(e, "project");
  }
}

export async function updateProject(tx: Tx, id: string, raw: unknown): Promise<ProjectRow> {
  const parsed = projectSchema.safeParse(raw);
  if (!parsed.success) throw new UserError("Please check the project details.", fieldErrors(parsed.error));
  await assertClient(tx, parsed.data.clientId);
  const current = await getProject(tx, id);
  if (!current) throw new UserError("Project not found.", undefined, "not_found");
  if (current.clientId !== parsed.data.clientId) {
    const conflicting = await tx`
      select count(*)::int as n from ft.tasks
       where project_id = ${id} and client_id is not null and client_id is distinct from ${parsed.data.clientId}`;
    if (conflicting[0].n > 0 && parsed.data.clientId)
      throw new UserError(
        "Some tasks in this project are assigned to another client. Move or update those tasks first.",
        { clientId: "Tasks belong to another client" },
        "conflict",
      );
  }
  await tx`update ft.projects set name = ${parsed.data.name}, client_id = ${parsed.data.clientId}, notes = ${parsed.data.notes} where id = ${id}`;
  if (parsed.data.clientId) await tx`update ft.tasks set client_id = ${parsed.data.clientId} where project_id = ${id} and client_id is null`;
  return (await getProject(tx, id))!;
}

export async function setProjectArchived(tx: Tx, id: string, archived: boolean, now: Date) {
  const rows = await tx`update ft.projects set archived_at = ${archived ? now : null} where id = ${id} returning id`;
  if (!rows.length) throw new UserError("Project not found.", undefined, "not_found");
}

export async function getProject(tx: Tx, id: string): Promise<ProjectRow | null> {
  const rows = await tx`
    select p.id, p.name, p.client_id, c.name as client_name, p.notes, p.archived_at
      from ft.projects p left join ft.clients c on c.id = p.client_id where p.id = ${id}`;
  return (rows[0] as unknown as ProjectRow) ?? null;
}

export async function getClient(tx: Tx, id: string): Promise<ClientRow | null> {
  const rows = await tx`select id, name, notes, archived_at from ft.clients where id = ${id}`;
  return (rows[0] as unknown as ClientRow) ?? null;
}

export async function getContact(tx: Tx, id: string): Promise<ContactRow | null> {
  const rows = await tx`
    select k.id, k.name, k.client_id, c.name as client_name, k.email, k.phone, k.notes, k.archived_at
      from ft.contacts k left join ft.clients c on c.id = k.client_id where k.id = ${id}`;
  return (rows[0] as unknown as ContactRow) ?? null;
}

export async function createContact(tx: Tx, userId: string, raw: unknown): Promise<ContactRow> {
  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) throw new UserError("Please check the person's details.", fieldErrors(parsed.error));
  const v = parsed.data;
  await assertClient(tx, v.clientId);
  const [row] = await tx`
    insert into ft.contacts (user_id, name, client_id, email, phone, notes)
    values (${userId}, ${v.name}, ${v.clientId}, ${v.email}, ${v.phone}, ${v.notes})
    returning id`;
  return (await getContact(tx, row.id as string))!;
}

export async function updateContact(tx: Tx, id: string, raw: unknown): Promise<ContactRow> {
  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) throw new UserError("Please check the person's details.", fieldErrors(parsed.error));
  const v = parsed.data;
  await assertClient(tx, v.clientId);
  const rows = await tx`
    update ft.contacts set name = ${v.name}, client_id = ${v.clientId}, email = ${v.email}, phone = ${v.phone}, notes = ${v.notes}
     where id = ${id} returning id`;
  if (!rows.length) throw new UserError("Person not found.", undefined, "not_found");
  return (await getContact(tx, id))!;
}

export async function setContactArchived(tx: Tx, id: string, archived: boolean, now: Date) {
  const rows = await tx`update ft.contacts set archived_at = ${archived ? now : null} where id = ${id} returning id`;
  if (!rows.length) throw new UserError("Person not found.", undefined, "not_found");
}

/** Recent activity across tasks of a client or project. */
export async function recentActivity(tx: Tx, filter: { clientId?: string; projectId?: string; contactId?: string }, limit = 15) {
  const rows = await tx`
    select a.id, a.task_id, a.kind, a.method, a.note, a.outcome, a.occurred_at, t.title as task_title
      from ft.task_activities a join ft.tasks t on t.id = a.task_id
     where t.deleted_at is null
       and (${filter.clientId ?? null}::uuid is null or t.client_id = ${filter.clientId ?? null})
       and (${filter.projectId ?? null}::uuid is null or t.project_id = ${filter.projectId ?? null})
       and (${filter.contactId ?? null}::uuid is null or t.contact_id = ${filter.contactId ?? null})
     order by a.occurred_at desc limit ${limit}`;
  return rows as unknown as {
    id: string;
    taskId: string;
    kind: string;
    method: string | null;
    note: string | null;
    outcome: string | null;
    occurredAt: Date;
    taskTitle: string;
  }[];
}
