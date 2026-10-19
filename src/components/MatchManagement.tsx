"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { PlaceMap } from "./MatchLocation";
type Location = {
  address: string;
  latitude: number | null;
  longitude: number | null;
  location_type: string;
  venue_id: string | null;
};
type Review = {
  id: string;
  decision: string;
  reason: string;
  applied_elo: boolean;
  created_at: string;
};
export default function MatchManagement({
  id,
  owner,
  active,
  onChange,
}: {
  id: string;
  owner: boolean;
  active: boolean;
  onChange: () => Promise<void>;
}) {
  const [location, setLocation] = useState<Location | null>(null);
  const [venue, setVenue] = useState<{
    name: string;
    status: string;
    conditions: string;
  } | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [friends, setFriends] = useState<{ id: string; username: string }[]>(
    [],
  );
  const [invites, setInvites] = useState<
    { id: string; invitee_id: string; team: string; status: string }[]
  >([]);
  const [friend, setFriend] = useState("");
  const [team, setTeam] = useState("B");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await supabase
        .from("match_locations")
        .select("*")
        .eq("event_id", id)
        .maybeSingle();
      if (!alive) return;
      if (error)
        setMessage(
          "No se pudieron cargar los detalles del lugar. Actualiza la partida.",
        );
      setLocation(data);
      if (data?.venue_id) {
        const { data: v } = await supabase
          .from("venues")
          .select("name,status,conditions")
          .eq("id", data.venue_id)
          .maybeSingle();
        if (alive) setVenue(v);
      }
      const { data: r } = await supabase
        .from("match_reviews")
        .select("*")
        .eq("event_id", id)
        .order("created_at", { ascending: false });
      if (alive) setReviews(r || []);
      if (owner) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const { data: f } = await supabase
          .from("friendships")
          .select("friend_id")
          .eq("user_id", user.id);
        if (f?.length) {
          const { data: p } = await supabase
            .from("profiles")
            .select("id,username")
            .in(
              "id",
              f.map((f) => f.friend_id),
            );
          if (alive) setFriends(p || []);
        }
        const { data: inv } = await supabase
          .from("match_invitations")
          .select("id,invitee_id,team,status")
          .eq("event_id", id);
        if (alive) setInvites(inv || []);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, owner]);
  async function invite() {
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc("invite_match_player", {
      p_event_id: id,
      p_invitee_id: friend,
      p_team: team,
    });
    setBusy(false);
    setMessage(
      error
        ? error.message
        : "Invitación enviada. Tu amigo puede responder en Mis partidas.",
    );
    if (!error) {
      const { data } = await supabase
        .from("match_invitations")
        .select("id,invitee_id,team,status")
        .eq("event_id", id);
      setInvites(data || []);
    }
  }
  async function cancel() {
    if (!confirm("¿Cancelar la partida para todos los participantes?")) return;
    setBusy(true);
    const { error } = await supabase.rpc("cancel_match", {
      p_event_id: id,
      p_reason: reason,
    });
    setBusy(false);
    if (error) setMessage(error.message);
    else await onChange();
  }
  return (
    <section className="mt-5 space-y-3 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
      <h2 className="font-semibold">Lugar y organización</h2>
      {location ? (
        <>
          <p className="break-words">{location.address}</p>
          {location.location_type === "PRIVATE_LOCATION" ? (
            <p className="text-sm text-white/60">
              Dirección privada: visible solo para organizador, participantes y
              administración.
            </p>
          ) : (
            <>
              <p className="text-sm text-white/60">
                {venue?.status === "COLLABORATOR"
                  ? "Local colaborador verificado"
                  : "Establecimiento o punto sin colaboración confirmada"}
                . La partida no reserva mesa.
              </p>
              {venue?.conditions && (
                <p className="text-sm">{venue.conditions}</p>
              )}
              {location.latitude != null && location.longitude != null && (
                <PlaceMap
                  latitude={location.latitude}
                  longitude={location.longitude}
                />
              )}
            </>
          )}
        </>
      ) : (
        <p className="text-sm text-white/60">
          Si el lugar es privado, la dirección exacta estará disponible al
          apuntarte.
        </p>
      )}
      {reviews.map((r) => (
        <div key={r.id} className="rounded-xl bg-white/5 p-3">
          <p className="font-semibold">
            {r.decision === "VOID"
              ? "Partida anulada"
              : `Revisión: gana ${r.decision}`}{" "}
            · {r.applied_elo ? "con ELO" : "sin ELO"}
          </p>
          <p className="whitespace-pre-wrap break-words">{r.reason}</p>
          <p className="text-xs text-white/60">
            {new Date(r.created_at).toLocaleString()}
          </p>
        </div>
      ))}
      {owner && active && (
        <details>
          <summary className="cursor-pointer font-medium">
            Gestionar partida
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-sm text-white/60">
              Invita a un amigo. No se reserva plaza y debe aceptar antes del
              inicio.
            </p>
            <label className="block">
              Amigo
              <select
                className="mm-input w-full"
                value={friend}
                onChange={(e) => setFriend(e.target.value)}
              >
                <option value="">Seleccionar amigo</option>
                {friends.map((f) => (
                  <option value={f.id} key={f.id}>
                    @{f.username}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Equipo
              <select
                className="mm-input w-full"
                value={team}
                onChange={(e) => setTeam(e.target.value)}
              >
                <option value="A">A</option>
                <option value="B">B</option>
              </select>
            </label>
            <button
              className="btn-secondary"
              disabled={busy || !friend}
              onClick={() => void invite()}
            >
              Enviar invitación
            </button>
            {invites.map((i) => (
              <p className="text-sm text-white/70" key={i.id}>
                @
                {friends.find((f) => f.id === i.invitee_id)?.username ||
                  "Jugador"}{" "}
                · {i.team} ·{" "}
                {{
                  PENDING: "Pendiente",
                  ACCEPTED: "Aceptada",
                  DECLINED: "Rechazada",
                  CANCELLED: "Cancelada",
                }[i.status] || i.status}
              </p>
            ))}
            <label className="block">
              Motivo de cancelación
              <textarea
                className="mm-input mt-1 w-full"
                value={reason}
                minLength={5}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              className="btn-secondary"
              disabled={busy || reason.trim().length < 5}
              onClick={() => void cancel()}
            >
              Cancelar partida
            </button>
            <p className="text-xs text-white/60">
              Para cambiar fecha, lugar o reglas, cancela y crea otra partida:
              los jugadores deben aceptar las nuevas condiciones.
            </p>
          </div>
        </details>
      )}
      {message && (
        <p role="status" className="text-sm text-amber-200">
          {message}
        </p>
      )}
    </section>
  );
}
