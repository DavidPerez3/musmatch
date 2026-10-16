import { test, expect, type Page } from "@playwright/test";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { mockBackend, eventId } from "./fixtures";

type CameraState = {
  requests: number;
  stopped: number;
  constraints: MediaStreamConstraints | null;
  release?: () => void;
};
async function camera(
  page: Page,
  payload: string,
  mode: "normal" | "denied" | "delayed" | "blank" = "normal",
) {
  const image = await QRCode.toDataURL(payload, { width: 480, margin: 4 });
  await page.addInitScript(
    ({ image, mode }) => {
      const state: CameraState = { requests: 0, stopped: 0, constraints: null };
      (window as unknown as { cameraState: CameraState }).cameraState = state;
      async function stream() {
        const canvas = document.createElement("canvas");
        canvas.width = 480;
        canvas.height = 480;
        const img = new Image();
        img.src = image;
        await img.decode();
        const media = canvas.captureStream(10);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, 480, 480);
        if (mode !== "blank") ctx.drawImage(img, 0, 0, 480, 480);
        for (const track of media.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            state.stopped++;
            stop();
          };
        }
        return media;
      }
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async (constraints: MediaStreamConstraints) => {
            state.requests++;
            state.constraints = constraints;
            if (mode === "denied")
              throw new DOMException("Denied by test", "NotAllowedError");
            if (mode === "delayed")
              return new Promise<MediaStream>((resolve) => {
                state.release = () => {
                  void stream().then(resolve);
                };
              });
            return stream();
          },
        },
      });
    },
    { image, mode },
  );
}
const state = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { cameraState: CameraState }).cameraState,
  );
async function open(page: Page) {
  await page.goto(`events/?id=${eventId}`);
  await page
    .getByRole("button", { name: "Escanear rival", exact: true })
    .click();
}

test("QR is generated locally and a real camera frame is decoded once without audio", async ({
  page,
}, testInfo) => {
  await mockBackend(page, true, { pendingPresence: true });
  await camera(page, `musmatch:presence:v1:${eventId}:EFGH34`);
  let submissions = 0;
  await page.route("**/rest/v1/rpc/submit_presence_token", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      p_event_id: eventId,
      p_token: "EFGH34",
    });
    submissions++;
    await route.fulfill({ json: "PROOF_ACCEPTED" });
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`events/?id=${eventId}`);
  const own = page.getByRole("img", {
    name: "Mi QR de presencia: muéstralo a un rival",
  });
  await expect(own).toBeVisible();
  const pixels = await own.evaluate(async (img) => {
    const image = img as HTMLImageElement;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return {
      data: Array.from(data.data),
      width: data.width,
      height: data.height,
    };
  });
  expect(
    jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height)?.data,
  ).toBe(`musmatch:presence:v1:${eventId}:ABCD12`);
  await page
    .getByRole("region", { name: "Mi presencia" })
    .screenshot({ path: testInfo.outputPath("presence-qr-mobile.png") });
  expect((await state(page)).requests).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page
    .getByRole("button", { name: "Escanear rival", exact: true })
    .click();
  await expect(page.locator("main")).toContainText("Código rival validado");
  expect(submissions).toBe(1);
  await expect.poll(async () => (await state(page)).stopped).toBe(1);
  expect((await state(page)).constraints).toMatchObject({
    audio: false,
    video: { facingMode: { ideal: "environment" } },
  });
  await expect(
    page.getByRole("region", { name: "Escáner de presencia" }),
  ).toHaveCount(0);
});

for (const [payload, message] of [
  [
    `musmatch:presence:v1:20000000-0000-0000-0000-000000000009:EFGH34`,
    "otra partida",
  ],
  ["https://example.test/untrusted", "no es un código de presencia"],
  ["musmatch:presence:v2:bad", "no es un código de presencia"],
])
  test(`scanner rejects foreign or malformed QR: ${payload}`, async ({
    page,
  }) => {
    await mockBackend(page, true, { pendingPresence: true });
    await camera(page, payload);
    let submitted = false;
    await page.route("**/rest/v1/rpc/submit_presence_token", async (route) => {
      submitted = true;
      await route.abort();
    });
    await open(page);
    await expect(page.locator("main").getByRole("alert")).toContainText(
      message,
    );
    expect(submitted).toBe(false);
    expect(page.url()).toContain(`events/?id=${eventId}`);
    expect((await state(page)).stopped).toBe(1);
  });

test("permission denial leaves manual entry available and server replay errors visible", async ({
  page,
}) => {
  await mockBackend(page, true, { pendingPresence: true });
  await camera(page, "test", "denied");
  await open(page);
  await expect(
    page
      .getByRole("region", { name: "Escáner de presencia" })
      .getByRole("alert"),
  ).toContainText("No se ha concedido acceso");
  await page.getByRole("button", { name: "Cerrar escáner" }).click();
  await expect(page.getByLabel("Código de presencia rival")).toBeFocused();
  for (const [status, message] of [
    ["TOKEN_OWN_USER", "propio código"],
    ["TOKEN_SAME_TEAM", "equipo rival"],
    ["TOKEN_EXPIRED", "ha caducado"],
    ["TOKEN_ALREADY_USED", "ya fue utilizado"],
  ]) {
    await page.route("**/rest/v1/rpc/submit_presence_token", (route) =>
      route.fulfill({ json: status }),
    );
    await page.getByLabel("Código de presencia rival").fill("ABCD12");
    await page
      .getByRole("button", { name: "Validar código", exact: true })
      .click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      message,
    );
  }
  await page.route("**/rest/v1/rpc/submit_presence_token", (route) =>
    route.fulfill({
      status: 503,
      json: { message: "Internal database details", code: "XX000" },
    }),
  );
  await page
    .getByRole("button", { name: "Validar código", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Comprueba tu conexión",
  );
  await expect(page.locator("main")).not.toContainText(
    "Internal database details",
  );
});

test("camera is stopped on cancel, navigation and background", async ({
  page,
}) => {
  await mockBackend(page, true, { pendingPresence: true });
  await camera(page, "blank", "blank");
  await open(page);
  await expect.poll(async () => (await state(page)).requests).toBe(1);
  await page.getByRole("button", { name: "Cerrar escáner" }).click();
  await expect.poll(async () => (await state(page)).stopped).toBe(1);
  await page
    .getByRole("button", { name: "Escanear rival", exact: true })
    .click();
  await expect.poll(async () => (await state(page)).requests).toBe(2);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => (await state(page)).stopped).toBe(2);
  await page.evaluate(() =>
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    }),
  );
  await page
    .getByRole("button", { name: "Escanear rival", exact: true })
    .click();
  await expect.poll(async () => (await state(page)).requests).toBe(3);
  await page
    .getByRole("navigation", { name: "Navegación principal" })
    .getByRole("link", { name: "Ranking", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ranking", exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await state(page)).stopped).toBe(3);
});

test("late camera permission after closing never leaves a live stream", async ({
  page,
}) => {
  await mockBackend(page, true, { pendingPresence: true });
  await camera(page, "blank", "delayed");
  await open(page);
  await expect.poll(async () => (await state(page)).requests).toBe(1);
  await page.getByRole("button", { name: "Cerrar escáner" }).click();
  await page.evaluate(() =>
    (window as unknown as { cameraState: CameraState }).cameraState.release?.(),
  );
  await expect.poll(async () => (await state(page)).stopped).toBe(1);
});

test("expired QR is hidden and renewal replaces it; incomplete tables cannot check in", async ({
  page,
}) => {
  await mockBackend(page, true, { pendingPresence: true });
  await page.route("**/rest/v1/rpc/get_my_presence_token_status", (route) =>
    route.fulfill({
      json: {
        token: "ABCD12",
        expires_at: new Date(Date.now() - 1000).toISOString(),
        next_refresh_at: null,
      },
    }),
  );
  await page.route("**/rest/v1/rpc/create_presence_token", (route) =>
    route.fulfill({
      json: {
        token: "EFGH34",
        expires_at: new Date(Date.now() + 120000).toISOString(),
        next_refresh_at: new Date(Date.now() + 30000).toISOString(),
      },
    }),
  );
  await page.goto(`events/?id=${eventId}`);
  await expect(page.locator("main")).toContainText("Tu código ha caducado");
  await expect(
    page.getByRole("img", { name: /Mi QR de presencia/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Generar QR y código", exact: true })
    .click();
  await expect(page.getByLabel("Mi código de presencia")).toHaveText("EFGH34");
  await expect(
    page.getByRole("img", { name: /Mi QR de presencia/ }),
  ).toBeVisible();
  await page.route("**/rest/v1/event_participants?**", (route) =>
    route.fulfill({
      json: [
        {
          id: "participant",
          event_id: eventId,
          user_id: "10000000-0000-0000-0000-000000000001",
          team: "A",
          attendance_status: "PENDING",
        },
      ],
    }),
  );
  await page.reload();
  await expect(page.locator("main")).toContainText(
    "La presencia se habilita al completar",
  );
  await expect(
    page.getByRole("button", { name: "Escanear rival" }),
  ).toHaveCount(0);
});

for (const kind of ["unsupported", "busy"])
  test(`camera ${kind} explains manual alternative`, async ({ page }) => {
    await mockBackend(page, true, { pendingPresence: true });
    await page.addInitScript(
      (kind) =>
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value:
            kind === "unsupported"
              ? undefined
              : {
                  getUserMedia: () =>
                    Promise.reject(
                      new DOMException("Busy", "NotReadableError"),
                    ),
                },
        }),
      kind,
    );
    await open(page);
    await expect(
      page
        .getByRole("region", { name: "Escáner de presencia" })
        .getByRole("alert"),
    ).toContainText(
      kind === "unsupported" ? "no permite acceder" : "está ocupada",
    );
    await page.getByRole("button", { name: "Cerrar escáner" }).click();
    await expect(page.getByLabel("Código de presencia rival")).toBeEditable();
  });

test("server confirmation of four check-ins removes scanning and unlocks result form", async ({
  page,
}) => {
  await mockBackend(page, true, { pendingPresence: true });
  let complete = false;
  await page.route("**/rest/v1/event_participants?**", (route) =>
    route.fulfill({
      json: Array.from({ length: 4 }, (_, i) => ({
        id: `p${i}`,
        event_id: eventId,
        user_id: `10000000-0000-0000-0000-00000000000${i + 1}`,
        team: i < 2 ? "A" : "B",
        attendance_status: complete ? "CHECKED_IN" : "PENDING",
      })),
    }),
  );
  await page.route("**/rest/v1/rpc/submit_presence_token", (route) => {
    complete = true;
    return route.fulfill({ json: "PROOF_ACCEPTED" });
  });
  await page.goto(`events/?id=${eventId}`);
  await expect(
    page.getByRole("button", { name: "Enviar Resultado" }),
  ).toHaveCount(0);
  await page.getByLabel("Código de presencia rival").fill("EFGH34");
  await page
    .getByRole("button", { name: "Validar código", exact: true })
    .click();
  await expect(page.locator("main")).toContainText(
    "Los cuatro jugadores tenéis la presencia validada",
  );
  await expect(
    page.getByRole("button", { name: "Escanear rival" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Enviar Resultado" }),
  ).toBeVisible();
});
