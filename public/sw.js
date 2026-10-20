const ROOT = new URL("./", self.location.href);
const VERSION = "__MUSMATCH_BUILD__";
const PREFIX = `musmatch-${ROOT.pathname}-`;
const CACHE = `${PREFIX}${VERSION}`;
const OFFLINE = new URL("offline.html", ROOT).href;
const PRECACHE = []; /* MUSMATCH_PRECACHE */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll([
          OFFLINE,
          new URL("icons/icon-192.png", ROOT).href,
          new URL("icons/icon-512.png", ROOT).href,
          ...PRECACHE.map((path) => new URL(path, ROOT).href),
        ]),
      )
      .catch(async (error) => {
        await caches.delete(CACHE);
        throw error;
      }),
  );
  // A release waits until the user chooses to update, or every old window is closed.
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "MUSMATCH_SKIP_WAITING") {
    const source = event.source;
    if (!source?.url) return;
    const url = new URL(source.url);
    if (url.origin === ROOT.origin && url.pathname.startsWith(ROOT.pathname))
      event.waitUntil(self.skipWaiting());
  }
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const previous = (await caches.keys()).filter(
        (key) => key.startsWith(PREFIX) && key !== CACHE,
      );
      // Preserve the previous release's chunks for another tab that has not reloaded yet.
      await Promise.all(previous.slice(0, -1).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});
async function cachedAsset(request) {
  const current = await (await caches.open(CACHE)).match(request);
  if (current) return current;
  const previous = (await caches.keys())
    .filter((key) => key.startsWith(PREFIX) && key !== CACHE)
    .reverse();
  for (const key of previous) {
    const hit = await (await caches.open(key)).match(request);
    if (hit) return hit;
  }
}
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== ROOT.origin ||
    !url.pathname.startsWith(ROOT.pathname)
  )
    return;
  // Never cache HTML, OAuth responses, Supabase data or actions. Navigations use the network.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(
        async () =>
          (await (await caches.open(CACHE)).match(OFFLINE)) ||
          new Response("MusMatch necesita conexión. Vuelve a intentarlo.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
      ),
    );
  } else if (
    url.pathname.startsWith(`${ROOT.pathname}_next/static/`) ||
    url.pathname.startsWith(`${ROOT.pathname}icons/`) ||
    url.pathname.startsWith(`${ROOT.pathname}brand/`)
  ) {
    event.respondWith(
      (async () => {
        const hit = await cachedAsset(event.request);
        if (hit) return hit;
        const response = await fetch(event.request);
        if (response.ok)
          await (await caches.open(CACHE)).put(event.request, response.clone());
        return response;
      })(),
    );
  }
});
// Push payloads contain only generic messages; never addresses, scores or account data.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    /* Keep the generic fallback. */
  }
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const eventId =
    typeof data.eventId === "string" && uuid.test(data.eventId)
      ? data.eventId
      : null;
  const noticeId =
    typeof data.notificationId === "string" && uuid.test(data.notificationId)
      ? data.notificationId
      : null;
  let target = "notifications/";
  if (data.category === "invitations") target = "my-matches/";
  else if (eventId) target = `events/?id=${encodeURIComponent(eventId)}`;
  else if (data.category === "friends") target = "profile/";
  event.waitUntil(
    self.registration.showNotification("MusMatch", {
      body:
        typeof data.body === "string"
          ? data.body.slice(0, 180)
          : "Tienes un nuevo aviso en MusMatch.",
      icon: new URL("icons/icon-192.png", ROOT).href,
      badge: new URL("icons/icon-192.png", ROOT).href,
      tag: noticeId ? `musmatch-${noticeId}` : "musmatch-notice",
      data: { url: new URL(target, ROOT).href },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      let target = new URL("notifications/", ROOT);
      try {
        const candidate = new URL(event.notification.data?.url);
        if (
          candidate.origin === ROOT.origin &&
          candidate.pathname.startsWith(ROOT.pathname)
        )
          target = candidate;
      } catch {
        /* Only open MusMatch. */
      }
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        const url = new URL(client.url);
        if (
          url.origin === ROOT.origin &&
          url.pathname.startsWith(ROOT.pathname)
        ) {
          const navigated = await client.navigate(target.href);
          if (navigated) return navigated.focus();
        }
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
// A rotated subscription needs a signed-in user to bind it to an account again.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients
      .matchAll({ type: "window" })
      .then((clients) =>
        clients.forEach((client) =>
          client.postMessage({ type: "MUSMATCH_PUSH_CHANGED" }),
        ),
      ),
  );
});
