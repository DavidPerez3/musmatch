"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { eventPath } from "@/lib/paths";
import MatchRulesCard from "./MatchRulesCard";
import type { MatchRules } from "@/lib/matchRules";
type Dispute = MatchRules & {
  id: string;
  title: string;
  match_type: string;
  result_team_a_winner: string | null;
  result_team_b_winner: string | null;
  result_team_a_score: string | null;
  result_team_b_score: string | null;
  result_team_a_submitted_at: string | null;
  result_team_b_submitted_at: string | null;
  result_resolution_reason: string | null;
  result_score: string | null;
  winner_team: string | null;
};
export default function DisputeReview({
  match,
  onResolved,
}: {
  match: Dispute;
  onResolved: () => Promise<void>;
}) {
  const [decision, setDecision] = useState("VOID");
  const [reason, setReason] = useState("");
  const [elo, setElo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [players, setPlayers] = useState<
    {
      user_id: string;
      team: string;
      attendance_status: string;
      username?: string;
    }[]
  >([]);
  const [proofs, setProofs] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await supabase
        .from("event_participants")
        .select("user_id,team,attendance_status")
        .eq("event_id", match.id);
      if (error) {
        if (alive) setMessage("No se pudieron cargar los participantes.");
        return;
      }
      const { data: p } = await supabase
        .from("profiles")
        .select("id,username")
        .in(
          "id",
          (data || []).map((x) => x.user_id),
        );
      if (alive)
        setPlayers(
          (data || []).map((x) => ({
            ...x,
            username: p?.find((p) => p.id === x.user_id)?.username,
          })),
        );
      const { data: overview } = await supabase
        .from("admin_event_presence_overview")
        .select("proofs_count")
        .eq("event_id", match.id)
        .maybeSingle();
      if (alive) setProofs(overview?.proofs_count ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [match.id]);
  async function resolve() {
    if (
      !confirm(
        `¿Registrar esta resolución${elo && decision !== "VOID" ? " y aplicar ELO" : ""}?`,
      )
    )
      return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc("review_match_dispute", {
      p_event_id: match.id,
      p_decision: decision,
      p_reason: reason,
      p_apply_elo: elo,
    });
    setBusy(false);
    if (error) setMessage(error.message);
    else await onResolved();
  }
  return (
    <article className="rounded-2xl bg-white/5 p-4 space-y-3 ring-1 ring-white/10">
      <Link href={eventPath(match.id)} className="font-semibold underline">
        {match.title}
      </Link>
      <MatchRulesCard rules={match} />
      <div className="grid gap-3 sm:grid-cols-2">
        {(["a", "b"] as const).map((t) => (
          <div className="rounded-xl bg-white/5 p-3" key={t}>
            <h3 className="font-semibold">Reporte {t.toUpperCase()}</h3>
            <p>
              Ganador: {match[`result_team_${t}_winner`] || "—"} · Marcador:{" "}
              {match[`result_team_${t}_score`] || "Sin reporte"}
            </p>
            <p className="text-xs text-white/60">
              {match[`result_team_${t}_submitted_at`]
                ? new Date(
                    match[`result_team_${t}_submitted_at`]!,
                  ).toLocaleString()
                : "Pendiente"}
            </p>
          </div>
        ))}
      </div>
      <p className="text-sm text-white/70">
        Motivo de disputa:{" "}
        {match.result_resolution_reason ||
          "Reportes incompatibles o revisión solicitada"}{" "}
        · Pruebas de presencia: {proofs ?? "No disponibles"}
      </p>
      <ul className="text-sm">
        {players.map((p) => (
          <li key={p.user_id}>
            @{p.username || "Sin nombre"} · equipo {p.team} ·{" "}
            {p.attendance_status === "CHECKED_IN"
              ? "Presencia validada"
              : "Sin presencia validada"}
          </li>
        ))}
      </ul>
      <label className="block">
        Decisión
        <select
          className="mm-input mt-1 w-full"
          value={decision}
          onChange={(e) => {
            setDecision(e.target.value);
            setElo(false);
          }}
        >
          <option value="VOID">Anular sin ganador ni ELO</option>
          {(["A", "B"] as const).map((t) => (
            <option
              key={t}
              value={t}
              disabled={
                match.rules_version === 1 &&
                ![
                  match.result_team_a_winner,
                  match.result_team_b_winner,
                ].includes(t)
              }
            >
              Gana equipo {t}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        Motivo de resolución (visible a participantes)
        <textarea
          className="mm-input mt-1 w-full"
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explica qué reportes y pruebas justifican la decisión"
        />
      </label>
      {decision !== "VOID" && match.match_type === "COMPETITIVE" && (
        <label className="flex gap-2 items-start">
          <input
            type="checkbox"
            checked={elo}
            onChange={(e) => setElo(e.target.checked)}
          />
          Aplicar ELO (requiere los cuatro check-ins)
        </label>
      )}
      {message && (
        <p role="alert" className="text-amber-200">
          {message}
        </p>
      )}
      <button
        className="btn-primary"
        disabled={busy || reason.trim().length < 10}
        onClick={() => void resolve()}
      >
        Registrar resolución
      </button>
    </article>
  );
}
