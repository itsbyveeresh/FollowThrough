"use server";

import { assertId, runAction } from "@/server/action";
import * as svc from "@/server/services/clients";

export async function createClientAction(input: unknown) {
  return runAction("createClient", async ({ tx, userId }) => ({ id: (await svc.createClient(tx, userId, input)).id }));
}
export async function updateClientAction(id: string, input: unknown) {
  return runAction("updateClient", async ({ tx }) => ({ id: (await svc.updateClient(tx, assertId(id), input)).id }));
}
export async function archiveClientAction(id: string, archived: boolean) {
  return runAction("archiveClient", async ({ tx, now }) => {
    await svc.setClientArchived(tx, assertId(id), archived, now);
    return null;
  });
}
export async function createProjectAction(input: unknown) {
  return runAction("createProject", async ({ tx, userId }) => ({ id: (await svc.createProject(tx, userId, input)).id }));
}
export async function updateProjectAction(id: string, input: unknown) {
  return runAction("updateProject", async ({ tx }) => ({ id: (await svc.updateProject(tx, assertId(id), input)).id }));
}
export async function archiveProjectAction(id: string, archived: boolean) {
  return runAction("archiveProject", async ({ tx, now }) => {
    await svc.setProjectArchived(tx, assertId(id), archived, now);
    return null;
  });
}
export async function createContactAction(input: unknown) {
  return runAction("createContact", async ({ tx, userId }) => ({ id: (await svc.createContact(tx, userId, input)).id }));
}
export async function updateContactAction(id: string, input: unknown) {
  return runAction("updateContact", async ({ tx }) => ({ id: (await svc.updateContact(tx, assertId(id), input)).id }));
}
export async function archiveContactAction(id: string, archived: boolean) {
  return runAction("archiveContact", async ({ tx, now }) => {
    await svc.setContactArchived(tx, assertId(id), archived, now);
    return null;
  });
}
