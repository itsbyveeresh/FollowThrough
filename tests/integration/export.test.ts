import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "@/server/db";
import { createTask } from "@/server/services/tasks";
import { exportJson, exportTasksCsv } from "@/server/services/export";
import { asUser, createUser, freshDb, hasDb, addDevice } from "./helpers";

describe.skipIf(!hasDb)("data export", () => {
  let sql: Sql;
  let drop: () => Promise<void>;
  let user: string;
  beforeAll(async () => {
    ({ sql, drop } = await freshDb());
    user = await createUser(sql, "export@example.test");
    const other = await createUser(sql, "other-export@example.test");
    await asUser(sql, user, (tx) => createTask(tx, user, { title: '=HYPERLINK("x")', notes: 'Line 1\nsaid "hi", ok' }, new Date()));
    await asUser(sql, other, (tx) => createTask(tx, other, { title: "Not mine" }, new Date()));
    await addDevice(sql, user, "https://push.example.test/export-device");
  });
  afterAll(async () => drop?.());

  it("exports only the user's tasks as safe CSV", async () => {
    const csv = await asUser(sql, user, exportTasksCsv);
    expect(csv.split("\r\n")[0]).toMatch(/^id,title,status/);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"Line 1\nsaid ""hi"", ok"');
    expect(csv).not.toContain("Not mine");
  });

  it("exports full structured data with history but no push secrets", async () => {
    const data = await asUser(sql, user, (tx) => exportJson(tx, user));
    expect(data.tasks).toHaveLength(1);
    expect(data.activities.length).toBeGreaterThan(0);
    expect(data.devices).toHaveLength(1);
    const text = JSON.stringify(data);
    expect(text).not.toContain("authsecret123");
    expect(text).not.toContain("push.example.test");
  });
});
