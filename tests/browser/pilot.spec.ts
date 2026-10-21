import { test, expect, type Page } from "@playwright/test";
import { mockBackend, userId, eventId } from "./fixtures";
const issueId = "40000000-0000-4000-8000-000000000001";
const fixtureMatch = {
  event_id: eventId,
  title: "Mesa real de prueba del viernes con un título largo",
  starts_at: "2030-10-15T19:00:00Z",
  match_type: "COMPETITIVE",
  status: "FULL",
  result_status: null as string | null,
  rules_variant: "EIGHT_KINGS",
  points_per_game: 40,
  games_to_win: 3,
  vacas_to_win: 1,
  report_a: false,
  report_b: false,
  winner_team: null as string | null,
  result_score: null as string | null,
  elo_applied: false,
  players: Array.from({ length: 4 }, (_, i) => ({
    user_id: i === 0 ? userId : `player-${i}`,
    username: `Jugador_con_nombre_largo_${i}`,
    team: i < 2 ? "A" : "B",
    checked_in: false,
    is_mock: false,
  })),
};
const fixtureIssue = {
  id: issueId,
  reporter_id: userId,
  event_id: eventId,
  category: "PRESENCE",
  severity: "NORMAL",
  title: "La cámara no se abre",
  steps: "Abro la partida y pulso escanear",
  expected: "Que se abra la cámara",
  actual: "Aparece una pantalla sin imagen",
  environment: { platform: "ANDROID", browser: "CHROME", display: "APP" },
  status: "OPEN",
  review_note: null as string | null,
  revision: 0,
  created_at: "2026-10-21T10:00:00Z",
};
async function pilot(
  page: Page,
  {
    admin = false,
    enrolled = true,
    reportError = false,
    enrollError = false,
    issue = false,
    loadError = false,
  } = {},
) {
  await mockBackend(page);
  const state = structuredClone(fixtureMatch);
  const tickets = issue ? [structuredClone(fixtureIssue)] : [];
  let tracked = enrolled;
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      table = url.pathname.split("/").pop()!;
    if (table === "profiles") {
      await route.fulfill({ json: { id: userId, is_admin: admin } });
      return;
    }
    if (table === "pilot_matches") {
      if (loadError) {
        await route.fulfill({ status: 503, json: { message: "Unavailable" } });
        return;
      }
      await route.fulfill({
        json: tracked
          ? [{ event_id: eventId, enrolled_at: "2026-10-21T10:00:00Z" }]
          : [],
      });
      return;
    }
    if (table === "pilot_issues") {
      await route.fulfill({ json: tickets });
      return;
    }
    if (table === "events" && url.searchParams.has("created_by")) {
      await route.fulfill({ json: [{ id: eventId, title: state.title }] });
      return;
    }
    if (!url.pathname.includes("/rpc/")) {
      await route.fallback();
      return;
    }
    const body = request.postDataJSON() || {};
    calls.push({ name: table, body });
    if (table === "get_pilot_match_state") {
      await route.fulfill({ json: state });
      return;
    }
    if (table === "enroll_pilot_match") {
      if (enrollError) {
        await route.fulfill({
          status: 400,
          json: {
            message:
              "El piloto requiere cuentas reales. Usa el simulador para las pruebas con mocks",
          },
        });
        return;
      }
      tracked = true;
      await route.fulfill({ json: null });
      return;
    }
    if (table === "report_pilot_issue") {
      if (reportError) {
        await route.fulfill({
          status: 503,
          json: { message: "No se pudo enviar la incidencia" },
        });
        return;
      }
      tickets.push({
        ...fixtureIssue,
        title: body.p_title as string,
        steps: body.p_steps as string,
        expected: body.p_expected as string,
        actual: body.p_actual as string,
        event_id: body.p_event_id as string,
        environment: body.p_environment as typeof fixtureIssue.environment,
      });
      await route.fulfill({ json: issueId });
      return;
    }
    if (table === "review_pilot_issue") {
      const ticket = tickets[0];
      Object.assign(ticket, {
        status: body.p_status,
        review_note: body.p_note,
        revision: ticket.revision + 1,
      });
      await route.fulfill({ json: null });
      return;
    }
    await route.fallback();
  });
  return { state, calls };
}
async function fillReport(page: Page) {
  const form = page.getByRole("region", { name: "Comunicar una incidencia" });
  await form
    .getByLabel("Título", { exact: true })
    .fill("No puedo abrir la cámara");
  await form
    .getByLabel("Pasos para repetirlo")
    .fill("Entro en la partida y pulso escanear");
  await form
    .getByLabel("Qué esperabas")
    .fill("Que se abra la cámara del móvil");
  await form
    .getByLabel("Qué ha ocurrido")
    .fill("La cámara se queda con la imagen negra");
}
test("pilot guide shows actual roster and updates presence, report and rating evidence", async ({
  page,
}) => {
  const { state } = await pilot(page);
  await page.goto("pilot/");
  await expect(
    page.getByText("Presencia registrada: 0/4.", { exact: true }),
  ).toBeVisible();
  state.players.forEach((p) => (p.checked_in = true));
  state.report_a = true;
  state.report_b = true;
  state.result_status = "CONFIRMED";
  state.winner_team = "A";
  state.result_score = "3-1";
  state.elo_applied = true;
  await page.getByRole("button", { name: "Actualizar piloto" }).click();
  await expect(
    page.getByText("Presencia registrada: 4/4.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Resultado confirmado: 3-1 · ganador A.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("ELO aplicado. Comprueba el ranking.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Guardar revisión" }),
  ).toHaveCount(0);
});
test("friendly pilot explicitly keeps presence optional and rating unchanged", async ({
  page,
}) => {
  const { state } = await pilot(page);
  state.match_type = "FRIENDLY";
  await page.goto("pilot/");
  await expect(
    page.getByText("La amistosa no exige verificación de presencia.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Sin cambios de ELO.", { exact: true }),
  ).toBeVisible();
});
test("organizer opts an existing match in without creating fixtures or impersonating players", async ({
  page,
}) => {
  const { calls } = await pilot(page, { enrolled: false });
  await page.goto("pilot/");
  await page.getByLabel("Tu partida para el piloto").selectOption(eventId);
  await page.getByRole("button", { name: "Añadir al seguimiento" }).click();
  await expect(page.getByRole("status")).toContainText("Partida incorporada");
  expect(
    calls.filter((c) => c.name === "enroll_pilot_match").map((c) => c.body),
  ).toEqual([{ p_event_id: eventId }]);
  expect(calls.some((c) => /create_match|simulate/.test(c.name))).toBeFalsy();
});
test("mock or invalid pilot enrollment errors remain visible", async ({
  page,
}) => {
  await pilot(page, { enrolled: false, enrollError: true });
  await page.goto("pilot/");
  await page.getByLabel("Tu partida para el piloto").selectOption(eventId);
  await page.getByRole("button", { name: "Añadir al seguimiento" }).click();
  await expect(page.getByRole("status")).toContainText(
    "requiere cuentas reales",
  );
});
test("report uses only explicit form content and bounded device labels, then appears in the own inbox", async ({
  page,
}) => {
  const { calls } = await pilot(page);
  await page.goto("pilot/");
  await fillReport(page);
  await page
    .getByRole("button", { name: "Enviar incidencia", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Incidencia enviada");
  const body = calls.find((c) => c.name === "report_pilot_issue")!.body;
  expect(body.p_event_id).toBeNull();
  expect(Object.keys(body.p_environment as object).sort()).toEqual([
    "browser",
    "display",
    "platform",
  ]);
  expect(JSON.stringify(body)).not.toContain("access_token");
  await expect(
    page.getByRole("heading", {
      name: "No puedo abrir la cámara",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Guardar revisión" }),
  ).toHaveCount(0);
});
test("failed incident report preserves all entered fields for an explicit retry", async ({
  page,
}) => {
  await pilot(page, { reportError: true });
  await page.goto("pilot/");
  await fillReport(page);
  await page
    .getByRole("button", { name: "Enviar incidencia", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("No se pudo enviar");
  await expect(page.getByLabel("Título", { exact: true })).toHaveValue(
    "No puedo abrir la cámara",
  );
});
test("admin triage includes mandatory public-to-reporter note and current revision", async ({
  page,
}) => {
  const { calls } = await pilot(page, { admin: true, issue: true });
  await page.goto("pilot/");
  await expect(
    page.getByRole("heading", { name: "Revisión de incidencias" }),
  ).toBeVisible();
  await page.getByLabel("Estado de la incidencia").selectOption("RESOLVED");
  await page
    .getByLabel("Nota de revisión")
    .fill("Corregido y verificado con el usuario");
  await page.getByRole("button", { name: "Guardar revisión" }).click();
  await expect(page.getByRole("status")).toContainText("Revisión guardada");
  expect(calls.find((c) => c.name === "review_pilot_issue")?.body).toEqual({
    p_issue_id: issueId,
    p_status: "RESOLVED",
    p_note: "Corregido y verificado con el usuario",
    p_revision: 0,
  });
  await expect(
    page.getByText("Revisión: Corregido y verificado con el usuario", {
      exact: true,
    }),
  ).toBeVisible();
});
test("pilot load failures explain retry instead of inventing a successful field run", async ({
  page,
}) => {
  await pilot(page, { loadError: true });
  await page.goto("pilot/");
  await expect(page.getByRole("status")).toContainText(
    "No se pudo cargar el piloto",
  );
});
for (const width of [320, 390, 768, 1024, 1440])
  test(`pilot and admin feedback fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await pilot(page, { admin: true, issue: true });
    await page.goto("pilot/");
    await expect(
      page.getByRole("heading", { name: "Revisión de incidencias" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
  });
