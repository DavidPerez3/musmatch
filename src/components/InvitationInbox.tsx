"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { eventPath } from "@/lib/paths";
type Invitation = {
  id: string;
  event_id: string;
  team: string;
  created_at: string;
  title?: string;
  starts_at?: string;
  available?: boolean;
};
export default function InvitationInbox() {
  const router = useRouter();
  const [items, setItems] = useState<Invitation[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("match_invitations")
      .select("id,event_id,team,created_at")
      .eq("invitee_id", user.id)
      .eq("status", "PENDING")
      .order("created_at", { ascending: false });
    if (error) {
      setMessage("No se pudieron cargar las invitaciones. Pulsa actualizar.");
      return;
    }
    if (!data?.length) {
      setItems([]);
      return;
    }
    const { data: events, error: evError } = await supabase
      .from("events")
      .select("id,title,starts_at,status,result_status")
      .in(
        "id",
        data.map((i) => i.event_id),
      );
    if (evError) {
      setMessage("No se pudieron cargar las partidas invitadas.");
      return;
    }
    setItems(
      data.map((i) => {
        const e = events?.find((e) => e.id === i.event_id);
        return {
          ...i,
          title: e?.title,
          starts_at: e?.starts_at,
          available:
            !!e &&
            ["OPEN", "FULL"].includes(e.status) &&
            !e.result_status &&
            new Date(e.starts_at).getTime() > Date.now(),
        };
      }),
    );
  }, []);
  useEffect(() => {
    void supabase.auth.getUser().then(() => load());
  }, [load]);
  async function respond(id: string, accept: boolean) {
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc("respond_match_invitation", {
      p_invitation_id: id,
      p_accept: accept,
    });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage(accept ? "Invitación aceptada." : "Invitación rechazada.");
    await load();
    if (accept) {
      const item = items.find((i) => i.id === id);
      if (item) router.push(eventPath(item.event_id));
    }
  }
  return (
    <section
      className="my-5 mm-panel rounded-2xl bg-white/5 p-4 ring-1 ring-white/10"
      aria-label="Invitaciones a partidas"
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <h2 className="text-xl font-semibold">Invitaciones a partidas</h2>
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Actualizar
        </button>
      </div>
      <p className="mt-2 text-sm text-white/60">
        Revisa las reglas antes de aceptar. Las invitaciones no reservan plaza.
      </p>
      {message && (
        <p role="status" className="mt-2 text-sm">
          {message}
        </p>
      )}
      {!items.length && (
        <p className="mt-3 text-white/60">Sin invitaciones pendientes.</p>
      )}
      <ul className="mt-3 space-y-3">
        {items.map((i) => (
          <li key={i.id} className="rounded-xl bg-white/5 p-3">
            <Link
              className="font-semibold underline"
              href={eventPath(i.event_id)}
            >
              {i.title || "Ver partida"}
            </Link>
            <p className="text-sm text-white/60">
              Equipo {i.team} ·{" "}
              {i.starts_at ? new Date(i.starts_at).toLocaleString() : ""}
              {!i.available ? " · Ya no admite incorporaciones" : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className="btn-primary"
                disabled={busy || !i.available}
                onClick={() => void respond(i.id, true)}
              >
                Aceptar invitación
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => void respond(i.id, false)}
              >
                Rechazar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
