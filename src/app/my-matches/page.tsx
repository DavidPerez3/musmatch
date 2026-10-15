"use client";

import { eventPath } from "@/lib/paths";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Team = "A" | "B";

type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  location_text: string | null;
  match_type: "FRIENDLY" | "COMPETITIVE";
  pair_mode: "FIXED_PAIR" | "NEED_PARTNER";
  status: "OPEN" | "FULL" | "CLOSED" | "FINISHED" | "CANCELLED";
  result_status: "PENDING" | "CONFIRMED" | "DISPUTED" | null;
  result_team_a_submitted_at: string | null;
  result_team_b_submitted_at: string | null;
  winner_team: Team | null;
  result_score: string | null;
};

type MyEvent = EventRow & {
  my_team: Team | null;
};

function isMyReportSubmitted(e: MyEvent) {
  if (e.my_team === "A") return !!e.result_team_a_submitted_at;
  if (e.my_team === "B") return !!e.result_team_b_submitted_at;
  return false;
}

function isRivalReportSubmitted(e: MyEvent) {
  if (e.my_team === "A") return !!e.result_team_b_submitted_at;
  if (e.my_team === "B") return !!e.result_team_a_submitted_at;
  return false;
}

function EventCard({ e, badge }: { e: MyEvent; badge: string }) {
  return (
    <Link
      href={eventPath(e.id)}
      className="block rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 transition hover:bg-white/10"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold text-mm-card">{e.title}</h3>
          <p className="mt-1 text-sm text-white/70">
            {new Date(e.starts_at).toLocaleString()} · {e.location_text ?? "Sin ubicacion"}
          </p>
          <p className="mt-1 text-sm text-white/60">
            {e.match_type === "FRIENDLY" ? "Amistosa" : "Competitiva"} ·{" "}
            {e.pair_mode === "FIXED_PAIR" ? "Pareja fija" : "Necesito pareja"}
          </p>
          {e.result_status === "CONFIRMED" && e.winner_team && (
            <p className="mt-1 text-sm text-white/70">
              Resultado: gana equipo {e.winner_team}
              {e.result_score ? ` (${e.result_score})` : ""}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs text-mm-card ring-1 ring-white/20">
          {badge}
        </span>
      </div>
    </Link>
  );
}

export default function MyMatchesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [events, setEvents] = useState<MyEvent[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErrorMsg(null);

      const { data: u } = await supabase.auth.getUser();
      const user = u.user;
      if (!user) {
        router.push("/login");
        return;
      }

      const { data: parts, error: pErr } = await supabase
        .from("event_participants")
        .select("event_id,team")
        .eq("user_id", user.id);

      if (pErr) {
        setErrorMsg(pErr.message);
        setLoading(false);
        return;
      }

      const partList = (parts ?? []) as Array<{ event_id: string; team: Team | null }>;
      if (partList.length === 0) {
        setEvents([]);
        setLoading(false);
        return;
      }

      const ids = [...new Set(partList.map((p) => p.event_id))];
      const teamByEvent = new Map(partList.map((p) => [p.event_id, p.team]));

      const { data: evs, error: eErr } = await supabase
        .from("events")
        .select(
          "id,title,starts_at,location_text,match_type,pair_mode,status,result_status,result_team_a_submitted_at,result_team_b_submitted_at,winner_team,result_score"
        )
        .in("id", ids)
        .order("starts_at", { ascending: true });

      if (eErr) {
        setErrorMsg(eErr.message);
        setLoading(false);
        return;
      }

      const merged: MyEvent[] = ((evs ?? []) as EventRow[]).map((e) => ({
        ...e,
        my_team: (teamByEvent.get(e.id) ?? null) as Team | null,
      }));

      setEvents(merged);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sections = useMemo(() => {
    const now = Date.now();

    const needsMyReport = events.filter(
      (e) =>
        e.result_status === "PENDING" &&
        isRivalReportSubmitted(e) &&
        !isMyReportSubmitted(e)
    );

    const waitingRival = events.filter(
      (e) =>
        e.result_status === "PENDING" &&
        isMyReportSubmitted(e) &&
        !isRivalReportSubmitted(e)
    );

    const disputed = events.filter((e) => e.result_status === "DISPUTED");

    const upcoming = events.filter(
      (e) =>
        (e.status === "OPEN" || e.status === "FULL") &&
        new Date(e.starts_at).getTime() >= now &&
        e.result_status !== "PENDING" &&
        e.result_status !== "DISPUTED"
    );

    const finished = events.filter(
      (e) => e.result_status === "CONFIRMED" || e.status === "FINISHED"
    );

    return { needsMyReport, waitingRival, disputed, upcoming, finished };
  }, [events]);

  return (
    <main className="mm-page max-w-5xl">
      <h1 className="text-3xl font-bold text-mm-card">Mis partidas</h1>
      <p className="mt-2 text-white/70">Vista rapida de tus pendientes y actividad</p>

      {loading && <p className="mt-6 text-white/70">Cargando...</p>}

      {!loading && errorMsg && (
        <div className="mt-6 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <p className="font-semibold text-mm-card">Error cargando tus partidas</p>
          <p className="mt-1 text-sm text-white/70">{errorMsg}</p>
        </div>
      )}

      {!loading && !errorMsg && (
        <div className="mt-6 space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-mm-card">Accion requerida</h2>
            <p className="mt-1 text-sm text-white/60">El rival ya reporto y falta tu version</p>
            <div className="mt-3 space-y-3">
              {sections.needsMyReport.length === 0 ? (
                <p className="text-sm text-white/60">Nada pendiente aqui.</p>
              ) : (
                sections.needsMyReport.map((e) => <EventCard key={e.id} e={e} badge="Tu reporte" />)
              )}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-mm-card">Esperando rival</h2>
            <div className="mt-3 space-y-3">
              {sections.waitingRival.length === 0 ? (
                <p className="text-sm text-white/60">No hay partidas esperando rival.</p>
              ) : (
                sections.waitingRival.map((e) => <EventCard key={e.id} e={e} badge="Pendiente rival" />)
              )}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-mm-card">En disputa</h2>
            <div className="mt-3 space-y-3">
              {sections.disputed.length === 0 ? (
                <p className="text-sm text-white/60">Sin disputas activas.</p>
              ) : (
                sections.disputed.map((e) => <EventCard key={e.id} e={e} badge="Disputa" />)
              )}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-mm-card">Proximas</h2>
            <div className="mt-3 space-y-3">
              {sections.upcoming.length === 0 ? (
                <p className="text-sm text-white/60">No tienes partidas proximas.</p>
              ) : (
                sections.upcoming.map((e) => <EventCard key={e.id} e={e} badge="Proxima" />)
              )}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-mm-card">Finalizadas</h2>
            <div className="mt-3 space-y-3">
              {sections.finished.length === 0 ? (
                <p className="text-sm text-white/60">Aun no hay partidas finalizadas.</p>
              ) : (
                sections.finished.map((e) => <EventCard key={e.id} e={e} badge="Finalizada" />)
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
