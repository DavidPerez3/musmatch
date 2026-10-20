import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = await readFile("public/sw.js", "utf8");
function worker(windows = []) {
  const listeners = {},
    notices = [],
    opened = [],
    lifecycle = [];
  vm.runInNewContext(source, {
    URL,
    caches: {
      open: async () => ({
        addAll: async (urls) => {
          lifecycle.push(urls);
        },
      }),
    },
    self: {
      location: { href: "https://example.test/musmatch/sw.js" },
      skipWaiting: async () => {
        lifecycle.push("activated");
      },
      registration: { showNotification: async (...args) => notices.push(args) },
      clients: {
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
    fire: async (type, event = {}) => {
      let waiting;
      listeners[type]({
        ...event,
        waitUntil: (p) => {
          waiting = p;
        },
      });
      await waiting;
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

test("backward-compatible worker update activates push handlers without waiting for every tab to close", async () => {
  const sw = worker();
  await sw.fire("install");
  assert.equal(sw.lifecycle[1], "activated");
  assert.ok(
    sw.lifecycle[0].every((url) =>
      url.startsWith("https://example.test/musmatch/"),
    ),
  );
  assert.ok(sw.lifecycle[0].every((url) => !url.includes("supabase")));
});
