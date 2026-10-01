"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Team = "A" | "B";

type Event = {
  id: string;
  title: string;
  description: string | null;
  match_type: "FRIENDLY" | "COMPETITIVE";
  pair_mode: "FIXED_PAIR" | "NEED_PARTNER";
  created_by: string;
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
  status: "OPEN" | "FULL" | "CLOSED" | "FINISHED";
};

type Participant = {
  id: string;
  user_id: string;
  team: Team | null;
  attendance_status?: "PENDING" | "CHECKED_IN" | "NO_SHOW" | "CANCELLED_EARLY" | "CANCELLED_LATE";
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
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [event, setEvent] = useState<Event | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>({});
  const [me, setMe] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultNotice, setResultNotice] = useState<string | null>(null);
  const [myPresenceCode, setMyPresenceCode] = useState<string | null>(null);
  const [rivalPresenceCode, setRivalPresenceCode] = useState("");
  const [myPresenceExpiresAt, setMyPresenceExpiresAt] = useState<string | null>(null);
  const [myPresenceNextRefreshAt, setMyPresenceNextRefreshAt] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState<number>(Date.now());

  const teamA = participants.filter((p) => p.team === "A");
  const teamB = participants.filter((p) => p.team === "B");
  const queue = participants.filter((p) => p.team === null);

  const myParticipant = useMemo(
    () => participants.find((p) => p.user_id === me) ?? null,
    [participants, me]
  );

  async function load() {
    setLoading(true);
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
      (profs ?? []).forEach((p: any) => (map[p.id] = p));
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

  async function joinTeam(team: Team) {
    if (!me || !myParticipant) return;

    setBusy(true);
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
    const { error: qErr } = await supabase.rpc("join_queue", { p_event_id: id });
    if (qErr) {
      setBusy(false);
      alert(qErr.message);
      return;
    }

    // 2) intentar asignar (1 persona por llamada)
    const { error: aErr } = await supabase.rpc("assign_team", { p_event_id: id });
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
        setResultNotice("Resultado auto-confirmado: ambos equipos reportaron lo mismo.");
      } else if (data === "DISPUTED_AUTO") {
        setResultNotice("Reportes incompatibles: disputa abierta automaticamente.");
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
    // Y aquÃ­ deberÃ­amos actualizar Reliability/ELO (backend function idealmente)
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

    const { error } = await supabase
      .from("events")
      .update({
        winner_team: null,
        result_score: null,
        result_proposed_by: null,
        result_status: null,
      })
      .eq("id", id)
      .eq("result_status", "PENDING")
      .eq("result_proposed_by", me);

    setBusy(false);

    if (error) {
      alert(error.message);
    } else {
      await load();
    }
  }

  async function generatePresenceCode() {
    if (!me) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("create_presence_token", {
      p_event_id: id,
    });
    setBusy(false);

    if (error) {
      alert(error.message);
      return;
    }

    const payload = (data as any) || {};
    setMyPresenceCode(payload.token ?? null);
    setMyPresenceExpiresAt(payload.expires_at ?? null);
    setMyPresenceNextRefreshAt(payload.next_refresh_at ?? null);
  }

  async function loadPresenceTokenStatus() {
    if (!me) return;
    const { data, error } = await supabase.rpc("get_my_presence_token_status", {
      p_event_id: id,
    });
    if (error) {
      return;
    }
    const payload = (data as any) || {};
    setMyPresenceCode(payload.token ?? null);
    setMyPresenceExpiresAt(payload.expires_at ?? null);
    setMyPresenceNextRefreshAt(payload.next_refresh_at ?? null);
  }

  async function submitRivalPresenceCode() {
    if (!me) return;
    if (!rivalPresenceCode.trim()) return;

    setBusy(true);
    const { data, error } = await supabase.rpc("submit_presence_token", {
      p_event_id: id,
      p_token: rivalPresenceCode.trim().toUpperCase(),
    });
    setBusy(false);

    if (error) {
      alert(error.message);
      return;
    }

    const status = (data as string) || "";
    if (status === "PROOF_ACCEPTED") {
      setResultNotice("Presencia validada correctamente.");
      setRivalPresenceCode("");
      await load();
      return;
    }

    const map: Record<string, string> = {
      TOKEN_NOT_FOUND: "Codigo no encontrado para esta partida.",
      TOKEN_OWN_USER: "No puedes validar tu propio codigo.",
      TOKEN_EXPIRED: "El codigo ha expirado.",
      TOKEN_ALREADY_USED: "Ese codigo ya fue usado.",
      TOKEN_OWNER_NOT_ACTIVE: "El duenyo del codigo no esta activo en la partida.",
      TOKEN_SAME_TEAM: "El codigo debe ser de un jugador del equipo rival.",
    };
    alert(map[status] ?? `No se pudo validar codigo (${status}).`);
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
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const timer = setInterval(() => {
      setClockNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!myParticipant?.team) return;
    loadPresenceTokenStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, myParticipant?.team, me]);

  useEffect(() => {
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
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading || !event) {
    return <p className="p-6 text-white/70">Cargando partidaâ€¦</p>;
  }

  const isNeedPartner = event.pair_mode === "NEED_PARTNER";
  const isFixedPair = event.pair_mode === "FIXED_PAIR";

  const aFull = teamA.length >= 2;
  const bFull = teamB.length >= 2;
  const isInQueue = myParticipant?.team === null;
  const isInA = myParticipant?.team === "A";
  const isInB = myParticipant?.team === "B";

  // Result UI helpers
  const isDisputed = event.result_status === "DISPUTED";
  const isFinished = event.status === "FINISHED" || event.result_status === "CONFIRMED";
  const isCompetitive = event.match_type === "COMPETITIVE";

  const myTeam = myParticipant?.team ?? null;
  const checkedInCount = participants.filter((p) => p.team && p.attendance_status === "CHECKED_IN").length;
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
    (aFull && bFull) &&
    !myTeamSubmitted &&
    canReportByPresence;

  const showConfirmUI =
    legacyPendingFlow &&
    event.result_proposed_by !== me &&
    !!myParticipant;

  const isMyPendingProposal =
    legacyPendingFlow &&
    event.result_proposed_by === me &&
    !!myParticipant;

  const isPendingWithoutParticipation =
    event.result_status === "PENDING" && !myParticipant;
  const pendingDeadlineText = event.result_pending_deadline
    ? new Date(event.result_pending_deadline).toLocaleString()
    : null;
  const expiresMs = myPresenceExpiresAt ? new Date(myPresenceExpiresAt).getTime() - clockNow : 0;
  const cooldownMs = myPresenceNextRefreshAt ? new Date(myPresenceNextRefreshAt).getTime() - clockNow : 0;
  const expiresSec = Math.max(0, Math.floor(expiresMs / 1000));
  const cooldownSec = Math.max(0, Math.floor(cooldownMs / 1000));
  const canRefreshPresenceCode = cooldownSec <= 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
        <h1 className="text-2xl font-bold text-mm-card">{event.title}</h1>

        <div className="mt-2 flex flex-wrap gap-2">
          <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-mm-card ring-1 ring-white/10">
            {event.match_type === "FRIENDLY" ? "ðŸŸ¢ Amistosa" : "ðŸ”´ Competitiva"}
          </span>
          <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-mm-card ring-1 ring-white/10">
            {event.pair_mode === "FIXED_PAIR" ? "ðŸ‘¥ Voy con pareja" : "ðŸ¤ Necesito pareja"}
          </span>
        </div>

        {errorMsg && <p className="mt-3 text-sm text-red-400">{errorMsg}</p>}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <TeamBox
            name="Equipo A"
            players={teamA}
            profiles={profiles}
            footer={
              isFixedPair ? (
                isInA ? (
                  <button disabled={busy} onClick={leave} className="btn-secondary">
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
              ) : (
                // NEED_PARTNER
                isInA ? (
                  <button disabled={busy} onClick={leave} className="btn-secondary">
                    Salir
                  </button>
                ) : (
                  <div className="text-sm text-white/60">
                    AsignaciÃ³n automÃ¡tica
                  </div>
                )
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
                  <button disabled={busy} onClick={leave} className="btn-secondary">
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
              ) : (
                // NEED_PARTNER
                isInB ? (
                  <button disabled={busy} onClick={leave} className="btn-secondary">
                    Salir
                  </button>
                ) : (
                  <div className="text-sm text-white/60">
                    AsignaciÃ³n automÃ¡tica
                  </div>
                )
              )
            }
          />
        </div>

        {isCompetitive && !isFinished && !isDisputed && (
          <div className="mt-6 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
            <p className="font-semibold text-mm-card">Verificacion de presencia (competitiva)</p>
            <p className="mt-1 text-sm text-white/70">
              Para reportar resultado en competitiva deben estar validados los 4 jugadores.
            </p>
            <p className="mt-2 text-sm text-white/70">
              Progreso: <span className="font-semibold text-mm-card">{checkedInCount}/4</span> jugadores validados.
            </p>

            <div className="mt-3 space-y-1">
              {participants
                .filter((p) => p.team)
                .map((p) => (
                  <p key={p.id} className="text-sm text-white/80">
                    @{profiles[p.user_id]?.username ?? "Jugador"} (Equipo {p.team}) -{" "}
                    <span className={p.attendance_status === "CHECKED_IN" ? "text-green-400" : "text-yellow-300"}>
                      {p.attendance_status === "CHECKED_IN" ? "Validado" : "Pendiente"}
                    </span>
                  </p>
                ))}
            </div>

            {!!myParticipant?.team && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                  <p className="text-sm text-white/70">Mi codigo de presencia</p>
                  {myPresenceCode ? (
                    <>
                      <p className="mt-1 text-lg font-bold tracking-widest text-mm-card">{myPresenceCode}</p>
                      <p className="mt-1 text-xs text-white/60">
                        Expira en: {Math.floor(expiresSec / 60)}m {expiresSec % 60}s
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-white/60">Genera un codigo y compartelo con un rival.</p>
                  )}
                  <button
                    disabled={busy || !canRefreshPresenceCode}
                    onClick={generatePresenceCode}
                    className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20"
                  >
                    {myPresenceCode
                      ? canRefreshPresenceCode
                        ? "Regenerar codigo"
                        : `Regenerar en ${cooldownSec}s`
                      : "Generar codigo"}
                  </button>
                </div>

                <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                  <p className="text-sm text-white/70">Validar codigo rival</p>
                  <input
                    value={rivalPresenceCode}
                    onChange={(e) => setRivalPresenceCode(e.target.value.toUpperCase())}
                    placeholder="Ej: AB3K9Q"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
                  />
                  <button
                    disabled={busy || !rivalPresenceCode.trim()}
                    onClick={submitRivalPresenceCode}
                    className="mt-3 rounded-xl bg-mm-gold px-3 py-2 text-sm font-semibold text-mm-bg hover:opacity-90 disabled:opacity-50"
                  >
                    Validar codigo
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {isNeedPartner && (
          <div className="mt-6 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-mm-card">Cola de emparejamiento</p>
                <p className="text-sm text-white/70">
                  Entra en cola y el sistema te asigna equipo cuando haya hueco.
                </p>
              </div>

              {myParticipant ? (
                <button disabled={busy} onClick={leave} className="btn-secondary">
                  Salir
                </button>
              ) : (
                <button disabled={busy || (aFull && bFull)} onClick={enterQueueAndAssign} className="btn-primary">
                  Entrar en cola
                </button>
              )}
            </div>

            <div className="mt-3">
              <p className="text-sm text-white/70">
                En cola: <span className="text-mm-card font-semibold">{queue.length}</span>
              </p>
              {queue.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {queue.map((p) => (
                    <li key={p.id} className="text-white">
                      @{profiles[p.user_id]?.username ?? "Jugador"}
                      {p.user_id === me ? <span className="text-white/50"> (tÃº)</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!myParticipant && (aFull && bFull) && (
              <p className="mt-3 text-sm text-white/70">
                La partida estÃ¡ completa.
              </p>
            )}

            {myParticipant && isInQueue && (
              <p className="mt-3 text-sm text-white/70">
                EstÃ¡s en cola. Cuando haya hueco, pulsa â€œEntrar en colaâ€ de nuevo o recarga.
                (Luego lo automatizamos con realtime.)
              </p>
            )}
          </div>
        )}
      </div>

      {/* RESULT SECTION */}
      {resultNotice && (
        <div className="mt-6 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <p className="text-sm text-white/80">{resultNotice}</p>
        </div>
      )}

      {isDisputed && (
        <div className="mt-6 rounded-2xl bg-red-500/10 p-4 ring-1 ring-red-500/30">
          <p className="font-bold text-red-400">Partido en Disputa</p>
          <p className="mt-1 text-sm text-white/70">
            Un administrador revisara el caso. Si teneis pruebas, contactad con soporte.
          </p>
          <a
            href={`mailto:soporte@musmatch.com?subject=Disputa%20Partida%20${id}&body=Hola,%0A%0AQuiero%20reportar%20una%20disputa%20en%20la%20partida%20${id}.`}
            className="mt-3 inline-block rounded-xl bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-500"
          >
            Contactar Soporte
          </a>
        </div>
      )}

      {isFinished && (
        <div className="mt-6 rounded-2xl bg-green-500/10 p-4 ring-1 ring-green-500/30 text-center">
          <p className="text-xl font-bold text-green-400">Partido Finalizado</p>
          <p className="text-lg text-white">
            Ganador: <span className="font-bold">{event.winner_team === "A" ? "Equipo A" : "Equipo B"}</span>
          </p>
          <p className="text-sm text-white/70">Resultado: {event.result_score}</p>
        </div>
      )}

      {!isFinished && !isDisputed && !!myTeam && event.result_status === "PENDING" && myTeamSubmitted && !rivalTeamSubmitted && (
        <div className="mt-6 rounded-2xl bg-blue-500/10 p-6 ring-1 ring-blue-500/30">
          <p className="font-bold text-blue-300 text-lg">Reporte enviado</p>
          <p className="mt-1 text-sm text-white/70">Tu equipo ya envio el resultado. Falta el equipo rival.</p>
          {pendingDeadlineText && (
            <p className="mt-1 text-sm text-white/70">
              Si no responden antes de {pendingDeadlineText}, se confirmara automaticamente tu reporte.
            </p>
          )}
        </div>
      )}

      {!isFinished && !isDisputed && !!myTeam && event.result_status === "PENDING" && !myTeamSubmitted && rivalTeamSubmitted && (
        <div className="mt-6 rounded-2xl bg-mm-gold/10 p-6 ring-1 ring-mm-gold/40">
          <p className="font-bold text-mm-gold text-lg">Falta tu reporte de equipo</p>
          <p className="mt-1 text-sm text-white/70">El rival ya envio su version. Envia la de tu equipo para resolver automaticamente.</p>
          {pendingDeadlineText && (
            <p className="mt-1 text-sm text-white/70">
              Limite de respuesta: {pendingDeadlineText}.
            </p>
          )}
        </div>
      )}

      {showConfirmUI && (
        <div className="mt-6 rounded-2xl bg-mm-gold/10 p-6 ring-1 ring-mm-gold/40">
          <p className="font-bold text-mm-gold text-lg">Confirmar Resultado (modo legacy)</p>
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
          <p className="mt-1 text-sm text-white/70">Tu propuesta legacy esta pendiente del rival.</p>
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
        <div className="mt-6 rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
          <p className="font-bold text-mm-card text-lg">Resultado pendiente</p>
          <p className="mt-1 text-sm text-white/70">
            Esta cuenta no figura como participante en esta partida.
          </p>
          <p className="mt-1 text-sm text-white/70">
            Solo jugadores participantes pueden reportar/confirmar/disputar.
          </p>
        </div>
      )}

      {!isFinished && !isDisputed && isCompetitive && !!myTeam && !canReportByPresence && (
        <div className="mt-6 rounded-2xl bg-yellow-500/10 p-4 ring-1 ring-yellow-500/30">
          <p className="font-semibold text-yellow-300">Falta validar presencia</p>
          <p className="mt-1 text-sm text-white/70">
            En competitiva no se puede reportar resultado hasta tener 4/4 jugadores validados.
          </p>
        </div>
      )}

      {showTeamReportUI && (
        <ReportForm busy={busy} onReport={reportResult} />
      )}

    </main>
  );
}

function ReportForm({
  busy,
  onReport,
}: {
  busy: boolean;
  onReport: (w: Team, s: string) => void;
}) {
  const [winner, setWinner] = useState<Team>("A");
  const [score, setScore] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!score) return;
    onReport(winner, score);
  };

  return (
    <div className="mt-6 rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
      <h3 className="text-lg font-bold text-mm-card">Reportar Resultado</h3>
      <p className="text-sm text-white/60 mb-4">
        Reporta el resultado desde tu equipo. El sistema lo cruza con el reporte rival.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-white/70 mb-1">Ganador</label>
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
          <label className="block text-sm text-white/70 mb-1">Resultado (ej: 3-1)</label>
          <input
            value={score}
            onChange={(e) => setScore(e.target.value)}
            placeholder="3-1"
            className="w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
          />
        </div>

        <button
          disabled={busy || !score}
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
    <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
      <h2 className="font-semibold text-mm-card">{name}</h2>

      <ul className="mt-2 space-y-1">
        {players.map((p) => (
          <li key={p.id} className="text-white">
            @{profiles[p.user_id]?.username ?? "Jugador"} <span className="text-white/50 text-xs">({profiles[p.user_id]?.elo_rating ?? 1000})</span>
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

// Tailwind helper classes (sin tocar config)
const btnBase =
  "w-full rounded-xl px-3 py-2 font-semibold transition disabled:opacity-50";

const btnPrimary = `${btnBase} bg-mm-gold text-mm-bg hover:opacity-90`;
const btnSecondary = `${btnBase} bg-white/10 text-white hover:bg-white/20`;

// @ts-ignore
(globalThis as any).btn_primary = btnPrimary;
// @ts-ignore
(globalThis as any).btn_secondary = btnSecondary;
