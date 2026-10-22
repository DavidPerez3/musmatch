"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import MatchManagement from "@/components/MatchManagement";
import Link from "next/link";
import PresenceCheckIn from "@/components/PresenceCheckIn";
import MatchRulesCard from "@/components/MatchRulesCard";
import { MatchRules, scoreTarget } from "@/lib/matchRules";
import { supabase } from "@/lib/supabaseClient";

type Team = "A" | "B";

type Event = MatchRules & {
  id: string;
  title: string;
  description: string | null;
  notes: string | null;
  starts_at: string;
  location_text: string | null;
  match_type: "FRIENDLY" | "COMPETITIVE";
  pair_mode: "FIXED_PAIR" | "NEED_PARTNER";
  created_by: string;
  simulation_owner_id?: string | null;
  // Result fields
  winner_team: Team | null;
  result_score: string | null;
  result_proposed_by: string | null;
  result_status: "PENDING" | "CONFIRMED" | "DISPUTED" | null;
  result_team_a_winner: Team | null;
  result_team_a_score: string | null;
  result_team_a_submitted_at: string | null;
  result_team_b_winner: Team | null;
  result_team_b_score: string | null;
  result_team_b_submitted_at: string | null;
  result_resolution_reason: string | null;
  result_pending_since: string | null;
  result_pending_deadline: string | null;
  status: "OPEN" | "FULL" | "CLOSED" | "FINISHED" | "CANCELLED";
};

type Participant = {
  id: string;
  user_id: string;
  team: Team | null;
  attendance_status?:
    | "PENDING"
    | "CHECKED_IN"
    | "NO_SHOW"
    | "CANCELLED_EARLY"
    | "CANCELLED_LATE";
};

type ProfileMini = {
  id: string;
  username: string | null;
  elo_rating: number;
};

async function requireUsername(router: ReturnType<typeof useRouter>) {
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    router.push("/login");
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();

  if (!profile?.username || profile.username.trim().length < 3) {
    router.push("/profile");
    return null;
  }

  return user.id;
}

export default function EventDetail() {
  const id = useSearchParams().get("id") || "";
  const router = useRouter();

  const [event, setEvent] = useState<Event | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>({});
  const [me, setMe] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultNotice, setResultNotice] = useState<string | null>(null);
  const teamA = participants.filter((p) => p.team === "A");
  const teamB = participants.filter((p) => p.team === "B");
  const queue = participants.filter((p) => p.team === null);

  const myParticipant = useMemo(
    () => participants.find((p) => p.user_id === me) ?? null,
    [participants, me],
  );

  async function load() {
    if (!id) return;
    setErrorMsg(null);

    const uid = await requireUsername(router);
    if (!uid) return;
    setMe(uid);

    const { data: ev, error: evErr } = await supabase
      .from("events")
      .select("*")
      .eq("id", id)
      .single();

    if (evErr) {
      setErrorMsg(evErr.message);
      setLoading(false);
      return;
    }

    setEvent(ev as Event);

    const { data: parts, error: pErr } = await supabase
      .from("event_participants")
      .select("id,user_id,team,attendance_status")
      .eq("event_id", id)
      .order("joined_at", { ascending: true });

    if (pErr) {
      setErrorMsg(pErr.message);
      setLoading(false);
      return;
    }

    const list = (parts ?? []) as Participant[];
    setParticipants(list);

    const ids = [...new Set(list.map((p) => p.user_id))];
    if (ids.length) {
      const { data: profs, error: prErr } = await supabase
        .from("profiles")
        .select("id,username,elo_rating")
        .in("id", ids);

      if (prErr) {
        setErrorMsg(prErr.message);
        setLoading(false);
        return;
      }

      const map: Record<string, ProfileMini> = {};
      (profs ?? []).forEach((p: ProfileMini) => (map[p.id] = p));
      setProfiles(map);
    } else {
      setProfiles({});
    }

    setLoading(false);
  }

  async function leave() {
    if (!me) return;
    setBusy(true);

    const { error } = await supabase
      .from("event_participants")
      .delete()
      .eq("event_id", id)
      .eq("user_id", me);

    setBusy(false);

    if (error) {
      alert(error.message);
      return;
    }

    await load();
  }

  async function fixedJoin(team: Team) {
    // Para FIXED_PAIR permitimos entrar directo con team.
    if (!me) return;

    setBusy(true);

    if (myParticipant) {
      const { error } = await supabase
        .from("event_participants")
        .update({ team })
        .eq("id", myParticipant.id);

      setBusy(false);
      if (error) {
        alert(error.message);
        return;
      }
      await load();
      return;
    }

    const { error } = await supabase.from("event_participants").insert({
      event_id: id,
      user_id: me,
      team,
    });

    setBusy(false);

    if (error) {
      alert(error.message);
      return;
    }

    await load();
  }

  async function enterQueueAndAssign() {
    if (!me) return;

    setBusy(true);

    // 1) entrar en cola (team=null)
    const { error: qErr } = await supabase.rpc("join_queue", {
      p_event_id: id,
    });
    if (qErr) {
      setBusy(false);
      alert(qErr.message);
      return;
    }

    // 2) intentar asignar (1 persona por llamada)
    const { error: aErr } = await supabase.rpc("assign_team", {
      p_event_id: id,
    });
    setBusy(false);

    if (aErr) {
      alert(aErr.message);
      return;
    }

    await load();
  }

  // --- RESULT LOGIC ---

  async function reportResult(winner: Team, score: string) {
    if (!me) return;
    setBusy(true);

    const { data, error } = await supabase.rpc("submit_team_result", {
      match_id: id,
      winner_team: winner,
      result_score: score,
    });

    setBusy(false);

    if (error) {
      alert(error.message);
    } else {
      if (data === "PENDING_OTHER_TEAM") {
        setResultNotice("Resultado enviado. Falta el reporte del otro equipo.");
      } else if (data === "CONFIRMED_AUTO") {
        setResultNotice(
          "Resultado auto-confirmado: ambos equipos reportaron lo mismo.",
        );
      } else if (data === "DISPUTED_AUTO") {
        setResultNotice(
          "Reportes incompatibles: disputa abierta automaticamente.",
        );
      } else {
        setResultNotice("Resultado enviado.");
      }
      await load();
    }
  }

  async function confirmResult() {
    if (!me) return;
    setBusy(true);

    // Confirmar implica: status='FINISHED', result_status='CONFIRMED'
    // Y aquí deberíamos actualizar Reliability/ELO (backend function idealmente)
    const { error } = await supabase.rpc("confirm_match_and_update_elo", {
      match_id: id,
    });

    setBusy(false);

    if (error) {
      alert(error.message);
    } else {
      await load();
    }
  }

  async function disputeResult() {
    if (!me) return;
    setBusy(true);

    const { error } = await supabase.rpc("dispute_match", {
      match_id: id,
    });

    setBusy(false);

    if (error) {
      alert(error.message);
    } else {
      await load();
    }
  }

  async function cancelPendingResult() {
    if (!me) return;
    setBusy(true);

    const { error } = await supabase.rpc("withdraw_legacy_result", {
      p_event_id: id,
    });

    setBusy(false);

    if (error) {
      alert(error.message);
    } else {
      await load();
    }
  }

  // Auto-assign suave: si es NEED_PARTNER y hay cola, intentamos asignar
  // (Esto hace que al entrar alguien, se rellenen equipos sin tener que pulsar muchas veces)
  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`event_participants_${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_participants",
          filter: `event_id=eq.${id}`,
        },
        async () => {
          await load();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`event_updates_${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "events",
          filter: `id=eq.${id}`,
        },
        async () => {
          await load();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id)
    return (
      <p className="text-white/70">
        Selecciona una partida desde el inicio o Mis partidas.
      </p>
    );

  if (errorMsg && !event)
    return (
      <p role="alert" className="text-red-300">
        {errorMsg}
      </p>
    );

  if (loading || !event || event.id !== id) {
    return <p className="p-6 text-white/70">Cargando partida…</p>;
  }

  if (event.status === "CANCELLED") return <main className="mm-page max-w-3xl"><h1 className="text-2xl font-bold">{event.title}</h1><p className="mt-3 text-amber-200">Partida cancelada</p><p className="mt-2 break-words">{event.result_resolution_reason}</p><MatchRulesCard rules={event}/><MatchManagement key={`${id}:${myParticipant?.id}:${event.status}:${event.result_status}`} id={id} owner={event.created_by===me} active={false} onChange={load}/></main>;
  const isNeedPartner = event.pair_mode === "NEED_PARTNER";
  const isFixedPair = event.pair_mode === "FIXED_PAIR";

  const aFull = teamA.length >= 2;
  const bFull = teamB.length >= 2;
  const isInQueue = myParticipant?.team === null;
  const isInA = myParticipant?.team === "A";
  const isInB = myParticipant?.team === "B";

  // Result UI helpers
  const isDisputed = event.result_status === "DISPUTED";
  const isFinished =
    event.status === "FINISHED" || event.result_status === "CONFIRMED";
  const isCompetitive = event.match_type === "COMPETITIVE";

  const myTeam = myParticipant?.team ?? null;
  const checkedInCount = participants.filter(
    (p) => p.team && p.attendance_status === "CHECKED_IN",
  ).length;
  const canReportByPresence = !isCompetitive || checkedInCount >= 4;
  const legacyPendingFlow =
    event.result_status === "PENDING" &&
    !event.result_team_a_submitted_at &&
    !event.result_team_b_submitted_at;

  const myTeamSubmitted =
    myTeam === "A"
      ? !!event.result_team_a_submitted_at
      : myTeam === "B"
        ? !!event.result_team_b_submitted_at
        : false;

  const rivalTeamSubmitted =
    myTeam === "A"
      ? !!event.result_team_b_submitted_at
      : myTeam === "B"
        ? !!event.result_team_a_submitted_at
        : false;

  const showTeamReportUI =
    !loading &&
    !isFinished &&
    !isDisputed &&
    !legacyPendingFlow &&
    !!myTeam &&
    aFull &&
    bFull &&
    !myTeamSubmitted &&
    canReportByPresence;

  const showConfirmUI =
    legacyPendingFlow && event.result_proposed_by !== me && !!myParticipant;

  const isMyPendingProposal =
    legacyPendingFlow && event.result_proposed_by === me && !!myParticipant;

  const isPendingWithoutParticipation =
    event.result_status === "PENDING" && !myParticipant;
  const pendingDeadlineText = event.result_pending_deadline
    ? new Date(event.result_pending_deadline).toLocaleString()
    : null;

  return (
    <main className="mm-page max-w-3xl">
      <nav className="mm-section-nav" aria-label="Secciones de la partida">
        <a href="#jugadores">Jugadores</a>
        <a href="#presencia">Presencia</a>
        <a href="#resultado">Resultado</a>
      </nav>
      <div className="mm-panel rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
        <h1 className="text-2xl font-bold text-mm-card">{event.title}</h1>
        {event.simulation_owner_id && <p className="mt-3 rounded-xl bg-amber-500/10 p-3">Mesa de prueba: el ELO real no cambia. <Link className="underline" href={`/simulator/?id=${id}`}>Abrir controles del simulador</Link></p>}
        <p className="mt-2 text-sm text-white/70">
          {new Date(event.starts_at).toLocaleString()} ·{" "}
          {event.location_text || "Sin ubicación"}
        </p>
        {event.notes && (
          <p className="mt-3 whitespace-pre-wrap text-sm text-white/70">
            {event.notes}
          </p>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          <span className={`mm-type-badge ${event.match_type === "COMPETITIVE" ? "is-competitive" : ""} rounded-full bg-white/5 px-3 py-1 text-xs text-mm-card ring-1 ring-white/10`}>
            {event.match_type === "FRIENDLY" ? "Amistosa" : "Competitiva"}
          </span>
          <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-mm-card ring-1 ring-white/10">
            {event.pair_mode === "FIXED_PAIR"
              ? "Voy con pareja"
              : "Necesito pareja"}
          </span>
        </div>

        {errorMsg && <p className="mt-3 text-sm text-red-400">{errorMsg}</p>}

        <MatchRulesCard rules={event} />
        <MatchManagement key={`${id}:${myParticipant?.id}:${event.status}:${event.result_status}`} id={id} owner={event.created_by===me} active={["OPEN","FULL"].includes(event.status)&&!event.result_status} onChange={load}/>
        <div id="jugadores" className="mt-6 grid gap-4 sm:grid-cols-2">
          <TeamBox
            name="Equipo A"
            players={teamA}
            profiles={profiles}
            footer={
              isFixedPair ? (
                isInA ? (
                  <button
                    disabled={busy}
                    onClick={leave}
                    className="btn-secondary"
                  >
                    Salir
                  </button>
                ) : (
                  <button
                    disabled={busy || aFull}
                    onClick={() => fixedJoin("A")}
                    className="btn-primary"
                  >
                    {aFull ? "Equipo completo" : "Unirme a A"}
                  </button>
                )
              ) : // NEED_PARTNER
              isInA ? (
                <button
                  disabled={busy}
                  onClick={leave}
                  className="btn-secondary"
                >
                  Salir
                </button>
              ) : (
                <div className="text-sm text-white/60">
                  Asignación automática
                </div>
              )
            }
          />

          <TeamBox
            name="Equipo B"
            players={teamB}
            profiles={profiles}
            footer={
              isFixedPair ? (
                isInB ? (
                  <button
                    disabled={busy}
                    onClick={leave}
                    className="btn-secondary"
                  >
                    Salir
                  </button>
                ) : (
                  <button
                    disabled={busy || bFull}
                    onClick={() => fixedJoin("B")}
                    className="btn-primary"
                  >
                    {bFull ? "Equipo completo" : "Unirme a B"}
                  </button>
                )
              ) : // NEED_PARTNER
              isInB ? (
                <button
                  disabled={busy}
                  onClick={leave}
                  className="btn-secondary"
                >
                  Salir
                </button>
              ) : (
                <div className="text-sm text-white/60">
                  Asignación automática
                </div>
              )
            }
          />
        </div>

        {isCompetitive && !isFinished && !isDisputed && (
          <div
            id="presencia"
            className="mt-6 mm-panel rounded-2xl bg-white/5 p-4 ring-1 ring-white/10"
          >
            <p className="font-semibold text-mm-card">
              Presencia validada (competitiva)
            </p>
            <p className="mt-1 text-sm text-white/70">
              Para reportar resultado en competitiva deben estar validados los 4
              jugadores.
            </p>
            <p className="mt-2 text-sm text-white/70">
              Progreso:{" "}
              <span className="font-semibold text-mm-card">
                {checkedInCount}/4
              </span>{" "}
              jugadores validados.
            </p>

            <div className="mt-3 space-y-1">
              {participants
                .filter((p) => p.team)
                .map((p) => (
                  <p key={p.id} className="text-sm text-white/80">
                    @{profiles[p.user_id]?.username ?? "Jugador"} (Equipo{" "}
                    {p.team}) -{" "}
                    <span
                      className={
                        p.attendance_status === "CHECKED_IN"
                          ? "text-green-400"
                          : "text-yellow-300"
                      }
                    >
                      {p.attendance_status === "CHECKED_IN"
                        ? "Validado"
                        : "Pendiente"}
                    </span>
                  </p>
                ))}
            </div>

            {checkedInCount === 4 && (
              <p role="status" className="mt-3 text-sm text-green-300">
                Los cuatro jugadores tenéis la presencia validada. Ya podéis
                registrar el resultado al terminar.
              </p>
            )}
            <button
              type="button"
              onClick={load}
              className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-sm"
            >
              Actualizar presencia
            </button>
            {!!myParticipant?.team &&
              checkedInCount < 4 &&
              (event.status === "OPEN" || event.status === "FULL") && (
                <PresenceCheckIn
                  key={event.id}
                  eventId={event.id}
                  enabled={teamA.length === 2 && teamB.length === 2}
                  onValidated={load}
                />
              )}
          </div>
        )}

        {isNeedPartner && (
          <div className="mt-6 mm-panel rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
            <div className="flex mm-stack items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-mm-card">
                  Cola de emparejamiento
                </p>
                <p className="text-sm text-white/70">
                  Entra en cola y el sistema te asigna equipo cuando haya hueco.
                </p>
              </div>

              {myParticipant ? (
                <button
                  disabled={busy}
                  onClick={leave}
                  className="btn-secondary"
                >
                  Salir
                </button>
              ) : (
                <button
                  disabled={busy || (aFull && bFull)}
                  onClick={enterQueueAndAssign}
                  className="btn-primary"
                >
                  Entrar en cola
                </button>
              )}
            </div>

            <div className="mt-3">
              <p className="text-sm text-white/70">
                En cola:{" "}
                <span className="text-mm-card font-semibold">
                  {queue.length}
                </span>
              </p>
              {queue.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {queue.map((p) => (
                    <li key={p.id} className="text-white">
                      @{profiles[p.user_id]?.username ?? "Jugador"}
                      {p.user_id === me ? (
                        <span className="text-white/50"> (tú)</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!myParticipant && aFull && bFull && (
              <p className="mt-3 text-sm text-white/70">
                La partida está completa.
              </p>
            )}

            {myParticipant && isInQueue && (
              <p className="mt-3 text-sm text-white/70">
                Estás en cola. Recarga para comprobar si hay plazas disponibles.
              </p>
            )}
          </div>
        )}
      </div>

      {!isCompetitive && (
        <p
          id="presencia"
          className="mt-6 rounded-xl bg-white/5 p-4 text-sm text-white/70"
        >
          En amistosa la verificación de presencia no es obligatoria.
        </p>
      )}
      {isCompetitive && (isFinished || isDisputed) && (
        <p id="presencia" className="mt-6 text-sm text-white/70">
          Jugadores con presencia validada: {checkedInCount}/4.
        </p>
      )}
      <div id="resultado" className="mt-8 border-t border-white/10 pt-6">
        <h2 className="text-xl font-semibold">Resultado de la partida</h2>
      </div>
      {/* RESULT SECTION */}
      {resultNotice && (
        <div className="mt-6 mm-panel rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <p className="text-sm text-white/80">{resultNotice}</p>
        </div>
      )}

      {isDisputed && (
        <div className="mt-6 rounded-2xl bg-red-500/10 p-4 ring-1 ring-red-500/30">
          <p className="font-bold text-red-400">Partido en Disputa</p>
          <p className="mt-1 text-sm text-white/70">
            Un administrador revisará los reportes y la presencia registrada. La resolución y su motivo aparecerán en esta partida.
          </p>

        </div>
      )}

      {isFinished && (
        <div className="mt-6 rounded-2xl bg-green-500/10 p-4 ring-1 ring-green-500/30 text-center">
          <p className="text-xl font-bold text-green-400">Partido Finalizado</p>
          <p className="text-lg text-white">
            Ganador:{" "}
            <span className="font-bold">
              {event.winner_team === "A" ? "Equipo A" : "Equipo B"}
            </span>
          </p>
          <p className="text-sm text-white/70">
            Resultado: {event.result_score}
          </p>
        </div>
      )}

      {!isFinished &&
        !isDisputed &&
        !!myTeam &&
        event.result_status === "PENDING" &&
        myTeamSubmitted &&
        !rivalTeamSubmitted && (
          <div className="mt-6 rounded-2xl bg-blue-500/10 p-6 ring-1 ring-blue-500/30">
            <p className="font-bold text-blue-300 text-lg">Reporte enviado</p>
            <p className="mt-1 text-sm text-white/70">
              Tu equipo ya envio el resultado. Falta el equipo rival.
            </p>
            {pendingDeadlineText && (
              <p className="mt-1 text-sm text-white/70">
                Si no responden antes de {pendingDeadlineText}, pasara a
                revision sin modificar el ELO.
              </p>
            )}
          </div>
        )}

      {!isFinished &&
        !isDisputed &&
        !!myTeam &&
        event.result_status === "PENDING" &&
        !myTeamSubmitted &&
        rivalTeamSubmitted && (
          <div className="mt-6 rounded-2xl bg-mm-gold/10 p-6 ring-1 ring-mm-gold/40">
            <p className="font-bold text-mm-gold text-lg">
              Falta tu reporte de equipo
            </p>
            <p className="mt-1 text-sm text-white/70">
              El rival ya envio su version. Envia la de tu equipo para resolver
              automaticamente.
            </p>
            {pendingDeadlineText && (
              <p className="mt-1 text-sm text-white/70">
                Limite de respuesta: {pendingDeadlineText}.
              </p>
            )}
          </div>
        )}

      {showConfirmUI && (
        <div className="mt-6 rounded-2xl bg-mm-gold/10 p-6 ring-1 ring-mm-gold/40">
          <p className="font-bold text-mm-gold text-lg">
            Confirmar Resultado (modo legacy)
          </p>
          <p className="text-white/80">
            El rival ha propuesto:
            <span className="font-bold ml-1">
              Gana {event.winner_team} ({event.result_score})
            </span>
          </p>
          <div className="mt-4 flex gap-3">
            <button
              disabled={busy}
              onClick={confirmResult}
              className="rounded-xl bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-500"
            >
              Confirmar
            </button>
            <button
              disabled={busy}
              onClick={disputeResult}
              className="rounded-xl bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-500"
            >
              Disputar
            </button>
          </div>
        </div>
      )}

      {isMyPendingProposal && (
        <div className="mt-6 rounded-2xl bg-blue-500/10 p-6 ring-1 ring-blue-500/30">
          <p className="font-bold text-blue-300 text-lg">Resultado enviado</p>
          <p className="mt-1 text-sm text-white/70">
            Tu propuesta legacy esta pendiente del rival.
          </p>
          <div className="mt-4">
            <button
              disabled={busy}
              onClick={cancelPendingResult}
              className="rounded-xl bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/20"
            >
              Retirar propuesta
            </button>
          </div>
        </div>
      )}

      {isPendingWithoutParticipation && (
        <div className="mt-6 mm-panel rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
          <p className="font-bold text-mm-card text-lg">Resultado pendiente</p>
          <p className="mt-1 text-sm text-white/70">
            Esta cuenta no figura como participante en esta partida.
          </p>
          <p className="mt-1 text-sm text-white/70">
            Solo jugadores participantes pueden reportar/confirmar/disputar.
          </p>
        </div>
      )}

      {!isFinished &&
        !isDisputed &&
        isCompetitive &&
        !!myTeam &&
        !canReportByPresence && (
          <div className="mt-6 rounded-2xl bg-yellow-500/10 p-4 ring-1 ring-yellow-500/30">
            <p className="font-semibold text-yellow-300">
              Falta validar presencia
            </p>
            <p className="mt-1 text-sm text-white/70">
              En competitiva no se puede reportar resultado hasta tener 4/4
              jugadores validados.
            </p>
          </div>
        )}

      {showTeamReportUI && (
        <ReportForm rules={event} busy={busy} onReport={reportResult} />
      )}
    </main>
  );
}

function ReportForm({
  rules,
  busy,
  onReport,
}: {
  busy: boolean;
  onReport: (w: Team, s: string) => void;
  rules: MatchRules;
}) {
  const [winner, setWinner] = useState<Team>("A");
  const [score, setScore] = useState("");
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const target = scoreTarget(rules);
  const a = Number(scoreA),
    b = Number(scoreB);
  const structuredValid =
    target !== null &&
    scoreA !== "" &&
    scoreB !== "" &&
    Number.isInteger(a) &&
    Number.isInteger(b) &&
    a >= 0 &&
    b >= 0 &&
    ((a === target && b < target) || (b === target && a < target));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (target !== null) {
      if (!structuredValid) return;
      onReport(a > b ? "A" : "B", `${a}-${b}`);
    } else {
      if (!score) return;
      onReport(winner, score);
    }
  };

  return (
    <div className="mt-6 mm-panel rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
      <h3 className="text-lg font-bold text-mm-card">Reportar Resultado</h3>
      <p className="text-sm text-white/60 mb-4">
        Reporta el resultado desde tu equipo. El sistema lo cruza con el reporte
        rival.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {target !== null ? (
          <>
            <p className="text-sm text-white/70">
              Indica {rules.vacas_to_win === 1 ? "juegos" : "vacas"} ganados por
              cada equipo. El ganador debe llegar a {target}. El orden siempre
              es A–B, también para el equipo B.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="score-a" className="block text-sm">
                  Equipo A
                </label>
                <input
                  id="score-a"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={target}
                  step={1}
                  required
                  value={scoreA}
                  onChange={(e) => setScoreA(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2"
                />
              </div>
              <div>
                <label htmlFor="score-b" className="block text-sm">
                  Equipo B
                </label>
                <input
                  id="score-b"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={target}
                  step={1}
                  required
                  value={scoreB}
                  onChange={(e) => setScoreB(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2"
                />
              </div>
            </div>
            <p role="status" className="text-sm text-mm-gold">
              {structuredValid
                ? `Gana el equipo ${a > b ? "A" : "B"}`
                : "Introduce un marcador final válido, sin empate."}
            </p>
          </>
        ) : (
          <>
            <div>
              <label className="block text-sm text-white/70 mb-1">
                Ganador
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="winner"
                    value="A"
                    checked={winner === "A"}
                    onChange={() => setWinner("A")}
                    className="accent-mm-gold"
                  />
                  <span className="text-white">Equipo A</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="winner"
                    value="B"
                    checked={winner === "B"}
                    onChange={() => setWinner("B")}
                    className="accent-mm-gold"
                  />
                  <span className="text-white">Equipo B</span>
                </label>
              </div>
            </div>

            <div>
              <label
                htmlFor="field-1"
                className="block text-sm text-white/70 mb-1"
              >
                Resultado (ej: 3-1)
              </label>
              <input
                id="field-1"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                placeholder="3-1"
                className="w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
              />
            </div>
          </>
        )}
        <button
          disabled={busy || (target !== null ? !structuredValid : !score)}
          className="rounded-xl bg-mm-gold px-4 py-2 font-semibold text-mm-bg disabled:opacity-50"
        >
          Enviar Resultado
        </button>
      </form>
    </div>
  );
}

function TeamBox({
  name,
  players,
  profiles,
  footer,
}: {
  name: string;
  players: Participant[];
  profiles: Record<string, ProfileMini>;
  footer: React.ReactNode;
}) {
  return (
    <div className="mm-panel rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
      <h2 className="font-semibold text-mm-card">{name}</h2>

      <ul className="mt-2 space-y-1">
        {players.map((p) => (
          <li key={p.id} className="text-white">
            @{profiles[p.user_id]?.username ?? "Jugador"}{" "}
            <span className="text-white/50 text-xs">
              ({profiles[p.user_id]?.elo_rating ?? 1000})
            </span>
          </li>
        ))}
        {Array.from({ length: 2 - players.length }).map((_, i) => (
          <li key={i} className="text-white/40">
            Hueco libre
          </li>
        ))}
      </ul>

      <div className="mt-3">{footer}</div>
    </div>
  );
}
