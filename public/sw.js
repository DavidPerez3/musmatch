const ROOT = new URL("./", self.location.href);
const CACHE = `musmatch-${ROOT.pathname}-v1`;
const OFFLINE = new URL("offline.html", ROOT).href;
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([OFFLINE, new URL("icons/icon-192.png", ROOT).href, new URL("icons/icon-512.png", ROOT).href])));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(`musmatch-${ROOT.pathname}-`) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  // Never cache accounts, OAuth responses, or Supabase data.
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
  } else if (url.pathname.startsWith(`${ROOT.pathname}_next/static/`) || url.pathname.startsWith(`${ROOT.pathname}icons/`) || url.pathname.startsWith(`${ROOT.pathname}brand/`)) {
    event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
      return response;
    })));
  }
});
