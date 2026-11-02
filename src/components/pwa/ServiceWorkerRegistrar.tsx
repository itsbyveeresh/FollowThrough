"use client";

import { useEffect } from "react";

/** Registers /sw.js (push display, notification clicks, offline page, static asset cache). */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Registration failures surface in Settings → Notifications.
    });
  }, []);
  return null;
}
