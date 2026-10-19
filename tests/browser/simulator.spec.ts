import { test, expect, type Page } from "@playwright/test";
import { mockBackend, eventId, userId } from "./fixtures";
async function simulatorBackend(page: Page, enabled = true) {
  await mockBackend(page);
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  const players = Array.from({ length: 4 }, (_, i) => ({
    user_id: `10000000-0000-0000-0000-00000000000${i + 1}`,
    username: i === 0 ? "davidprgt" : `musmatch_mock_${i}`,
    slot: i === 0 ? null : i,
    team: i < 2 ? "A" : "B",
    present: true,
    attendance_status: "PENDING",
    token: null as string | null,
    expires_at: null as string | null,
    next_refresh_at: null as string | null,
  }));
  const event = {
    id: eventId,
    title: "SIMULACIÓN · Mesa de mus",
    simulation_owner_id: userId,
    match_type: "COMPETITIVE",
    pair_mode: "FIXED_PAIR",
    rules_version: 1,
    rules_variant: "EIGHT_KINGS",
    points_per_game: 40,
    games_to_win: 3,
    vacas_to_win: 1,
    status: "FULL",
    result_status: null as string | null,
    winner_team: null as string | null,
    result_score: null as string | null,
    result_team_a_winner: null as string | null,
    result_team_b_winner: null as string | null,
    result_team_a_score: null as string | null,
    result_team_b_score: null as string | null,
    result_team_a_submitted_at: null as string | null,
    result_team_b_submitted_at: null as string | null,
    result_resolution_reason: null as string | null,
  };
  const scores = players.map((p) => ({
    user_id: p.user_id,
    rating_before: 1000,
    rating_after: 1000,
    delta: 0,
    applied_at: null as string | null,
  }));
  const state = { event, players, scores, proofs_count: 0, can_review: true };
  await page.route("**/rest/v1/simulation_operators?**", (route) =>
    route.fulfill({ json: enabled ? { enabled: true } : null }),
  );
  await page.route("**/rest/v1/events?**", async (route) => {
    if (new URL(route.request().url()).searchParams.has("simulation_owner_id"))
      await route.fulfill({
        json: [
          {
            id: eventId,
            status: event.status,
            created_at: "2026-10-19T16:00:00Z",
          },
        ],
      });
    else await route.fallback();
  });
  function report(team: "a" | "b", body: Record<string, unknown>) {
    event[`result_team_${team}_winner`] = String(
      body.p_winner || body.winner_team,
    );
    event[`result_team_${team}_score`] = String(
      body.p_score || body.result_score,
    );
    event[`result_team_${team}_submitted_at`] = new Date().toISOString();
    event.status = "CLOSED";
    event.result_status = "PENDING";
    if (event.result_team_a_score && event.result_team_b_score) {
      if (
        event.result_team_a_score === event.result_team_b_score &&
        event.result_team_a_winner === event.result_team_b_winner
      ) {
        event.result_status = "CONFIRMED";
        event.status = "FINISHED";
        event.winner_team = event.result_team_a_winner;
        event.result_score = event.result_team_a_score;
        scores.forEach((s, i) => {
          s.delta = (event.winner_team === "A" ? 16 : -16) * (i < 2 ? 1 : -1);
          s.rating_after = 1000 + s.delta;
          s.applied_at = new Date().toISOString();
        });
      } else event.result_status = "DISPUTED";
    }
  }
  await page.route("**/rest/v1/rpc/**", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()!;
    const body = route.request().postDataJSON();
    if (
      ![
        "get_simulation_state",
        "create_simulation",
        "simulate_all_presence",
        "simulate_player_action",
        "expire_simulation_result",
        "submit_team_result",
        "review_match_dispute",
      ].includes(name)
    ) {
      await route.fallback();
      return;
    }
    calls.push({ name, body });
    if (name === "get_simulation_state") {
      await route.fulfill({ json: state });
      return;
    }
    if (name === "create_simulation") {
      await route.fulfill({ json: eventId });
      return;
    }
    if (name === "simulate_all_presence") {
      players.forEach((p) => (p.attendance_status = "CHECKED_IN"));
      state.proofs_count = 4;
    }
    if (name === "submit_team_result") report("a", body);
    if (name === "expire_simulation_result") event.result_status = "DISPUTED";
    if (name === "review_match_dispute") {
      event.status = "CANCELLED";
      event.result_resolution_reason = String(body.p_reason);
    }
    if (name === "simulate_player_action") {
      expect(body).not.toHaveProperty("user_id");
      expect(body).not.toHaveProperty("p_user_id");
      const player = players.find((p) => p.slot === body.p_slot)!;
      if (body.p_action === "GENERATE_TOKEN") {
        player.token = "EFGH34";
        player.expires_at = new Date(Date.now() + 120000).toISOString();
        player.next_refresh_at = new Date(Date.now() + 30000).toISOString();
        await route.fulfill({ json: { token: player.token } });
        return;
      }
      if (body.p_action === "SCAN_TOKEN") {
        await route.fulfill({ json: { status: "TOKEN_SAME_TEAM" } });
        return;
      }
      if (body.p_action === "LEAVE") {
        player.present = false;
        players.forEach((p) => (p.attendance_status = "PENDING"));
        state.proofs_count = 0;
      }
      if (body.p_action === "JOIN") player.present = true;
      if (body.p_action === "REPORT") report("b", body);
      if (body.p_action === "LEAVE" || body.p_action === "JOIN") {
        await route.fulfill({
          json: { status: body.p_action === "LEAVE" ? "LEFT" : "JOINED" },
        });
        return;
      }
    }
    await route.fulfill({ json: null });
  });
  return { calls, state };
}
test("unprovisioned account has no simulator controls", async ({ page }) => {
  await simulatorBackend(page, false);
  await page.goto("simulator/");
  await expect(page.locator("main")).toContainText("no está habilitado");
  await expect(
    page.getByRole("button", { name: "Crear mesa de prueba" }),
  ).toHaveCount(0);
});
test("creation uses chosen rules and keeps all bot logins out of the browser", async ({
  page,
}) => {
  const { calls } = await simulatorBackend(page);
  await page.goto("simulator/");
  await page
    .getByRole("combobox", { name: "Modalidad", exact: true })
    .selectOption("FOUR_KINGS");
  await page
    .getByRole("combobox", { name: "Tantos", exact: true })
    .selectOption("30");
  await page.getByRole("button", { name: "Crear mesa de prueba" }).click();
  await expect(page).toHaveURL(new RegExp(`simulator/\\?id=${eventId}`));
  expect(calls.find((c) => c.name === "create_simulation")?.body).toEqual({
    p_variant: "FOUR_KINGS",
    p_points: 30,
    p_games: 3,
    p_vacas: 1,
  });
  await expect(page.locator("main")).toContainText("ELO real no cambia");
});
for (const win of [true, false])
  test(`quick ${win ? "win" : "loss"} uses real report then scoped rival action`, async ({
    page,
  }) => {
    const { calls } = await simulatorBackend(page);
    await page.goto(`simulator/?id=${eventId}`);
    await expect(
      page.getByRole("button", { name: "Simular mi victoria" }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Simular presencia de los cuatro" })
      .click();
    await expect(page.locator("main")).toContainText("Presencia: 4/4");
    await page
      .getByRole("button", {
        name: win ? "Simular mi victoria" : "Simular mi derrota",
      })
      .click();
    await expect(page.locator("main")).toContainText("FINISHED");
    await expect(
      page.getByRole("heading", { name: "Clasificación simulada" }),
    ).toBeVisible();
    await expect(page.locator("main")).toContainText("1000 → 1016");
    const report = calls.find((c) => c.name === "submit_team_result")!;
    expect(report.body).toMatchObject({
      match_id: eventId,
      winner_team: win ? "A" : "B",
      result_score: win ? "3-1" : "1-3",
    });
    expect(
      calls.find(
        (c) =>
          c.name === "simulate_player_action" && c.body.p_action === "REPORT",
      )?.body,
    ).toMatchObject({
      p_event_id: eventId,
      p_slot: 2,
      p_action: "REPORT",
      p_winner: win ? "A" : "B",
    });
  });
test("manual mock QR, errors and roster changes remain usable at 320px", async ({
  page,
}, info) => {
  await simulatorBackend(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`simulator/?id=${eventId}`);
  await page
    .getByText("Probar QR y códigos paso a paso", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generar QR mock 2", exact: true })
    .click();
  const card = page.getByRole("article", { name: "Mock 2", exact: true });
  await expect(card.locator("img")).toHaveJSProperty("naturalWidth", 256);
  await card.getByLabel("Código que valida mock 2").fill("ABCD12");
  await card.getByRole("button", { name: "Validar como mock 2" }).click();
  await expect(page.getByRole("status")).toContainText("no de su compañero");
  await page.getByRole("button", { name: "Sacar mock 3" }).click();
  await expect(
    page.getByRole("button", { name: "Simular presencia de los cuatro" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Reincorporar mock 3" }).click();
  await expect(
    page.getByRole("button", { name: "Simular presencia de los cuatro" }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBeLessThanOrEqual(1);
  await expect(page.locator("main")).not.toContainText(
    "Cannot read properties",
  );
  await page.screenshot({
    path: info.outputPath("simulator-mobile.png"),
    fullPage: true,
  });
});
test("disagreement and pending timeout expose the normal reviewed neutral resolution", async ({
  page,
}) => {
  const { calls } = await simulatorBackend(page);
  page.on("dialog", (d) => d.accept());
  await page.goto(`simulator/?id=${eventId}`);
  await page
    .getByRole("button", { name: "Simular presencia de los cuatro" })
    .click();
  await page
    .getByRole("button", { name: "Dejar reporte rival pendiente" })
    .click();
  await expect(
    page.getByRole("button", { name: "Simular vencimiento del plazo" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Simular vencimiento del plazo" })
    .click();
  await expect(
    page.getByRole("heading", { name: "3. Revisar disputa" }),
  ).toBeVisible();
  await page
    .getByLabel("Motivo de resolución (visible a participantes)")
    .fill("Prueba de anulación neutral del simulador");
  await page.getByRole("button", { name: "Registrar resolución" }).click();
  await expect(page.locator("main")).toContainText("CANCELLED");
  expect(
    calls.find((c) => c.name === "review_match_dispute")?.body,
  ).toMatchObject({
    p_event_id: eventId,
    p_decision: "VOID",
    p_apply_elo: false,
  });
});
test("contradictory reports are scoped to opposite teams", async ({ page }) => {
  const { calls } = await simulatorBackend(page);
  await page.goto(`simulator/?id=${eventId}`);
  await page
    .getByRole("button", { name: "Simular presencia de los cuatro" })
    .click();
  await page.getByRole("button", { name: "Provocar disputa" }).click();
  await expect(
    page.getByRole("heading", { name: "3. Revisar disputa" }),
  ).toBeVisible();
  expect(
    calls.find((c) => c.name === "submit_team_result")?.body,
  ).toMatchObject({ winner_team: "A", result_score: "3-1" });
  expect(
    calls.find(
      (c) =>
        c.name === "simulate_player_action" && c.body.p_action === "REPORT",
    )?.body,
  ).toMatchObject({ p_slot: 2, p_winner: "B", p_score: "1-3" });
});
for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
])
  test(`simulator fits ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await simulatorBackend(page);
    await page.setViewportSize(viewport);
    await page.goto(`simulator/?id=${eventId}`);
    await expect(
      page.getByRole("heading", { name: "Mesa de simulación", exact: true }),
    ).toBeVisible();
    await page
      .getByText("Probar QR y códigos paso a paso", { exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      )
      .toBeLessThanOrEqual(1);
  });
