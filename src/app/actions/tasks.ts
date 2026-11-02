"use server";

import { assertId, runAction } from "@/server/action";
import * as tasks from "@/server/services/tasks";
import { TASK_STATUSES, type TaskStatus } from "@/lib/domain/types";
import { UserError } from "@/server/services/model";

export async function createTaskAction(input: unknown) {
  return runAction("createTask", async ({ tx, userId, now, notices }) => {
    const r = await tasks.createTask(tx, userId, input, now);
    notices.push(...r.notices);
    return { id: r.task.id };
  });
}

export async function updateTaskAction(id: string, input: unknown) {
  return runAction("updateTask", async ({ tx, userId, now, notices }) => {
    const r = await tasks.updateTask(tx, userId, assertId(id), input, now);
    notices.push(...r.notices);
    return { id: r.task.id };
  });
}

export async function logFollowUpAction(id: string, input: unknown) {
  return runAction("logFollowUp", async ({ tx, userId, now, notices }) => {
    const r = await tasks.logFollowUp(tx, userId, assertId(id), input, now);
    notices.push(...r.notices);
    return { id: r.task.id };
  });
}

export async function setStatusAction(id: string, status: TaskStatus) {
  return runAction("setStatus", async ({ tx, userId, now, notices }) => {
    if (!TASK_STATUSES.includes(status)) throw new UserError("Unknown status.");
    const r = await tasks.setStatus(tx, userId, assertId(id), status, now);
    notices.push(...r.notices);
    return { id: r.task.id };
  });
}

export async function snoozeAction(id: string, input: unknown) {
  return runAction("snooze", async ({ tx, userId, now }) => {
    const r = await tasks.snoozeTask(tx, userId, assertId(id), input, now);
    return { id: r.task.id, snoozedUntil: r.task.snoozedUntil };
  });
}

export async function clearSnoozeAction(id: string) {
  return runAction("clearSnooze", async ({ tx, userId, now }) => {
    await tasks.clearSnooze(tx, userId, assertId(id), now);
    return null;
  });
}

export async function addNoteAction(id: string, input: unknown) {
  return runAction("addNote", async ({ tx, userId, now }) => {
    await tasks.addNote(tx, userId, assertId(id), input, now);
    return null;
  });
}

export async function deleteTaskAction(id: string) {
  return runAction("deleteTask", async ({ tx, userId, now }) => {
    await tasks.softDeleteTask(tx, userId, assertId(id), now);
    return null;
  });
}

export async function restoreTaskAction(id: string) {
  return runAction("restoreTask", async ({ tx, userId, now }) => {
    await tasks.restoreTask(tx, userId, assertId(id), now);
    return null;
  });
}

export async function purgeTaskAction(id: string) {
  return runAction("purgeTask", async ({ tx }) => {
    await tasks.purgeTask(tx, assertId(id));
    return null;
  });
}
