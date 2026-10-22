"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { eventPath } from "@/lib/paths";
import {
  activatePush,
  currentPushSubscription,
  needsInstalledIos,
  removeCurrentPush,
  supportsPush,
} from "@/lib/push";
type Notice = {
  id: string;
  event_id: string | null;
  category: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};
type Preferences = {
  invitations: boolean;
  matches: boolean;
  results: boolean;
  reminders: boolean;
  friends: boolean;
  push_enabled: boolean;
};
type Device = { id: string; device_name: string; updated_at: string };
const defaults: Preferences = {
  invitations: true,
  matches: true,
  results: true,
  reminders: true,
  friends: true,
  push_enabled: false,
};
const categories: [keyof Omit<Preferences, "push_enabled">, string][] = [
  ["invitations", "Invitaciones"],
  ["matches", "Cambios y cancelaciones de partidas"],
  ["results", "Resultados y disputas"],
  ["reminders", "Recordatorio una hora antes"],
  ["friends", "Solicitudes de amistad"],
];
export default function Notifications() {
  const [uid, setUid] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [items, setItems] = useState<Notice[]>([]),
    [prefs, setPrefs] = useState<Preferences>(defaults),
    [devices, setDevices] = useState<Device[]>([]),
    [current, setCurrent] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [supported, setSupported] = useState(false),
    [ios, setIos] = useState(false),
    [blocked, setBlocked] = useState(false),
    [limit, setLimit] = useState(30);
  const alive = useRef(true),
    revision = useRef(0),
    lock = useRef(false),
    account = useRef<string | null>(null);
  const load = useCallback(async (userId: string, max: number) => {
    const rev = ++revision.current;
    const [notices, preferences, registered] = await Promise.all([
      supabase
        .from("notifications")
        .select("id,event_id,category,title,body,created_at,read_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(max),
      supabase
        .from("notification_preferences")
        .select("invitations,matches,results,reminders,friends,push_enabled")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.rpc("list_push_devices"),
    ]);
    if (
      !alive.current ||
      rev !== revision.current ||
      account.current !== userId
    )
      return;
    if (notices.error || preferences.error || registered.error) {
      setMessage(
        "No se pudieron cargar los avisos. Pulsa Actualizar para reintentarlo.",
      );
      return;
    }
    setItems(notices.data || []);
    setPrefs({ ...defaults, ...preferences.data });
    setDevices(registered.data || []);
    try {
      const sub = await currentPushSubscription();
      const result = sub
        ? await supabase.rpc("get_push_subscription_status", {
            p_endpoint: sub.endpoint,
          })
        : null;
      if (alive.current && rev === revision.current)
        setCurrent(result?.data || null);
    } catch {
      if (alive.current && rev === revision.current) setCurrent(null);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    setSupported(supportsPush());
    setIos(needsInstalledIos());
    setBlocked(
      "Notification" in window && Notification.permission === "denied",
    );
    const update = (id: string | null) => {
      account.current = id;
      ++revision.current;
      setUid(id);
      setReady(true);
      setItems([]);
      setDevices([]);
      setCurrent(null);
      if (id) void load(id, 30);
    };
    void supabase.auth.getSession().then(({ data }) => {
      if (alive.current) update(data.session?.user.id || null);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      if (alive.current) update(session?.user.id || null);
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
  useEffect(() => {
    if (!uid) return;
    const refresh = () => {
      if (document.visibilityState !== "hidden" && !lock.current)
        void load(uid, limit);
    };
    const timer = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [uid, limit, load]);
  async function run(action: () => Promise<string | void>) {
    if (lock.current || !uid) return;
    const actorId = uid;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const text = await action();
      if (alive.current && account.current === actorId) {
        setMessage(text || "Cambios guardados.");
        await load(uid, limit);
        window.dispatchEvent(new Event("musmatch-notifications"));
      }
    } catch (e) {
      if (alive.current && account.current === actorId)
        setMessage(
          e instanceof Error ? e.message : "No se pudo completar la operación.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function mark(ids: string[] | null) {
    const { error } = await supabase.rpc("mark_notifications_read", {
      p_ids: ids,
    });
    if (error) throw new Error(error.message);
  }
  function enable() {
    if (lock.current || !supported || ios) return;
    // Permission must be requested synchronously from the user's click, also on iOS.
    const permission = Notification.requestPermission();
    void run(async () => {
      await activatePush(permission);
      setBlocked(false);
      return "Notificaciones activadas en este dispositivo. Puedes enviar una prueba.";
    });
  }
  if (!ready)
    return (
      <main className="mm-page">
        <p role="status">Cargando avisos…</p>
      </main>
    );
  if (!uid)
    return (
      <main className="mm-page">
        <h1>Avisos</h1>
        <p className="my-4">
          Inicia sesión para ver tus avisos y configurar las notificaciones.
        </p>
        <Link href="/login" className="btn-primary">
          Iniciar sesión
        </Link>
      </main>
    );
  return (
    <main className="mm-page mx-auto max-w-3xl">
      <h1 className="font-bold">Avisos y notificaciones</h1>
      <p className="mt-2 text-sm text-white/70">
        Tus novedades de MusMatch, sin incluir partidas del simulador. Los
        avisos se conservan durante 90 días.
      </p>
      {message && (
        <p role="status" className="my-4 rounded-xl bg-white/10 p-4">
          {message}
        </p>
      )}
      <section
        className="mt-5 mm-panel rounded-2xl bg-white/5 p-4 ring-1 ring-white/10"
        aria-label="Notificaciones push"
      >
        <h2 className="text-xl font-semibold">
          Notificaciones en tus dispositivos
        </h2>
        <p className="mt-2 text-sm text-white/70">
          Recibe avisos con la app cerrada. Se activan solo si tú lo decides; la
          pantalla bloqueada no muestra direcciones ni marcadores.
        </p>
        {!supported && (
          <p className="mt-3">
            Este navegador no permite notificaciones push. Tus avisos seguirán
            disponibles aquí.
          </p>
        )}
        {ios && (
          <p className="mt-3">
            En iPhone o iPad, añade MusMatch a la pantalla de inicio desde
            Compartir y ábrela desde su icono para activar las notificaciones.
          </p>
        )}
        {blocked && (
          <p className="mt-3">
            El permiso está bloqueado. Permite las notificaciones en los ajustes
            de este sitio y vuelve a abrir MusMatch.
          </p>
        )}
        <p className="mt-3 font-semibold">
          {current
            ? "Este dispositivo está registrado."
            : "Este dispositivo no está registrado."}
          {!prefs.push_enabled && devices.length > 0
            ? " Los envíos están pausados."
            : ""}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {supported && !ios && (!current || !prefs.push_enabled) && (
            <button
              className="btn-primary"
              disabled={busy || blocked}
              onClick={enable}
            >
              Activar en este dispositivo
            </button>
          )}
          {current && (
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await removeCurrentPush();
                  return "Notificaciones desactivadas en este dispositivo.";
                })
              }
            >
              Desactivar en este dispositivo
            </button>
          )}
          {current && prefs.push_enabled && (
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const { error } = await supabase.rpc(
                    "request_test_notification",
                  );
                  if (error) throw new Error(error.message);
                  return "Prueba en cola. Puede tardar unos dos minutos; puedes cerrar la app.";
                })
              }
            >
              Enviar notificación de prueba
            </button>
          )}
          {devices.length > 0 && (
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const { error } = await supabase.rpc(
                    "save_notification_preferences",
                    { p_preferences: { push_enabled: !prefs.push_enabled } },
                  );
                  if (error) throw new Error(error.message);
                  return prefs.push_enabled
                    ? "Envíos pausados en todos tus dispositivos."
                    : "Envíos reanudados.";
                })
              }
            >
              {prefs.push_enabled
                ? "Pausar push en todos"
                : "Reanudar push en todos"}
            </button>
          )}
        </div>
        {devices.length > 0 && (
          <ul className="mt-4 space-y-2" aria-label="Dispositivos registrados">
            {devices.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/5 p-3"
              >
                <span>
                  {d.device_name}
                  {d.id === current ? " · Este dispositivo" : ""}
                  <span className="block text-xs text-white/60">
                    Última actividad:{" "}
                    {new Date(d.updated_at).toLocaleDateString("es-ES")}
                  </span>
                </span>
                <button
                  className="btn-secondary w-auto"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (d.id === current) await removeCurrentPush();
                      else {
                        const { error } = await supabase.rpc(
                          "remove_push_subscription",
                          { p_id: d.id },
                        );
                        if (error) throw new Error(error.message);
                      }
                      return "Dispositivo eliminado.";
                    })
                  }
                >
                  Eliminar<span className="sr-only"> {d.device_name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section
        className="mt-5 mm-panel rounded-2xl bg-white/5 p-4 ring-1 ring-white/10"
        aria-label="Preferencias de avisos"
      >
        <h2 className="text-xl font-semibold">Qué quieres recibir</h2>
        <p className="mt-2 text-sm text-white/70">
          Estas preferencias se aplican a nuevos avisos y a los envíos push
          pendientes. Los avisos anteriores se mantienen.
        </p>
        <div className="mt-3 grid gap-1">
          {categories.map(([key, label]) => (
            <label key={key} className="flex min-h-12 items-center gap-3">
              <input
                type="checkbox"
                checked={prefs[key]}
                disabled={busy}
                onChange={(e) => {
                  const value = e.target.checked;
                  const previous = prefs[key];
                  setPrefs((p) => ({ ...p, [key]: value }));
                  void run(async () => {
                    const { error } = await supabase.rpc(
                      "save_notification_preferences",
                      { p_preferences: { [key]: value } },
                    );
                    if (error) {
                      setPrefs((p) => ({ ...p, [key]: previous }));
                      throw new Error(error.message);
                    }
                  });
                }}
              />
              {label}
            </label>
          ))}
        </div>
      </section>
      <section className="mt-5" aria-label="Bandeja de avisos">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Tus avisos</h2>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary w-auto"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await load(uid, limit);
                  return "Avisos actualizados.";
                })
              }
            >
              Actualizar
            </button>
            <button
              className="btn-secondary w-auto"
              disabled={busy || !items.some((n) => !n.read_at)}
              onClick={() => void run(() => mark(null))}
            >
              Marcar todos como leídos
            </button>
          </div>
        </div>
        {!items.length && (
          <p className="mm-empty mt-4">No tienes avisos por ahora.</p>
        )}
        <ul className="mt-4 space-y-3">
          {items.map((n) => (
            <li
              key={n.id}
              className={`rounded-2xl border p-4 ${n.read_at ? "border-white/10 bg-white/5" : "border-mm-gold/60 bg-mm-gold/10"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">
                  {!n.read_at && (
                    <span className="mr-2 text-xs text-mm-gold">Sin leer </span>
                  )}
                  {n.title}
                </h3>
                <time className="text-xs text-white/60" dateTime={n.created_at}>
                  {new Date(n.created_at).toLocaleString("es-ES")}
                </time>
              </div>
              <p className="my-2 text-sm text-white/80">{n.body}</p>
              <div className="flex flex-wrap gap-2">
                <Link
                  className="btn-secondary w-auto"
                  href={
                    n.category === "invitations"
                      ? "/my-matches"
                      : n.event_id
                        ? eventPath(n.event_id)
                        : n.category === "friends"
                          ? "/profile"
                          : "/notifications"
                  }
                  onClick={() => {
                    if (!n.read_at) void run(() => mark([n.id]));
                  }}
                >
                  {" "}
                  {n.category === "invitations"
                    ? "Ver invitaciones"
                    : n.event_id
                      ? "Ver partida"
                      : n.category === "friends"
                        ? "Ver amistades"
                        : "Ver configuración"}
                </Link>
                {!n.read_at && (
                  <button
                    className="btn-secondary w-auto"
                    disabled={busy}
                    onClick={() => void run(() => mark([n.id]))}
                  >
                    Marcar como leído
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {items.length >= limit && (
          <button
            className="btn-secondary mt-4"
            disabled={busy || limit >= 300}
            onClick={() => {
              const more = limit + 30;
              setLimit(more);
              void run(() => load(uid, more));
            }}
          >
            Cargar más avisos
          </button>
        )}
      </section>
    </main>
  );
}
