"use client";

/** Browser-side Web Push helpers. Feature-detected; never assume support. */

export interface PushCapabilities {
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  permission: NotificationPermission | "unsupported";
  standalone: boolean;
  ios: boolean;
  iosVersion: number | null;
  secure: boolean;
}

export function detectCapabilities(): PushCapabilities {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const m = ua.match(/OS (\d+)[._](\d+)/);
  const iosVersion = ios && m ? Number(m[1]) + Number(m[2]) / 10 : null;
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return {
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    notification: "Notification" in window,
    permission: "Notification" in window ? Notification.permission : "unsupported",
    standalone,
    ios,
    iosVersion,
    secure: window.isSecureContext,
  };
}

export function pushSupported(c: PushCapabilities) {
  return c.secure && c.serviceWorker && c.pushManager && c.notification;
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data;
}

/**
 * Subscribe this browser and register it with the server. Must be called from a
 * user gesture (button click) — iOS requires it, and we never prompt on load.
 */
export async function subscribeThisDevice(vapidPublicKey: string, deviceLabel?: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { permission } as const;
  const reg = await getRegistration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = urlBase64ToUint8Array(vapidPublicKey);
  if (sub) {
    // Re-subscribe if the server key changed.
    const existing = sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
    if (!existing || existing.length !== key.length || existing.some((b, i) => b !== key[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = sub.toJSON();
  const res = (await postJson("/api/push/subscribe", { endpoint: json.endpoint, keys: json.keys, deviceLabel })) as { deviceId: string };
  return { permission, deviceId: res.deviceId } as const;
}

/** Stop push delivery to this installation for the signed-in account. */
export async function unsubscribeThisDevice() {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await postJson("/api/push/unsubscribe", { endpoint: sub.endpoint });
  } finally {
    await sub.unsubscribe().catch(() => {});
  }
}

export async function syncThisDevice() {
  const sub = await currentSubscription();
  if (!sub) return null;
  return (await postJson("/api/push/sync", { endpoint: sub.endpoint })) as {
    registered: boolean;
    deviceId: string | null;
    enabled: boolean;
    detachedFromOtherAccount: boolean;
  };
}

export async function sendTest(delayMinutes: 0 | 2 | 5) {
  const queued = (await postJson("/api/push/test", { delayMinutes })) as { reminderId: string; availableAt: string };
  if (delayMinutes === 0) {
    const result = await postJson("/api/push/test/send", { reminderId: queued.reminderId });
    return { ...queued, result };
  }
  return { ...queued, result: null };
}

/** Clear any account-specific state kept in this browser (on sign-out / account switch). */
export function clearLocalAccountState() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("ft:"))
      .forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch {
    // storage may be unavailable (private mode)
  }
}
