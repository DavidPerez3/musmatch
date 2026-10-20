import { test, expect, type Page } from "@playwright/test";
import { mockBackend, userId, eventId } from "./fixtures";
async function notifications(
  page: Page,
  { supported = true, permission = "default", ios = false, fail = false } = {},
) {
  await mockBackend(page);
  await page.addInitScript(
    ({ supported, permission, ios }) => {
      const state = {
        subscription: null as null | {
          endpoint: string;
          toJSON: () => object;
          unsubscribe: () => Promise<boolean>;
        },
        requests: 0,
      };
      Object.assign(window, { pushTest: state });
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: {
          permission,
          requestPermission: async () => {
            state.requests++;
            return permission === "denied" ? "denied" : "granted";
          },
        },
      });
      Object.defineProperty(window, "PushManager", {
        configurable: true,
        value: supported ? function () {} : undefined,
      });
      if (!supported)
        delete (window as unknown as Record<string, unknown>).PushManager;
      if (ios)
        Object.defineProperty(navigator, "userAgent", {
          value: "iPhone Safari",
        });
      const registration = {
        pushManager: {
          getSubscription: async () => state.subscription,
          subscribe: async () => {
            state.subscription = {
              endpoint: "https://fcm.googleapis.com/fcm/send/browser-test",
              toJSON: () => ({
                endpoint: "https://fcm.googleapis.com/fcm/send/browser-test",
                keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
              }),
              unsubscribe: async () => {
                state.subscription = null;
                return true;
              },
            };
            return state.subscription;
          },
        },
      };
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
          register: async () => registration,
          getRegistration: async () => registration,
          ready: Promise.resolve(registration),
          addEventListener() {},
          removeEventListener() {},
        },
      });
    },
    { supported, permission, ios },
  );
  const prefs = {
    invitations: true,
    matches: true,
    results: true,
    reminders: true,
    friends: true,
    push_enabled: false,
  };
  const notices = [
    {
      id: "40000000-0000-4000-8000-000000000001",
      user_id: userId,
      event_id: eventId,
      category: "invitations",
      title: "Invitación a una partida",
      body: "Te han invitado a jugar. Mesa del viernes.",
      created_at: "2026-10-20T08:00:00Z",
      read_at: null as string | null,
    },
  ];
  let devices: { id: string; device_name: string; updated_at: string }[] = [];
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      name = url.pathname.split("/").pop()!;
    if (name === "notifications") {
      if (fail) {
        await route.fulfill({ status: 503, json: { message: "Unavailable" } });
        return;
      }
      await route.fulfill({
        json: notices,
        headers: {
          "access-control-expose-headers": "content-range",
          "content-range": `0-0/${notices.filter((n) => !n.read_at).length}`,
        },
      });
      return;
    }
    if (name === "notification_preferences") {
      await route.fulfill({ json: prefs });
      return;
    }
    if (!url.pathname.includes("/rpc/")) {
      await route.fallback();
      return;
    }
    const body = req.postDataJSON() || {};
    calls.push({ name, body });
    if (name === "list_push_devices") await route.fulfill({ json: devices });
    else if (name === "get_push_subscription_status")
      await route.fulfill({ json: devices[0]?.id || null });
    else if (name === "get_push_public_key")
      await route.fulfill({ json: "B".repeat(87) });
    else if (name === "register_push_subscription") {
      prefs.push_enabled = true;
      devices = [
        {
          id: "device-1",
          device_name: "Android",
          updated_at: new Date().toISOString(),
        },
      ];
      await route.fulfill({ json: "device-1" });
    } else if (name === "save_notification_preferences") {
      Object.assign(prefs, body.p_preferences);
      await route.fulfill({ json: null });
    } else if (name === "mark_notifications_read") {
      notices.forEach((n) => (n.read_at = new Date().toISOString()));
      await route.fulfill({ json: null });
    } else if (name === "remove_push_subscription") {
      devices = [];
      prefs.push_enabled = false;
      await route.fulfill({ json: null });
    } else if (name === "request_test_notification")
      await route.fulfill({ json: null });
    else await route.fallback();
  });
  return calls;
}
test("inbox marks only explicit reads, updates bell and links to real invitation acceptance", async ({
  page,
}) => {
  await notifications(page);
  await page.goto("notifications/");
  await expect(
    page.getByRole("heading", {
      name: "Invitación a una partida",
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Avisos, 1 sin leer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Ver invitaciones" }),
  ).toHaveAttribute("href", "/musmatch/my-matches/");
  await page.getByRole("button", { name: "Marcar todos como leídos" }).click();
  await expect(page.getByText("Sin leer", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Avisos", exact: true }),
  ).toBeVisible();
});
test("push asks permission only after click, registers device, queues self-test and removes it", async ({
  page,
}) => {
  const calls = await notifications(page);
  await page.goto("notifications/");
  await expect(
    page.getByRole("heading", { name: "Qué quieres recibir" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { pushTest: { requests: number } }).pushTest
          .requests,
    ),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Activar en este dispositivo" })
    .click();
  await expect(
    page.getByText("Este dispositivo está registrado.", { exact: true }),
  ).toBeVisible();
  expect(
    calls.find((c) => c.name === "register_push_subscription")?.body
      .p_subscription,
  ).toHaveProperty(
    "endpoint",
    "https://fcm.googleapis.com/fcm/send/browser-test",
  );
  await page
    .getByRole("button", { name: "Enviar notificación de prueba" })
    .click();
  await expect(page.getByRole("status")).toContainText("Prueba en cola");
  await page
    .getByRole("button", { name: "Desactivar en este dispositivo" })
    .click();
  await expect(
    page.getByText("Este dispositivo no está registrado.", { exact: true }),
  ).toBeVisible();
  expect(calls.some((c) => c.name === "remove_push_subscription")).toBeTruthy();
});
test("category preferences persist without removing old inbox notices", async ({
  page,
}) => {
  const calls = await notifications(page);
  await page.goto("notifications/");
  await expect(
    page.getByRole("heading", {
      name: "Invitación a una partida",
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Invitaciones", exact: true })
    .uncheck();
  await expect(
    page.getByRole("checkbox", { name: "Invitaciones", exact: true }),
  ).not.toBeChecked();
  await expect
    .poll(
      () => calls.find((c) => c.name === "save_notification_preferences")?.body,
    )
    .toEqual({ p_preferences: { invitations: false } });
  await expect(page.getByRole("status")).toContainText("Cambios guardados");
  await expect(
    page.getByRole("heading", {
      name: "Invitación a una partida",
      exact: false,
    }),
  ).toBeVisible();
});
test("denied permissions explain browser settings and never register a push endpoint", async ({
  page,
}) => {
  const calls = await notifications(page, { permission: "denied" });
  await page.goto("notifications/");
  await expect(
    page.getByText("El permiso está bloqueado.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Activar en este dispositivo" }),
  ).toBeDisabled();
  expect(
    calls.some((c) => c.name === "register_push_subscription"),
  ).toBeFalsy();
});
test("iOS browser explains installation; unsupported browsers keep the inbox usable", async ({
  page,
}) => {
  await notifications(page, { ios: true });
  await page.goto("notifications/");
  await expect(
    page.getByText("En iPhone o iPad, añade MusMatch", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Activar en este dispositivo" }),
  ).toHaveCount(0);
});
test("inbox errors are visible with a retry action", async ({ page }) => {
  await notifications(page, { supported: false, fail: true });
  await page.goto("notifications/");
  await expect(page.getByRole("status")).toContainText("No se pudieron cargar");
  await expect(
    page.getByRole("button", { name: "Actualizar", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Este navegador no permite notificaciones push.", {
      exact: false,
    }),
  ).toBeVisible();
});
for (const width of [320, 390, 768, 1024, 1440])
  test(`notification inbox fits ${width}px without horizontal overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await notifications(page);
    await page.goto("notifications/");
    await expect(
      page.getByRole("heading", {
        name: "Invitación a una partida",
        exact: false,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
  });
