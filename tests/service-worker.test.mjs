import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = await readFile("public/sw.js", "utf8");
function worker(windows = [], options = {}) {
  const listeners = {},
    notices = [],
    opened = [],
    lifecycle = [];
  const stores = new Map(
    Object.entries(options.caches || {}).map(([name, entries]) => [
      name,
      new Map(Object.entries(entries)),
    ]),
  );
  const key = (request) =>
    typeof request === "string" ? request : request.url;
  const network = async (request) => {
    if (options.networkError) throw new Error("Offline");
    return new Response("network:" + key(request));
  };
  vm.runInNewContext(source, {
    URL,
    Response,
    fetch: network,
    caches: {
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
      open: async (name) => {
        if (!stores.has(name)) stores.set(name, new Map());
        const cache = stores.get(name);
        return {
          addAll: async (urls) => {
            if (options.installFailure) throw new Error("Asset unavailable");
            lifecycle.push(urls);
            for (const url of urls) cache.set(url, "cached:" + url);
          },
          match: async (req) => {
            const hit = cache.get(key(req));
            return hit === undefined ? undefined : new Response(hit);
          },
          put: async (req, response) => {
            cache.set(key(req), await response.text());
          },
        };
      },
    },
    self: {
      location: { href: "https://example.test/musmatch/sw.js" },
      skipWaiting: async () => lifecycle.push("activated"),
      registration: { showNotification: async (...args) => notices.push(args) },
      clients: {
        claim: async () => {},
        matchAll: async () => windows,
        openWindow: async (url) => opened.push(url),
      },
      addEventListener: (type, fn) => {
        listeners[type] = fn;
      },
    },
  });
  return {
    notices,
    opened,
    lifecycle,
    stores,
    fire: async (type, event = {}) => {
      let waiting, response;
      listeners[type]({
        ...event,
        waitUntil: (p) => {
          waiting = p;
        },
        respondWith: (p) => {
          response = p;
        },
      });
      await waiting;
      return response ? await response : undefined;
    },
  };
}
test("push uses local icons, stable notification tags and safe MusMatch destinations", async () => {
  const sw = worker();
  await sw.fire("push", {
    data: {
      json: () => ({
        notificationId: "10000000-0000-4000-8000-000000000001",
        eventId: "20000000-0000-4000-8000-000000000001",
        body: "Novedades",
        url: "https://evil.test",
      }),
    },
  });
  const [title, n] = sw.notices[0];
  assert.equal(title, "MusMatch");
  assert.equal(n.icon, "https://example.test/musmatch/icons/icon-192.png");
  assert.equal(
    n.data.url,
    "https://example.test/musmatch/events/?id=20000000-0000-4000-8000-000000000001",
  );
  await sw.fire("push", {
    data: {
      json: () => {
        throw new Error("invalid json");
      },
    },
  });
  assert.equal(
    sw.notices[1][1].data.url,
    "https://example.test/musmatch/notifications/",
  );
});
test("notification click reuses only MusMatch windows and rejects external or sibling-app URLs", async () => {
  let navigated,
    focused = false;
  const sw = worker([
    {
      url: "https://example.test/poufer/",
      navigate: () => {
        assert.fail("Sibling app navigated");
      },
    },
    {
      url: "https://example.test/musmatch/",
      navigate: async (url) => {
        navigated = url;
        return {
          focus: async () => {
            focused = true;
          },
        };
      },
    },
  ]);
  await sw.fire("notificationclick", {
    notification: { close() {}, data: { url: "https://evil.test/private" } },
  });
  assert.equal(navigated, "https://example.test/musmatch/notifications/");
  assert.ok(focused);
  const empty = worker();
  await empty.fire("notificationclick", {
    notification: {
      close() {},
      data: { url: "https://example.test/gazalbide-stats/" },
    },
  });
  assert.equal(empty.opened[0], "https://example.test/musmatch/notifications/");
});

test("worker waits for explicit scoped update consent instead of activating during install", async () => {
  const sw = worker();
  await sw.fire("install");
  assert.equal(sw.lifecycle.includes("activated"), false);
  for (const url of [
    "https://evil.test/musmatch/",
    "https://example.test/poufer/",
  ])
    await sw.fire("message", {
      data: { type: "MUSMATCH_SKIP_WAITING" },
      source: { url },
    });
  assert.equal(sw.lifecycle.includes("activated"), false);
  await sw.fire("message", {
    data: { type: "MUSMATCH_SKIP_WAITING" },
    source: { url: "https://example.test/musmatch/login/" },
  });
  assert.equal(sw.lifecycle.at(-1), "activated");
});
test("activation keeps one previous app release and never deletes sibling-app caches", async () => {
  const sw = worker([], {
    caches: {
      "musmatch-/musmatch/-old0": {},
      "musmatch-/musmatch/-old1": {},
      "musmatch-/musmatch/-old2": {},
      "poufer-cache": {},
    },
  });
  await sw.fire("install");
  await sw.fire("activate");
  assert.equal(sw.stores.has("musmatch-/musmatch/-old0"), false);
  assert.equal(sw.stores.has("musmatch-/musmatch/-old1"), false);
  assert.ok(sw.stores.has("musmatch-/musmatch/-old2"));
  assert.ok(sw.stores.has("poufer-cache"));
});
test("offline navigation uses only a generic fallback; HTML and authenticated data are never cached", async () => {
  const sw = worker([], { networkError: true });
  await sw.fire("install");
  const response = await sw.fire("fetch", {
    request: {
      url: "https://example.test/musmatch/events/?id=private-id",
      method: "GET",
      mode: "navigate",
    },
  });
  assert.equal(
    await response.text(),
    "cached:https://example.test/musmatch/offline.html",
  );
  for (const request of [
    { url: "https://project.supabase.co/rest/v1/profiles", method: "GET" },
    { url: "https://example.test/musmatch/events/", method: "POST" },
    { url: "https://example.test/poufer/", method: "GET" },
    { url: "https://example.test/musmatch/events/index.txt", method: "GET" },
  ])
    assert.equal(await sw.fire("fetch", { request }), undefined);
  const entries = [...sw.stores.values()].flatMap((x) => [...x.keys()]);
  assert.ok(
    entries.every((x) => !x.includes("private-id") && !x.includes("profiles")),
  );
  const empty = worker([], { networkError: true });
  assert.equal(
    (
      await empty.fire("fetch", {
        request: {
          url: "https://example.test/musmatch/",
          method: "GET",
          mode: "navigate",
        },
      })
    ).status,
    503,
  );
});
test("immutable chunks from the previous release stay available offline", async () => {
  const url = "https://example.test/musmatch/_next/static/old-chunk.js";
  const sw = worker([], {
    networkError: true,
    caches: { "musmatch-/musmatch/-previous": { [url]: "old chunk" } },
  });
  const response = await sw.fire("fetch", {
    request: { url, method: "GET", mode: "cors" },
  });
  assert.equal(await response.text(), "old chunk");
});

test("a failed precache install discards only the incomplete release", async () => {
  const sw = worker([], {
    installFailure: true,
    caches: { "musmatch-/musmatch/-working": {}, "other-app": {} },
  });
  await assert.rejects(sw.fire("install"));
  assert.deepEqual(
    [...sw.stores.keys()],
    ["musmatch-/musmatch/-working", "other-app"],
  );
});
