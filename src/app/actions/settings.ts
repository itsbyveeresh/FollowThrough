"use server";

import { assertId, runAction } from "@/server/action";
import { updateSettings } from "@/server/services/profile";
import { confirmDevice, removeDevice, updateDevice } from "@/server/services/devices";

export async function updateSettingsAction(input: unknown) {
  return runAction("updateSettings", async ({ tx, userId, now }) => {
    await updateSettings(tx, userId, input, now);
    return null;
  });
}

export async function updateDeviceAction(id: string, patch: { enabled?: boolean; deviceLabel?: string | null }) {
  return runAction("updateDevice", async ({ tx }) => {
    await updateDevice(tx, assertId(id), {
      enabled: typeof patch.enabled === "boolean" ? patch.enabled : undefined,
      deviceLabel: typeof patch.deviceLabel === "string" || patch.deviceLabel === null ? patch.deviceLabel : undefined,
    });
    return null;
  });
}

export async function removeDeviceAction(id: string) {
  return runAction("removeDevice", async ({ tx }) => {
    await removeDevice(tx, assertId(id));
    return null;
  });
}

export async function confirmDeviceAction(id: string) {
  return runAction("confirmDevice", async ({ tx, now }) => {
    await confirmDevice(tx, assertId(id), now);
    return null;
  });
}
