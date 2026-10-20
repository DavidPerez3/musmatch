import { test as base, expect } from "@playwright/test";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { mockBackend } from "./fixtures";
const test = base.extend<{ site: { url: string; upgrade: () => void } }>({
  site: async ({}, provide) => {
    let version = 1;
    const root = path.resolve("out");
    const server = http.createServer(async (req, res) => {
      try {
        let name = decodeURIComponent(
          new URL(req.url!, "http://local").pathname,
        );
        if (!name.startsWith("/musmatch/")) {
          res.writeHead(404).end();
          return;
        }
        name = name.slice("/musmatch".length);
        if (name.endsWith("/")) name += "index.html";
        const file = path.resolve(root, "." + name);
        if (!file.startsWith(root + path.sep)) {
          res.writeHead(403).end();
          return;
        }
        let data = await readFile(file);
        if (name === "/sw.js")
          data = Buffer.from(
            data
              .toString()
              .replace(
                /const VERSION = "[a-f0-9]+"/,
                `const VERSION = "test-release-${version}"`,
              ),
          );
        const types: Record<string, string> = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".png": "image/png",
          ".webmanifest": "application/manifest+json",
        };
        res
          .writeHead(200, {
            "Content-Type": types[path.extname(file)] || "text/plain",
            "Cache-Control": "no-store",
          })
          .end(data);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    try {
      await provide({
        url: `http://127.0.0.1:${port}/musmatch/`,
        upgrade: () => {
          version++;
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
});
test.use({ serviceWorkers: "allow" });
test("real worker waits for consent, preserves forms when postponed and reloads only the requesting tab", async ({
  page,
  context,
  site,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await mockBackend(page, false);
  await page.goto(site.url + "login/?source=pwa-test");
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBeTruthy();
  await expect(
    page.getByRole("button", { name: "Actualizar y recargar" }),
  ).toHaveCount(0);
  await page.locator("input[type=email]").fill("unsaved@example.test");
  const other = await context.newPage();
  await mockBackend(other, false);
  await other.goto(site.url + "login/");
  await other.locator("input[type=email]").fill("other-tab@example.test");
  site.upgrade();
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg!.update();
  });
  await expect(
    page.getByText("Nueva versión disponible", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Más tarde" }).click();
  await expect(
    page.getByText("Nueva versión disponible", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("input[type=email]")).toHaveValue(
    "unsaved@example.test",
  );
  await page.getByLabel("Más opciones", { exact: true }).click();
  await page.getByRole("button", { name: "Buscar actualizaciones" }).click();
  await page.getByLabel("Más opciones", { exact: true }).click();
  await expect(
    page.getByText("Nueva versión disponible", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Actualizar y recargar" }).click();
  await expect(page.locator("input[type=email]")).toHaveValue(
    "unsaved@example.test",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await Promise.all([
    page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame()),
    page.getByRole("button", { name: "Actualizar y recargar" }).click(),
  ]);
  await expect(page.locator("input[type=email]")).toHaveValue("");
  expect(page.url()).toContain("?source=pwa-test");
  await expect(other.locator("input[type=email]")).toHaveValue(
    "other-tab@example.test",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        caches
          .keys()
          .then((keys) => keys.filter((k) => k.startsWith("musmatch-")).length),
      ),
    )
    .toBe(2);
  await other.close();
});
test("real offline fallback preserves the original route and reconnecting never replays or reloads automatically", async ({
  page,
  context,
  site,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await mockBackend(page, false);
  await page.goto(site.url + "login/?source=offline-test");
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBeTruthy();
  await page.locator("input[type=email]").fill("draft@example.test");
  await context.setOffline(true);
  await expect(page.getByText("Sin conexión", { exact: true })).toBeVisible();
  await expect(page.locator("input[type=email]")).toHaveValue(
    "draft@example.test",
  );
  await context.setOffline(false);
  await expect(
    page.getByText("Conexión recuperada.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("input[type=email]")).toHaveValue(
    "draft@example.test",
  );
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Necesitas conexión para continuar" }),
  ).toBeVisible();
  expect(page.url()).toContain("/login/?source=offline-test");
  await context.setOffline(false);
  await expect(
    page.getByRole("heading", { name: "Necesitas conexión para continuar" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.locator("input[type=email]")).toBeVisible();
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    return (
      await Promise.all(
        names.map(async (name) =>
          (await (await caches.open(name)).keys()).map((r) => r.url),
        ),
      )
    ).flat();
  });
  expect(
    cached.some(
      (url) =>
        url.includes("source=offline-test") ||
        url.includes("/rest/v1/") ||
        url.includes("/auth/v1/"),
    ),
  ).toBeFalsy();
});
