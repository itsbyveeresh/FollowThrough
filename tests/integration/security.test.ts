import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "@/server/db";
import { createTask, getTask, searchTasks, updateTask, logFollowUp } from "@/server/services/tasks";
import { createClient, createContact, createProject } from "@/server/services/clients";
import { listDevices, syncEndpoint } from "@/server/services/devices";
import { UserError } from "@/server/services/model";
import { addDevice, asService, asUser, createUser, freshDb, hasDb } from "./helpers";

const now = new Date("2026-10-26T04:30:00Z");

describe.skipIf(!hasDb)("data isolation between accounts", () => {
  let sql: Sql;
  let drop: () => Promise<void>;
  let alice: string;
  let bob: string;
  let aliceClient: string;
  let aliceProject: string;
  let aliceContact: string;
  let aliceTask: string;

  beforeAll(async () => {
    ({ sql, drop } = await freshDb());
    alice = await createUser(sql, "alice@example.test");
    bob = await createUser(sql, "bob@example.test");
    await asUser(sql, alice, async (tx) => {
      aliceClient = (await createClient(tx, alice, { name: "Acme" })).id;
      aliceProject = (await createProject(tx, alice, { name: "Expansion", clientId: aliceClient })).id;
      aliceContact = (await createContact(tx, alice, { name: "Anita", clientId: aliceClient })).id;
      aliceTask = (
        await createTask(tx, alice, { title: "Secret proposal", notes: "confidential", projectId: aliceProject }, now)
      ).task.id;
    });
  });
  afterAll(async () => drop?.());

  it("hides other users' tasks, clients and activity", async () => {
    await asUser(sql, bob, async (tx) => {
      expect(await getTask(tx, aliceTask)).toBeNull();
      expect(await searchTasks(tx, { q: "Secret", includeClosed: true }, now, "UTC")).toEqual([]);
      expect(await tx`select * from ft.clients`).toHaveLength(0);
      expect(await tx`select * from ft.task_activities`).toHaveLength(0);
      expect(await tx`select * from ft.reminders`).toHaveLength(0);
      expect(await tx`select * from ft.profiles`).toHaveLength(1);
    });
  });

  it("rejects another user's client, project or contact ids through the service", async () => {
    for (const ref of [{ clientId: aliceClient }, { projectId: aliceProject }, { contactId: aliceContact }]) {
      await expect(
        asUser(sql, bob, (tx) => createTask(tx, bob, { title: "Sneaky", ...ref }, now)),
      ).rejects.toBeInstanceOf(UserError);
    }
  });

  it("rejects another user's related ids even with direct SQL (composite foreign keys)", async () => {
    await expect(
      asUser(sql, bob, (tx) => tx`insert into ft.tasks (user_id, title, client_id) values (${bob}, 'x', ${aliceClient})`),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      asUser(sql, bob, (tx) => tx`insert into ft.tasks (user_id, title) values (${alice}, 'impersonate')`),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot update, follow up or delete another user's task", async () => {
    await expect(asUser(sql, bob, (tx) => updateTask(tx, bob, aliceTask, { title: "pwned" }, now))).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      asUser(sql, bob, (tx) => logFollowUp(tx, bob, aliceTask, { method: "phone", note: "x" }, now)),
    ).rejects.toMatchObject({ code: "not_found" });
    const deleted = await asUser(sql, bob, (tx) => tx`delete from ft.tasks where id = ${aliceTask} returning id`);
    expect(deleted).toHaveLength(0);
    const still = await asUser(sql, alice, (tx) => getTask(tx, aliceTask));
    expect(still?.title).toBe("Secret proposal");
  });

  it("enforces that a task's project belongs to its client", async () => {
    await asUser(sql, alice, async (tx) => {
      const other = await createClient(tx, alice, { name: "Globex" });
      await expect(createTask(tx, alice, { title: "Mismatch", clientId: other.id, projectId: aliceProject }, now)).rejects.toThrow(
        /different client/,
      );
    });
    await expect(
      asUser(sql, alice, async (tx) => {
        const [g] = await tx`select id from ft.clients where name = 'Globex'`;
        await tx`insert into ft.tasks (user_id, title, client_id, project_id) values (${alice}, 'raw', ${g.id}, ${aliceProject})`;
      }),
    ).rejects.toThrow(/project_client_mismatch/);
    // Picking only a project fills in its client.
    const t = await asUser(sql, alice, (tx) => createTask(tx, alice, { title: "Inherit", projectId: aliceProject }, now));
    expect(t.task.clientId).toBe(aliceClient);
  });

  it("never exposes push subscription secrets to the user role and isolates devices", async () => {
    await addDevice(sql, alice, "https://push.example.test/alice-1");
    await expect(asUser(sql, alice, (tx) => tx`select auth_secret from ft.push_subscriptions`)).rejects.toThrow(/permission denied/);
    await expect(asUser(sql, alice, (tx) => tx`select endpoint from ft.push_subscriptions`)).rejects.toThrow(/permission denied/);
    expect(await asUser(sql, alice, listDevices)).toHaveLength(1);
    expect(await asUser(sql, bob, listDevices)).toHaveLength(0);
    await expect(asUser(sql, bob, (tx) => tx`select * from ft.scheduler_runs`)).rejects.toThrow(/permission denied/);
  });

  it("moves a browser subscription to the new account on account switch", async () => {
    const endpoint = "https://push.example.test/shared-browser";
    await addDevice(sql, alice, endpoint);
    // Bob signs in on the same browser: the app syncs the endpoint and detaches it from Alice.
    const r = await syncEndpoint(sql, bob, endpoint);
    expect(r.detachedFromOtherAccount).toBe(true);
    const aliceHas = await asService(sql, (tx) => tx`select 1 from ft.push_subscriptions where user_id = ${alice} and endpoint = ${endpoint}`);
    expect(aliceHas).toHaveLength(0);
    // Registering moves it explicitly too.
    await addDevice(sql, alice, endpoint);
    await addDevice(sql, bob, endpoint);
    const owners = await asService(sql, (tx) => tx`select user_id from ft.push_subscriptions where endpoint = ${endpoint}`);
    expect(owners.map((o) => o.userId)).toEqual([bob]);
  });

  it("does not allow users to insert test or catch-up reminders directly", async () => {
    await expect(
      asUser(sql, bob, (tx) => tx`
        insert into ft.reminders (user_id, kind, occurrence_key, scheduled_for, available_at, stale_after)
        values (${bob}, 'test', 'x', now(), now(), now() + interval '1 hour')`),
    ).rejects.toThrow(/row-level security/);
  });
});
