"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { eventPath } from "@/lib/paths";
type Player = {
  user_id: string;
  username: string | null;
  team: "A" | "B" | null;
  checked_in: boolean;
  is_mock: boolean;
};
type Match = {
  event_id: string;
  title: string;
  starts_at: string;
  match_type: string;
  status: string;
  result_status: string | null;
  rules_variant: string;
  points_per_game: number;
  games_to_win: number;
  vacas_to_win: number;
  report_a: boolean;
  report_b: boolean;
  winner_team: string | null;
  result_score: string | null;
  elo_applied: boolean;
  players: Player[];
};
type Issue = {
  id: string;
  reporter_id: string;
  event_id: string | null;
  category: string;
  severity: string;
  title: string;
  steps: string;
  expected: string;
  actual: string;
  environment: Record<string, string>;
  status: string;
  review_note: string | null;
  revision: number;
  created_at: string;
};
const categories = [
  ["ACCESS", "Acceso o cuenta"],
  ["PRESENCE", "Presencia y QR"],
  ["RESULTS", "Resultados o ranking"],
  ["PUSH", "Avisos o notificaciones"],
  ["LOCATION", "Ubicación"],
  ["OTHER", "Otro problema"],
];
const statuses: Record<string, string> = {
  OPEN: "Abierta",
  IN_PROGRESS: "En revisión",
  RESOLVED: "Resuelta",
  DISMISSED: "Descartada",
};
function environment() {
  const ua = navigator.userAgent;
  return {
    platform: /Android/i.test(ua)
      ? "ANDROID"
      : /iPhone|iPad|iPod/i.test(ua) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
        ? "IOS"
        : /Windows|Mac|Linux/i.test(ua)
          ? "DESKTOP"
          : "OTHER",
    browser: /Edg/i.test(ua)
      ? "EDGE"
      : /Firefox/i.test(ua)
        ? "FIREFOX"
        : /Chrome|CriOS/i.test(ua)
          ? "CHROME"
          : /Safari/i.test(ua)
            ? "SAFARI"
            : "OTHER",
    display:
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone
        ? "APP"
        : "BROWSER",
  };
}
export default function Pilot() {
  const [uid, setUid] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [admin, setAdmin] = useState(false),
    [matches, setMatches] = useState<Match[]>([]),
    [candidates, setCandidates] = useState<{ id: string; title: string }[]>([]),
    [issues, setIssues] = useState<Issue[]>([]),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [ticketEvent, setTicketEvent] = useState("");
  const lock = useRef(false),
    alive = useRef(true),
    account = useRef<string | null>(null),
    revision = useRef(0);
  const load = useCallback(async (id: string) => {
    const rev = ++revision.current;
    const [profile, enrolled, own, tickets] = await Promise.all([
      supabase.from("profiles").select("is_admin").eq("id", id).single(),
      supabase
        .from("pilot_matches")
        .select("event_id,enrolled_at")
        .order("enrolled_at", { ascending: false })
        .limit(20),
      supabase
        .from("events")
        .select("id,title")
        .eq("created_by", id)
        .is("simulation_owner_id", null)
        .neq("status", "CANCELLED")
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("pilot_issues")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (!alive.current || account.current !== id || rev !== revision.current)
      return;
    if (profile.error || enrolled.error || own.error || tickets.error)
      throw new Error(
        "No se pudo cargar el piloto. Pulsa Actualizar para reintentar.",
      );
    const states = await Promise.all(
      (enrolled.data || []).map((m) =>
        supabase.rpc("get_pilot_match_state", { p_event_id: m.event_id }),
      ),
    );
    if (!alive.current || account.current !== id || rev !== revision.current)
      return;
    if (states.some((s) => s.error))
      throw new Error("No se pudo cargar el seguimiento de las partidas.");
    setAdmin(!!profile.data?.is_admin);
    setMatches(states.flatMap((s) => (s.data ? [s.data as Match] : [])));
    setCandidates(
      (own.data || []).filter(
        (e) => !enrolled.data?.some((m) => m.event_id === e.id),
      ),
    );
    setIssues(tickets.data || []);
  }, []);
  useEffect(() => {
    alive.current = true;
    function update(id: string | null) {
      setReady(true);
      if (account.current === id) return;
      setMessage("");
      setSelected("");
      setTicketEvent("");
      account.current = id;
      ++revision.current;
      setUid(id);
      setReady(true);
      setAdmin(false);
      setMatches([]);
      setCandidates([]);
      setIssues([]);
      if (id)
        void load(id).catch((e) => {
          if (alive.current && account.current === id) setMessage(e.message);
        });
    }
    void supabase.auth.getSession().then(({ data }) => {
      if (alive.current) update(data.session?.user.id || null);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      if (alive.current) update(s?.user.id || null);
    });
    const stop = () => {
      alive.current = false;
      ++revision.current;
    };
    return () => {
      stop();
      data.subscription.unsubscribe();
    };
  }, [load]);
  async function run(action: () => Promise<string | void>) {
    if (lock.current || !uid) return;
    const id = uid;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const text = await action();
      if (alive.current && account.current === id) {
        await load(id);
        setMessage(text || "Cambios guardados.");
      }
    } catch (e) {
      if (alive.current && account.current === id)
        setMessage(
          e instanceof Error ? e.message : "No se pudo completar la operación.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (!ready)
    return (
      <main className="mm-page">
        <p role="status">Cargando piloto…</p>
      </main>
    );
  if (!uid)
    return (
      <main className="mm-page">
        <h1>Piloto de MusMatch</h1>
        <p className="my-4">
          Inicia sesión para seguir tus partidas y comunicar incidencias.
        </p>
        <Link href="/login" className="btn-primary">
          Iniciar sesión
        </Link>
      </main>
    );
  return (
    <main className="mm-page mx-auto max-w-4xl">
      <h1 className="font-bold">Piloto de MusMatch</h1>
      <p className="mt-2 text-white/70">
        Prueba la app durante una quedada real. El seguimiento muestra registros
        de la aplicación; la prueba presencial la hacéis vosotros.
      </p>
      <div className="my-4">
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await load(uid);
              return "Piloto actualizado.";
            })
          }
        >
          Actualizar piloto
        </button>
      </div>
      {message && (
        <p role="status" className="my-4 rounded-xl bg-white/10 p-4">
          {message}
        </p>
      )}
      <section
        className="my-5 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10"
        aria-label="Guía del piloto"
      >
        <h2 className="text-xl font-semibold">Antes de quedar</h2>
        <ol className="mt-3 list-decimal space-y-3 pl-5">
          <li>
            Cada persona entra con su propia cuenta.{" "}
            <Link href="/users" className="underline">
              Añadir amigos y jugadores
            </Link>
            .
          </li>
          <li>
            Elegid fecha, sitio y reglas: 4/4 u 8/8, tantos, juegos y vacas.
            Confirmad permiso y disponibilidad del lugar.
          </li>
          <li>
            Primera partida amistosa para probar invitaciones y resultados sin
            cambiar ELO. Después, competitiva para probar cuatro registros de
            presencia y ranking.
          </li>
          <li>
            Abrid{" "}
            <Link href="/notifications" className="underline">
              Avisos y notificaciones
            </Link>{" "}
            y enviad una prueba en cada móvil. Instalad la PWA si queréis usarla
            como app.
          </li>
        </ol>
        <p className="mt-3 text-sm text-white/60">
          Las disputas deliberadas y los abandonos de prueba se hacen en el
          simulador. En el piloto, publicad el resultado realmente jugado.
        </p>
      </section>
      <section
        className="my-5 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10"
        aria-label="Partidas del piloto"
      >
        <h2 className="text-xl font-semibold">Partidas en seguimiento</h2>
        <p className="mt-2 text-sm text-white/70">
          El organizador puede añadir una partida con reglas acordadas. Se
          excluyen simulaciones y mesas con usuarios mock. El ELO y los avisos
          siguen las reglas habituales.
        </p>
        <Link href="/create" className="btn-primary mt-3">
          Crear una partida real
        </Link>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <label className="grid gap-2">
            Tu partida para el piloto
            <select
              className="mm-input"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Selecciona una partida</option>
              {candidates.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn-secondary self-end"
            disabled={busy || !selected}
            onClick={() =>
              void run(async () => {
                const { error } = await supabase.rpc("enroll_pilot_match", {
                  p_event_id: selected,
                });
                if (error) throw new Error(error.message);
                setSelected("");
                return "Partida incorporada al piloto.";
              })
            }
          >
            Añadir al seguimiento
          </button>
        </div>
        {!matches.length && (
          <p className="mm-empty mt-4">
            Todavía no hay partidas del piloto disponibles para tu cuenta.
          </p>
        )}
        <div className="mt-4 grid gap-4">
          {matches.map((m) => {
            const complete =
                m.players.length === 4 &&
                m.players.filter((p) => p.team === "A").length === 2 &&
                m.players.filter((p) => p.team === "B").length === 2 &&
                !m.players.some((p) => p.is_mock),
              checked = m.players.filter((p) => p.checked_in).length;
            return (
              <article
                key={m.event_id}
                className="rounded-xl border border-white/20 p-4"
              >
                <h3 className="text-lg font-semibold">{m.title}</h3>
                <p className="mt-1 text-sm text-white/70">
                  {new Date(m.starts_at).toLocaleString("es-ES")} ·{" "}
                  {m.match_type === "COMPETITIVE" ? "Competitiva" : "Amistosa"}{" "}
                  ·{" "}
                  {m.rules_variant === "EIGHT_KINGS"
                    ? "8 reyes y 8 ases"
                    : "4 reyes y 4 ases"}{" "}
                  · {m.points_per_game} tantos · {m.games_to_win} juegos /{" "}
                  {m.vacas_to_win} vacas
                </p>
                <ul className="my-3 space-y-2 text-sm">
                  <li>
                    {complete
                      ? "✓ Equipos completos: dos contra dos."
                      : `Pendiente: completar equipos (${m.players.length}/4).`}
                  </li>
                  <li>
                    {m.match_type === "COMPETITIVE"
                      ? `Presencia registrada: ${checked}/4.`
                      : "La amistosa no exige verificación de presencia."}
                  </li>
                  <li>
                    Reportes: equipo A {m.report_a ? "publicado" : "pendiente"}{" "}
                    · equipo B {m.report_b ? "publicado" : "pendiente"}.
                  </li>
                  <li>
                    {m.status === "CANCELLED"
                      ? "Partida cancelada."
                      : m.result_status === "CONFIRMED"
                        ? `Resultado confirmado: ${m.result_score || "consultar detalle"} · ganador ${m.winner_team}.`
                        : m.result_status === "DISPUTED"
                          ? "Disputa abierta: requiere revisión."
                          : m.result_status === "PENDING"
                            ? "Resultado pendiente del otro equipo."
                            : "Partida sin resultado confirmado."}
                  </li>
                  <li>
                    {m.match_type === "FRIENDLY"
                      ? "Sin cambios de ELO."
                      : m.elo_applied
                        ? "ELO aplicado. Comprueba el ranking."
                        : "ELO todavía no aplicado."}
                  </li>
                </ul>
                <ul className="mb-3 grid gap-1 text-sm text-white/70">
                  {m.players.map((p) => (
                    <li key={p.user_id}>
                      Equipo {p.team || "por asignar"} · @
                      {p.username || "Jugador"} ·{" "}
                      {p.checked_in ? "registro validado" : "sin registro"}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={eventPath(m.event_id)}
                    className="btn-secondary w-auto"
                  >
                    Abrir partida
                  </Link>
                  <Link href="/rankings" className="btn-secondary w-auto">
                    Ver ranking
                  </Link>
                  <button
                    className="btn-secondary w-auto"
                    onClick={() => {
                      setTicketEvent(m.event_id);
                      document
                        .getElementById("reportar-incidencia")
                        ?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    Comunicar un problema
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <section
        id="reportar-incidencia"
        className="my-5 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10"
        aria-label="Comunicar una incidencia"
      >
        <h2 className="text-xl font-semibold">¿Algo no ha funcionado?</h2>
        <p className="mt-2 text-sm text-white/70">
          Describe lo ocurrido. No incluyas contraseñas, códigos de presencia,
          direcciones privadas ni datos de otras personas. Se guardará tu
          reporte y el tipo de dispositivo/navegador indicado, sin capturas ni
          logs automáticos. Solo tú y administración podréis verlo.
        </p>
        <form
          key={uid}
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (lock.current) return;
            const form = event.currentTarget;
            const data = new FormData(form);
            void run(async () => {
              const { data: id, error } = await supabase.rpc(
                "report_pilot_issue",
                {
                  p_event_id: ticketEvent || null,
                  p_category: data.get("category"),
                  p_severity: data.get("severity"),
                  p_title: data.get("title"),
                  p_steps: data.get("steps"),
                  p_expected: data.get("expected"),
                  p_actual: data.get("actual"),
                  p_environment: environment(),
                },
              );
              if (error) throw new Error(error.message);
              if (account.current === uid) {
                form.reset();
                setTicketEvent("");
              }
              return `Incidencia enviada. Referencia: ${String(id).slice(0, 8)}.`;
            });
          }}
        >
          <label className="grid gap-1">
            Partida relacionada
            <select
              className="mm-input"
              value={ticketEvent}
              onChange={(e) => setTicketEvent(e.target.value)}
            >
              <option value="">Sin asociar a una partida</option>
              {matches.map((m) => (
                <option key={m.event_id} value={m.event_id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              Apartado
              <select name="category" className="mm-input">
                {categories.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              Impacto
              <select name="severity" className="mm-input">
                <option value="NORMAL">Puedo continuar</option>
                <option value="BLOCKER">No puedo continuar</option>
                <option value="SUGGESTION">Propuesta de mejora</option>
              </select>
            </label>
          </div>
          <label className="grid gap-1">
            Título
            <input
              name="title"
              className="mm-input"
              required
              minLength={5}
              maxLength={120}
            />
          </label>
          <label className="grid gap-1">
            Pasos para repetirlo
            <textarea
              name="steps"
              className="mm-input"
              required
              minLength={10}
              maxLength={1500}
              rows={3}
            />
          </label>
          <label className="grid gap-1">
            Qué esperabas
            <textarea
              name="expected"
              className="mm-input"
              required
              minLength={5}
              maxLength={1000}
              rows={2}
            />
          </label>
          <label className="grid gap-1">
            Qué ha ocurrido
            <textarea
              name="actual"
              className="mm-input"
              required
              minLength={5}
              maxLength={1000}
              rows={2}
            />
          </label>
          <button className="btn-primary" disabled={busy}>
            Enviar incidencia
          </button>
        </form>
      </section>
      <section
        className="my-5"
        aria-label={admin ? "Revisión de incidencias" : "Mis incidencias"}
      >
        <h2 className="text-xl font-semibold">
          {admin ? "Revisión de incidencias" : "Mis incidencias"}
        </h2>
        <p className="mt-2 text-sm text-white/60">
          Hasta 100 reportes recientes.{" "}
          {admin
            ? "Las notas de revisión son visibles para quien comunicó el problema."
            : "Aquí verás el estado y la nota de administración."}
        </p>
        {!issues.length && (
          <p className="mm-empty mt-4">No hay incidencias disponibles.</p>
        )}
        <ul className="mt-4 space-y-3">
          {issues.map((i) => (
            <li
              key={`${i.id}-${i.revision}`}
              className="rounded-xl border border-white/20 p-4"
            >
              <h3 className="font-semibold">{i.title}</h3>
              <p className="mt-1 text-sm text-mm-gold">
                {statuses[i.status]} ·{" "}
                {i.severity === "BLOCKER"
                  ? "Impide continuar"
                  : i.severity === "SUGGESTION"
                    ? "Mejora"
                    : "Normal"}{" "}
                · #{i.id.slice(0, 8)}
              </p>
              <details className="mt-2">
                <summary className="min-h-11 py-2">Ver reporte</summary>
                <dl className="grid gap-2 text-sm">
                  <dt className="font-semibold">Pasos</dt>
                  <dd className="whitespace-pre-wrap">{i.steps}</dd>
                  <dt className="font-semibold">Esperaba</dt>
                  <dd className="whitespace-pre-wrap">{i.expected}</dd>
                  <dt className="font-semibold">Ha ocurrido</dt>
                  <dd className="whitespace-pre-wrap">{i.actual}</dd>
                  <dt className="font-semibold">Dispositivo indicado</dt>
                  <dd>
                    {Object.values(i.environment).join(" · ") || "No indicado"}
                  </dd>
                </dl>
                {i.event_id && (
                  <Link
                    href={eventPath(i.event_id)}
                    className="btn-secondary mt-3"
                  >
                    Ver partida relacionada
                  </Link>
                )}
              </details>
              {i.review_note && (
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-white/5 p-3 text-sm">
                  Revisión: {i.review_note}
                </p>
              )}
              {admin && (
                <form
                  className="mt-3 grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void run(async () => {
                      const { error } = await supabase.rpc(
                        "review_pilot_issue",
                        {
                          p_issue_id: i.id,
                          p_status: data.get("status"),
                          p_note: data.get("note"),
                          p_revision: i.revision,
                        },
                      );
                      if (error) throw new Error(error.message);
                      return "Revisión guardada.";
                    });
                  }}
                >
                  <label className="grid gap-1">
                    Estado de la incidencia
                    <select
                      name="status"
                      className="mm-input"
                      defaultValue={i.status}
                    >
                      {Object.entries(statuses).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    Nota de revisión
                    <textarea
                      name="note"
                      required
                      minLength={10}
                      maxLength={1000}
                      className="mm-input"
                      defaultValue={i.review_note || ""}
                    />
                  </label>
                  <button className="btn-secondary" disabled={busy}>
                    Guardar revisión
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
