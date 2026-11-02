/* FollowThrough service worker.
 *
 * Caching policy: only immutable build assets (/_next/static) and icons are
 * cached. Pages, API responses and anything containing account data are never
 * cached; when offline, navigations show /offline.html instead.
 *
 * Push: shows the notification the server sent. Tapping it opens the task (the
 * app asks for sign-in first if needed and returns to the task afterwards).
 * Opening or dismissing a notification never changes any task.
 */
const VERSION = "v1";
const STATIC_CACHE = `ft-static-${VERSION}`;
const PRECACHE = ["/offline.html", "/icons/icon-192.png", "/icons/badge-72.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ft-") && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(async () => (await caches.match("/offline.html")) || Response.error()));
  }
  // Everything else uses the network with no service-worker caching.
});

function safePath(p) {
  return typeof p === "string" && p.startsWith("/") && !p.startsWith("//") ? p : "/today";
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "FollowThrough";
  const options = {
    body: data.body || "You have a reminder.",
    tag: data.tag || undefined,
    renotify: false,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    timestamp: Date.now(),
    data: { url: safePath(data.url), reminderId: data.reminderId || null, kind: data.kind || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          await client.focus();
          if ("navigate" in client) {
            await client.navigate(target);
            return;
          }
        } catch {
          // fall through to opening a new window
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// The browser rotated or expired the subscription: subscribe again with the same
// server key and register it (the session cookie identifies the account).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const key = old && old.options && old.options.applicationServerKey;
      if (!key) return;
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const headers = { "Content-Type": "application/json" };
      await fetch("/api/push/subscribe", { method: "POST", credentials: "same-origin", headers, body: JSON.stringify(sub.toJSON()) });
      if (old && old.endpoint) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          credentials: "same-origin",
          headers,
          body: JSON.stringify({ endpoint: old.endpoint }),
        });
      }
    })(),
  );
});
