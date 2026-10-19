"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { eventPath } from "@/lib/paths";
import {
  scoreTarget,
  type MatchRules,
  type RulesVariant,
} from "@/lib/matchRules";
import MatchRulesCard from "./MatchRulesCard";
import PresenceCheckIn from "./PresenceCheckIn";
import PresenceQr from "./PresenceQr";
import DisputeReview from "./DisputeReview";
type Trial = MatchRules & {
  id: string;
  title: string;
  match_type: string;
  simulation_owner_id: string;
  status: string;
  result_status: string | null;
  winner_team: string | null;
  result_score: string | null;
  result_team_a_winner: string | null;
  result_team_b_winner: string | null;
  result_team_a_score: string | null;
  result_team_b_score: string | null;
  result_team_a_submitted_at: string | null;
  result_team_b_submitted_at: string | null;
  result_resolution_reason: string | null;
};
type Player = {
  user_id: string;
  username: string;
  slot: number | null;
  team: "A" | "B";
  present: boolean;
  attendance_status: string | null;
  token: string | null;
  expires_at: string | null;
  next_refresh_at: string | null;
};
type State = {
  event: Trial;
  players: Player[];
  scores: {
    user_id: string;
    rating_before: number;
    rating_after: number;
    delta: number;
    applied_at: string | null;
  }[];
  proofs_count: number;
  can_review: boolean;
};
const statuses: Record<string, string> = {
  PROOF_ACCEPTED: "Código validado.",
  TOKEN_OWN_USER: "El mock no puede validar su propio código.",
  TOKEN_SAME_TEAM: "Debe validar el código de un rival, no de su compañero.",
  TOKEN_ALREADY_USED: "Ese código ya se ha utilizado.",
  TOKEN_EXPIRED: "Ese código ha caducado.",
  TOKEN_NOT_FOUND: "Código no encontrado en esta partida.",
  TOKEN_OWNER_NOT_ACTIVE: "El jugador del código ya no está en la mesa.",
  LEFT: "El mock ha salido. Las pruebas de presencia se invalidan.",
  JOINED: "El mock vuelve a ocupar su plaza.",
  PENDING: "Reporte guardado. Falta el otro equipo.",
  PENDING_OTHER_TEAM: "Reporte guardado. Falta el otro equipo.",
  CONFIRMED: "Los equipos coinciden: resultado confirmado.",
  DISPUTED: "Los reportes no coinciden: disputa abierta.",
};
function BotCard({
  player,
  eventId,
  busy,
  active,
  onAction,
  now,
}: {
  player: Player;
  eventId: string;
  busy: boolean;
  active: boolean;
  now: number;
  onAction: (slot: number, action: string, token?: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const validToken =
    !!player.token &&
    !!player.expires_at &&
    new Date(player.expires_at).getTime() > now;
  const wait = player.next_refresh_at
    ? Math.max(
        0,
        Math.ceil((new Date(player.next_refresh_at).getTime() - now) / 1000),
      )
    : 0;
  return (
    <article
      className="rounded-2xl bg-white/5 p-4 space-y-3 ring-1 ring-white/10"
      aria-label={`Mock ${player.slot}`}
    >
      <h3 className="font-semibold break-words">
        Mock {player.slot} · @{player.username}
      </h3>
      <p className="text-sm text-white/70">
        Equipo {player.team} ·{" "}
        {!player.present
          ? "Fuera de la mesa"
          : player.attendance_status === "CHECKED_IN"
            ? "Presencia validada"
            : "Presencia pendiente"}
      </p>
      {validToken && (
        <>
          <PresenceQr eventId={eventId} token={player.token!} />
          <p className="font-mono text-xl tracking-widest">{player.token}</p>
          <p className="text-xs text-white/60">
            Caduca en{" "}
            {Math.max(
              0,
              Math.ceil((new Date(player.expires_at!).getTime() - now) / 1000),
            )}{" "}
            s
          </p>
        </>
      )}
      <button
        className="btn-secondary"
        disabled={busy || !active || !player.present || wait > 0}
        onClick={() => void onAction(player.slot!, "GENERATE_TOKEN")}
      >
        {wait > 0 ? `Renovar en ${wait} s` : `Generar QR mock ${player.slot}`}
      </button>
      <label className="block text-sm">
        Código que valida mock {player.slot}
        <input
          className="mm-input mt-1 w-full font-mono uppercase"
          autoComplete="off"
          maxLength={6}
          value={code}
          onChange={(e) =>
            setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
          }
        />
      </label>
      <button
        className="btn-secondary"
        disabled={busy || !active || !player.present || code.length !== 6}
        onClick={() => void onAction(player.slot!, "SCAN_TOKEN", code)}
      >
        Validar como mock {player.slot}
      </button>
      <button
        className="btn-secondary"
        disabled={busy || !active}
        onClick={() =>
          void onAction(player.slot!, player.present ? "LEAVE" : "JOIN")
        }
      >
        {player.present
          ? `Sacar mock ${player.slot}`
          : `Reincorporar mock ${player.slot}`}
      </button>
    </article>
  );
}
export default function Simulator() {
  const router = useRouter();
  const id = useSearchParams().get("id") || "";
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [recent, setRecent] = useState<
    { id: string; created_at: string; status: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const revision = useRef(0);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [variant, setVariant] = useState<RulesVariant>("EIGHT_KINGS");
  const [points, setPoints] = useState(40);
  const [games, setGames] = useState(3);
  const [vacas, setVacas] = useState(1);
  const [reportTeam, setReportTeam] = useState<"A" | "B">("A");
  const [winner, setWinner] = useState<"A" | "B">("A");
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const load = useCallback(async () => {
    const version = ++revision.current;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    const { data: operator, error: operatorError } = await supabase
      .from("simulation_operators")
      .select("enabled")
      .eq("user_id", user.id)
      .maybeSingle();
    if (version !== revision.current) return;
    if (operatorError) {
      setMessage(
        "No se pudo comprobar el acceso al simulador. Actualiza la página.",
      );
      setFailed(true);
      return;
    }
    setEnabled(!!operator?.enabled);
    if (!operator?.enabled) return;
    const { data: trials } = await supabase
      .from("events")
      .select("id,created_at,status")
      .eq("simulation_owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (version !== revision.current) return;
    setRecent(trials || []);
    if (id) {
      const { data, error } = await supabase.rpc("get_simulation_state", {
        p_event_id: id,
      });
      if (version !== revision.current) return;
      if (error) {
        setState(null);
        setFailed(true);
        setMessage(error.message);
      } else {
        setState(data as State);
        setFailed(false);
      }
    }
  }, [id, router]);
  const invalidate = useCallback(() => {
    revision.current += 1;
  }, []);
  useEffect(() => {
    void load();
    const tick = setInterval(() => {
      if (document.visibilityState === "visible" && !lock.current) void load();
    }, 10000);
    return () => {
      clearInterval(tick);
      invalidate();
    };
  }, [load, invalidate]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  }
  async function run(work: () => Promise<string | void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const text = await work();
      setMessage(text || "Operación completada.");
    } catch (e) {
      setFailed(true);
      setMessage(
        e instanceof Error
          ? e.message
          : "No se pudo conectar. Vuelve a intentarlo.",
      );
    } finally {
      await load().catch(() => {
        setFailed(true);
        setMessage("No se pudo actualizar la mesa. Pulsa Actualizar mesa.");
      });
      lock.current = false;
      setBusy(false);
    }
  }
  async function create() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const eid = await rpc("create_simulation", {
        p_variant: variant,
        p_points: points,
        p_games: games,
        p_vacas: vacas,
      });
      setState(null);
      setScoreA("");
      setScoreB("");
      router.push(`/simulator/?id=${encodeURIComponent(eid)}`);
    } catch (e) {
      setFailed(true);
      setMessage(e instanceof Error ? e.message : "No se pudo crear la mesa.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const current = state?.event.id === id ? state : null;
  const active =
    !!current &&
    ["OPEN", "FULL"].includes(current.event.status) &&
    !current.event.result_status;
  const checked =
    current?.players.filter(
      (p) => p.present && p.attendance_status === "CHECKED_IN",
    ).length || 0;
  const full = current?.players.filter((p) => p.present).length === 4;
  const target = current ? scoreTarget(current.event) : null;
  const scoreValid =
    !!target &&
    ((winner === "A" &&
      Number(scoreA) === target &&
      scoreB !== "" &&
      Number(scoreB) >= 0 &&
      Number(scoreB) < target) ||
      (winner === "B" &&
        Number(scoreB) === target &&
        scoreA !== "" &&
        Number(scoreA) >= 0 &&
        Number(scoreA) < target));
  const onAction = async (slot: number, action: string, token?: string) =>
    run(async () => {
      const r = await rpc("simulate_player_action", {
        p_event_id: id,
        p_slot: slot,
        p_action: action,
        p_token: token || null,
      });
      return action === "GENERATE_TOKEN"
        ? "QR de prueba generado. Muéstralo en otro dispositivo o introduce su código desde tu cuenta."
        : statuses[r?.status] || r?.status || "Operación completada.";
    });
  async function report(team: "A" | "B", win: "A" | "B", score: string) {
    return team === "A"
      ? rpc("submit_team_result", {
          match_id: id,
          winner_team: win,
          result_score: score,
        })
      : rpc("simulate_player_action", {
          p_event_id: id,
          p_slot: 2,
          p_action: "REPORT",
          p_winner: win,
          p_score: score,
        });
  }
  async function scenario(kind: "WIN" | "LOSS" | "DISPUTE" | "PENDING") {
    await run(async () => {
      const t = target!;
      const win = kind === "LOSS" ? "B" : "A";
      await report(
        "A",
        win,
        win === "A" ? `${t}-${t > 1 ? 1 : 0}` : `${t > 1 ? 1 : 0}-${t}`,
      );
      if (kind !== "PENDING")
        await report(
          "B",
          kind === "DISPUTE" ? "B" : win,
          kind === "DISPUTE"
            ? `${t > 1 ? 1 : 0}-${t}`
            : win === "A"
              ? `${t}-${t > 1 ? 1 : 0}`
              : `${t > 1 ? 1 : 0}-${t}`,
        );
      return kind === "DISPUTE"
        ? "Disputa abierta: revisa los dos reportes abajo."
        : kind === "PENDING"
          ? "Falta el reporte rival. Puedes simular el vencimiento."
          : "Resultado confirmado. Consulta la clasificación simulada.";
    });
  }
  if (enabled === null && !message)
    return (
      <main className="mm-page max-w-5xl">
        <p>Cargando simulador…</p>
      </main>
    );
  return (
    <main className="mm-page max-w-5xl">
      <h1 className="text-3xl font-bold">Simulador de partidas</h1>
      <p className="mt-3 text-white/70">
        Tu cuenta y tres mocks, sin iniciar sesión con otros usuarios. Las mesas
        son privadas y el ELO real no cambia.
      </p>
      {message && (
        <p
          className={`my-4 rounded-xl p-3 ${failed ? "bg-red-500/10 text-red-200" : "bg-white/10"}`}
          role={failed ? "alert" : "status"}
        >
          {message}
        </p>
      )}
      {enabled === false ? (
        <p className="mt-6">
          El simulador no está habilitado para esta cuenta.
        </p>
      ) : (
        enabled && (
          <>
            <section className="mt-5 rounded-2xl bg-white/5 p-4 space-y-3">
              <h2 className="text-xl font-semibold">Nueva mesa de prueba</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label>
                  Modalidad
                  <select
                    className="mm-input mt-1 w-full"
                    value={variant}
                    onChange={(e) => setVariant(e.target.value as RulesVariant)}
                  >
                    <option value="EIGHT_KINGS">8 reyes / 8 ases</option>
                    <option value="FOUR_KINGS">4 reyes / 4 ases</option>
                  </select>
                </label>
                <label>
                  Tantos
                  <select
                    className="mm-input mt-1 w-full"
                    value={points}
                    onChange={(e) => setPoints(Number(e.target.value))}
                  >
                    <option value={30}>30</option>
                    <option value={40}>40</option>
                  </select>
                </label>
                <label>
                  Juegos por vaca
                  <select
                    className="mm-input mt-1 w-full"
                    value={games}
                    onChange={(e) => setGames(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Vacas
                  <select
                    className="mm-input mt-1 w-full"
                    value={vacas}
                    onChange={(e) => setVacas(Number(e.target.value))}
                  >
                    {[1, 2, 3].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => void create()}
              >
                Crear mesa de prueba
              </button>
              <p className="text-xs text-white/60">
                Cada prueba conserva sus resultados y evidencias. Para empezar
                de cero crea otra mesa.
              </p>
              {recent.length > 0 && (
                <label className="block">
                  Pruebas anteriores
                  <select
                    className="mm-input mt-1 w-full"
                    value={recent.some((r) => r.id === id) ? id : ""}
                    onChange={(e) => {
                      if (e.target.value)
                        router.push(
                          `/simulator/?id=${encodeURIComponent(e.target.value)}`,
                        );
                    }}
                  >
                    <option value="">Seleccionar prueba</option>
                    {recent.map((r, i) => (
                      <option key={r.id} value={r.id}>
                        Prueba {recent.length - i} ·{" "}
                        {new Date(r.created_at).toLocaleString()} · {r.status}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </section>
            {id && !current && !failed && (
              <p className="mt-5">Cargando mesa de prueba…</p>
            )}
            {current && (
              <>
                <section className="mt-5 rounded-2xl bg-amber-500/10 p-4">
                  <div className="flex flex-wrap gap-3 justify-between">
                    <h2 className="text-xl font-semibold">
                      Mesa de simulación
                    </h2>
                    <button
                      className="btn-secondary max-w-xs"
                      disabled={busy}
                      onClick={() => void load()}
                    >
                      Actualizar mesa
                    </button>
                  </div>
                  <p className="mt-2">
                    Presencia: {checked}/4 · Pruebas: {current.proofs_count} ·
                    Estado: {current.event.status}
                  </p>
                  <Link
                    className="inline-block mt-2 underline"
                    href={eventPath(id)}
                  >
                    Abrir detalle normal de la partida
                  </Link>
                  <MatchRulesCard rules={current.event} />
                </section>
                <section className="mt-5 space-y-3">
                  <h2 className="text-xl font-semibold">1. Presencia</h2>
                  <p className="text-sm text-white/70">
                    Puedes simular el intercambio completo o generar el QR de un
                    rival y escanearlo desde tu cuenta en otro dispositivo. Haz
                    que un mock rival valide también tu código. El código manual
                    sirve para hacer todo desde un único móvil.
                  </p>
                  <button
                    className="btn-primary"
                    disabled={
                      busy || !active || !full || current.proofs_count !== 0
                    }
                    onClick={() =>
                      void run(async () => {
                        await rpc("simulate_all_presence", { p_event_id: id });
                        return "Los cuatro jugadores tienen presencia validada.";
                      })
                    }
                  >
                    Simular presencia de los cuatro
                  </button>
                  {active && (
                    <details>
                      <summary className="cursor-pointer font-semibold">
                        Probar QR y códigos paso a paso
                      </summary>
                      <div className="mt-4 space-y-4">
                        <h3 className="font-semibold">
                          Tu presencia (equipo A)
                        </h3>
                        {checked < 4 && (
                          <PresenceCheckIn
                            key={id}
                            eventId={id}
                            enabled={full && !busy}
                            onValidated={load}
                          />
                        )}
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                          {current.players
                            .filter((p) => p.slot !== null)
                            .map((p) => (
                              <BotCard
                                key={`${id}:${p.slot}`}
                                player={p}
                                eventId={id}
                                busy={busy}
                                active={active}
                                onAction={onAction}
                                now={now}
                              />
                            ))}
                        </div>
                      </div>
                    </details>
                  )}
                </section>
                <section className="mt-6 space-y-3">
                  <h2 className="text-xl font-semibold">2. Resultados</h2>
                  <p className="text-sm text-white/70">
                    Tu usuario juega en A. Los atajos envían los reportes de
                    ambos equipos por las mismas validaciones que una partida
                    real.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        ["WIN", "Simular mi victoria"],
                        ["LOSS", "Simular mi derrota"],
                        ["DISPUTE", "Provocar disputa"],
                        ["PENDING", "Dejar reporte rival pendiente"],
                      ] as const
                    ).map(([kind, label]) => (
                      <button
                        key={kind}
                        className="btn-secondary"
                        disabled={busy || !active || checked !== 4}
                        onClick={() => void scenario(kind)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    className="btn-secondary"
                    disabled={busy || current.event.result_status !== "PENDING"}
                    onClick={() =>
                      void run(async () => {
                        await rpc("expire_simulation_result", {
                          p_event_id: id,
                        });
                        return "Plazo de respuesta vencido en esta prueba: disputa neutral.";
                      })
                    }
                  >
                    Simular vencimiento del plazo
                  </button>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(["A", "B"] as const).map((t) => (
                      <div key={t} className="rounded-xl bg-white/5 p-3">
                        <h3 className="font-semibold">Reporte {t}</h3>
                        <p>
                          {current.event[
                            t === "A"
                              ? "result_team_a_score"
                              : "result_team_b_score"
                          ] || "Sin reporte"}{" "}
                          · ganador{" "}
                          {current.event[
                            t === "A"
                              ? "result_team_a_winner"
                              : "result_team_b_winner"
                          ] || "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                  <details>
                    <summary className="cursor-pointer">
                      Enviar un marcador concreto
                    </summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label>
                        Equipo que reporta
                        <select
                          className="mm-input w-full"
                          value={reportTeam}
                          onChange={(e) =>
                            setReportTeam(e.target.value as "A" | "B")
                          }
                        >
                          <option value="A">A · tu usuario</option>
                          <option value="B">B · mock 2</option>
                        </select>
                      </label>
                      <label>
                        Ganador
                        <select
                          className="mm-input w-full"
                          value={winner}
                          onChange={(e) =>
                            setWinner(e.target.value as "A" | "B")
                          }
                        >
                          <option value="A">A</option>
                          <option value="B">B</option>
                        </select>
                      </label>
                      <label>
                        Marcador A
                        <input
                          className="mm-input w-full"
                          type="number"
                          min={0}
                          max={target || 4}
                          value={scoreA}
                          onChange={(e) => setScoreA(e.target.value)}
                        />
                      </label>
                      <label>
                        Marcador B
                        <input
                          className="mm-input w-full"
                          type="number"
                          min={0}
                          max={target || 4}
                          value={scoreB}
                          onChange={(e) => setScoreB(e.target.value)}
                        />
                      </label>
                      <button
                        className="btn-primary sm:col-span-2"
                        disabled={
                          busy ||
                          checked !== 4 ||
                          !scoreValid ||
                          ["FINISHED", "CANCELLED"].includes(
                            current.event.status,
                          ) ||
                          current.event.result_status === "DISPUTED"
                        }
                        onClick={() =>
                          void run(async () => {
                            await report(
                              reportTeam,
                              winner,
                              `${scoreA}-${scoreB}`,
                            );
                            return "Reporte enviado.";
                          })
                        }
                      >
                        Enviar reporte de prueba
                      </button>
                    </div>
                  </details>
                </section>
                {current.event.result_status === "DISPUTED" &&
                  current.event.status !== "CANCELLED" && (
                    <section className="mt-6 space-y-3">
                      <h2 className="text-xl font-semibold">
                        3. Revisar disputa
                      </h2>
                      {current.can_review ? (
                        <DisputeReview
                          key={id}
                          match={current.event}
                          onResolved={load}
                        />
                      ) : (
                        <p>La resolución necesita una cuenta administradora.</p>
                      )}
                    </section>
                  )}
                {current.event.result_resolution_reason && (
                  <p className="mt-4 whitespace-pre-wrap">
                    Resolución: {current.event.result_resolution_reason}
                  </p>
                )}
                <section className="mt-6 rounded-2xl bg-white/5 p-4">
                  <h2 className="text-xl font-semibold">
                    Clasificación simulada
                  </h2>
                  <p className="mt-2 text-sm text-white/60">
                    Copia inicial de los puntos reales; cálculo base K=32 para
                    esta mesa, sin penalización por repetición. No modifica
                    perfiles, ranking real ni historial de partidas.
                  </p>
                  <ol className="mt-3 space-y-2">
                    {current.scores.map((s, i) => (
                      <li
                        key={s.user_id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/5 p-3"
                      >
                        <span className="min-w-0 break-words">
                          {i + 1}. @
                          {current.players.find((p) => p.user_id === s.user_id)
                            ?.username || "Jugador"}
                        </span>
                        <span className="font-mono">
                          {s.rating_before} → {s.rating_after} (
                          {s.delta > 0 ? "+" : ""}
                          {s.delta})
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              </>
            )}
          </>
        )
      )}
    </main>
  );
}
