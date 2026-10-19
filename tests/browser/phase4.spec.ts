import { test, expect, type Page } from "@playwright/test";
import { mockBackend, eventId, userId } from "./fixtures";
const invitationId = "40000000-0000-0000-0000-000000000001";
async function setup(page: Page) {
  await mockBackend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://www.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>Isolated map</p>" }),
  );
}
test("private creation separates public area from exact address and never queries maps", async ({
  page,
}) => {
  await setup(page);
  let mapRequests = 0,
    created = false;
  await page.route("**/functions/v1/place-search", (route) => {
    mapRequests++;
    return route.fulfill({ json: { places: [] } });
  });
  await page.route("**/rest/v1/rpc/create_match_v2", (route) => {
    const body = route.request().postDataJSON();
    expect(body.p_location_text).toBe("Gazalbide");
    expect(body.p_location).toMatchObject({
      type: "PRIVATE_LOCATION",
      address: "Dirección secreta 42",
      authorized: true,
    });
    created = true;
    return route.fulfill({ json: eventId });
  });
  await page.goto("create/");
  await page.getByRole("button", { name: /Necesito pareja/ }).click();
  await page.getByLabel("Tipo de lugar").selectOption("PRIVATE_LOCATION");
  await expect(
    page.getByRole("button", { name: "Bares cerca de mí" }),
  ).toHaveCount(0);
  await page.getByLabel("Zona visible para todos").fill("Gazalbide");
  await page.getByLabel("Dirección privada").fill("Dirección secreta 42");
  await expect(
    page.getByRole("button", { name: "Crear partida", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /Confirmo que dispongo/ }).check();
  await page
    .getByRole("button", { name: "Crear partida", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`events/\\?id=${eventId}`));
  expect(created).toBe(true);
  expect(mapRequests).toBe(0);
});
test("public search selects OSM coordinates and distinguishes unconfirmed candidates", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/rest/v1/venues?**", (route) =>
    route.fulfill({
      json: [
        {
          id: "50000000-0000-0000-0000-000000000001",
          name: "Bar Indartsu",
          status: "CANDIDATE",
          address: null,
          conditions: "Pendiente de confirmar",
        },
      ],
    }),
  );
  let searched = 0;
  await page.route("**/functions/v1/place-search", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      query: "Bar sintético Vitoria",
    });
    searched++;
    return route.fulfill({
      json: {
        places: [
          {
            name: "Bar sintético",
            address: "Bar sintético, Vitoria",
            latitude: 42.85,
            longitude: -2.67,
            osm_ref: "node/123",
          },
        ],
      },
    });
  });
  await page.goto("create/");
  await expect(
    page
      .getByLabel("Locales propuestos")
      .getByRole("option", {
        name: "Bar Indartsu · Sin colaboración confirmada",
      }),
  ).toHaveCount(1);
  await page
    .getByLabel("Buscar nombre y municipio")
    .fill("Bar sintético Vitoria");
  expect(searched).toBe(0);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page
    .getByRole("button", { name: /Bar sintético.*Bar sintético/ })
    .click();
  await expect(page.getByLabel("Ubicación", { exact: true })).toHaveValue(
    "Bar sintético, Vitoria",
  );
  await expect(page.getByTitle("Mapa del lugar seleccionado")).toHaveAttribute(
    "src",
    /marker=42.85,-2.67/,
  );
  await expect(page.locator("main")).toContainText("no reserva mesa");
});
test("GPS permission denial leaves manual location available", async ({
  page,
}) => {
  await setup(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (_success: unknown, error: (e: unknown) => void) =>
          error({ code: 1 }),
      },
    }),
  );
  await page.goto("create/");
  await page.getByRole("button", { name: "Bares cerca de mí" }).click();
  await expect(page.getByRole("status")).toContainText(
    "No se pudo obtener tu ubicación",
  );
  await page.getByLabel("Ubicación", { exact: true }).fill("Punto manual");
  await expect(page.getByLabel("Ubicación", { exact: true })).toHaveValue(
    "Punto manual",
  );
});
test("inbox requires acceptance and opens the selected match", async ({
  page,
}) => {
  await setup(page);
  let accepted = false;
  await page.route("**/rest/v1/match_invitations?**", (route) =>
    route.fulfill({
      json: accepted
        ? []
        : [
            {
              id: invitationId,
              event_id: eventId,
              team: "A",
              created_at: "2026-10-19T10:00:00Z",
            },
          ],
    }),
  );
  await page.route("**/rest/v1/rpc/respond_match_invitation", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      p_invitation_id: invitationId,
      p_accept: true,
    });
    accepted = true;
    return route.fulfill({ json: null });
  });
  await page.goto("my-matches/");
  await expect(
    page.getByRole("button", { name: "Aceptar invitación" }),
  ).toBeEnabled();
  expect(accepted).toBe(false);
  await page.getByRole("button", { name: "Aceptar invitación" }).click();
  await expect(page).toHaveURL(new RegExp(`events/\\?id=${eventId}`));
  expect(accepted).toBe(true);
});
test("organizer cancellation removes joining, presence and result actions", async ({
  page,
}) => {
  await setup(page);
  let cancelled = false;
  await page.route("**/rest/v1/events?**", (route) => {
    const single = route
      .request()
      .headers()
      .accept?.includes("application/vnd.pgrst.object+json");
    const e = {
      id: eventId,
      created_by: userId,
      title: "Mesa cancelable",
      starts_at: "2030-10-19T18:00:00Z",
      match_type: "COMPETITIVE",
      pair_mode: "FIXED_PAIR",
      status: cancelled ? "CANCELLED" : "FULL",
      result_status: null,
      result_resolution_reason: cancelled
        ? "Cancelada: No se celebra la partida"
        : null,
      rules_version: 1,
      rules_variant: "EIGHT_KINGS",
      points_per_game: 40,
      games_to_win: 3,
      vacas_to_win: 1,
    };
    return route.fulfill({ json: single ? e : [e] });
  });
  await page.route("**/rest/v1/rpc/cancel_match", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      p_event_id: eventId,
      p_reason: "No se celebra la partida",
    });
    cancelled = true;
    return route.fulfill({ json: null });
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`events/?id=${eventId}`);
  await page.getByText("Gestionar partida", { exact: true }).click();
  await page
    .getByLabel("Motivo de cancelación")
    .fill("No se celebra la partida");
  await page
    .getByRole("button", { name: "Cancelar partida", exact: true })
    .click();
  await expect(page.locator("main")).toContainText("Partida cancelada");
  await expect(
    page.getByRole("button", { name: /Unirme|Generar mi QR|Enviar Resultado/ }),
  ).toHaveCount(0);
});
test("admin sees both reports and records a justified neutral resolution", async ({
  page,
}) => {
  await setup(page);
  let resolved = false;
  await page.route("**/rest/v1/events?**", (route) =>
    route.fulfill({
      json: resolved
        ? []
        : [
            {
              id: eventId,
              title: "Disputa de prueba",
              match_type: "COMPETITIVE",
              status: "CLOSED",
              result_status: "DISPUTED",
              rules_version: 1,
              rules_variant: "EIGHT_KINGS",
              points_per_game: 40,
              games_to_win: 3,
              vacas_to_win: 1,
              result_team_a_winner: "A",
              result_team_a_score: "3-1",
              result_team_b_winner: "B",
              result_team_b_score: "1-3",
            },
          ],
    }),
  );
  await page.route("**/rest/v1/rpc/review_match_dispute", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      p_event_id: eventId,
      p_decision: "VOID",
      p_reason: "No hay pruebas suficientes para adjudicar ganador",
      p_apply_elo: false,
    });
    resolved = true;
    return route.fulfill({ json: null });
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("admin/");
  await expect(page.getByRole("heading", { name: "Reporte A" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reporte B" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Registrar resolución" }),
  ).toBeDisabled();
  await page
    .getByLabel("Motivo de resolución (visible a participantes)")
    .fill("No hay pruebas suficientes para adjudicar ganador");
  await page.getByRole("button", { name: "Registrar resolución" }).click();
  await expect(page.locator("main")).toContainText(
    "No hay disputas pendientes",
  );
  expect(resolved).toBe(true);
});
test("profile distinguishes pending and cancelled matches from defeats", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/rest/v1/user_match_history?**", (route) =>
    route.fulfill({
      json: [
        {
          match_id: eventId,
          title: "Partida sin resultado",
          team: "A",
          created_at: "2026-10-19T10:00:00Z",
          result: "PENDING",
        },
        {
          match_id: "cancelled-id",
          title: "Partida anulada",
          team: "B",
          created_at: "2026-10-19T10:00:00Z",
          result: "CANCELLED",
        },
      ],
    }),
  );
  await page.goto("profile/");
  await expect(page.locator("main")).toContainText("Pendiente");
  await expect(page.locator("main")).toContainText("Cancelada");
  await expect(page.locator("main")).not.toContainText("✗ Derrota");
});
