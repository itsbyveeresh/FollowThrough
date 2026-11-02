"use client";

import { useEffect } from "react";
import { syncThisDevice } from "@/lib/push-client";

/**
 * When the app opens, check that this browser's push subscription (if any)
 * belongs to the signed-in account. If it was left registered to another
 * account (e.g. a previous user's session expired without signing out), the
 * server detaches it so that account's reminders stop arriving here.
 */
export function PushSessionGuard() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    syncThisDevice().catch(() => {});
  }, []);
  return null;
}
