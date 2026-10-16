"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { readPresenceQr } from "@/lib/presenceQr";
import PresenceQr from "./PresenceQr";
import PresenceScanner from "./PresenceScanner";

type TokenStatus = {
  token: string | null;
  expires_at: string | null;
  next_refresh_at: string | null;
};
const EMPTY: TokenStatus = {
  token: null,
  expires_at: null,
  next_refresh_at: null,
};
const messages: Record<string, string> = {
  TOKEN_NOT_FOUND: "Código no encontrado para esta partida.",
  TOKEN_OWN_USER: "No puedes validar tu propio código.",
  TOKEN_EXPIRED: "El código ha caducado. Pide al rival que lo renueve.",
  TOKEN_ALREADY_USED: "Ese código ya fue utilizado. Pide uno nuevo.",
  TOKEN_OWNER_NOT_ACTIVE: "El jugador ya no está activo en la partida.",
  TOKEN_SAME_TEAM: "Escanea a un jugador del equipo rival.",
};
function operationError(error: { message: string }) {
  const known: Record<string, string> = {
    "No autenticado": "Vuelve a iniciar sesión para validar la presencia.",
    "Partida no encontrada": "La partida ya no está disponible.",
    "La partida ya esta cerrada":
      "La partida está cerrada para nuevas validaciones.",
    "Solo participantes con equipo pueden generar codigo":
      "Debes tener una plaza y un equipo en esta partida.",
    "Solo participantes con equipo pueden validar codigo":
      "Debes tener una plaza y un equipo en esta partida.",
    "La presencia requiere dos equipos completos":
      "La presencia requiere dos equipos completos.",
    "Espera treinta segundos antes de generar otro código":
      "Espera treinta segundos antes de generar otro código.",
  };
  const message = known[error.message];
  return typeof message === "string"
    ? message
    : "No se ha podido completar la operación. Comprueba tu conexión y vuelve a intentarlo.";
}
export default function PresenceCheckIn({
  eventId,
  enabled,
  onValidated,
}: {
  eventId: string;
  enabled: boolean;
  onValidated: () => Promise<void>;
}) {
  const [status, setStatus] = useState<TokenStatus>(EMPTY);
  const [code, setCode] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const sending = useRef(false);
  const revision = useRef(0);
  const manual = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const refresh = async () => {
      if (sending.current) return;
      const current = revision.current;
      const { data, error } = await supabase.rpc(
        "get_my_presence_token_status",
        { p_event_id: eventId },
      );
      if (!cancelled && !error && current === revision.current)
        setStatus((data as TokenStatus) || EMPTY);
    };
    void refresh();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const focus = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", focus);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [eventId, enabled]);
  const expires = Math.max(
    0,
    Math.ceil(
      ((status.expires_at ? Date.parse(status.expires_at) : 0) - now) / 1000,
    ),
  );
  const cooldown = Math.max(
    0,
    Math.ceil(
      ((status.next_refresh_at ? Date.parse(status.next_refresh_at) : 0) -
        now) /
        1000,
    ),
  );
  const active = enabled && !!status.token && expires > 0;
  const submit = useCallback(
    async (token: string) => {
      if (sending.current || !enabled) return;
      sending.current = true;
      setBusy(true);
      setNotice(null);
      try {
        const { data, error } = await supabase.rpc("submit_presence_token", {
          p_event_id: eventId,
          p_token: token,
        });
        if (error) {
          setNotice({ text: operationError(error), error: true });
          return;
        }
        if (data === "PROOF_ACCEPTED") {
          setNotice({
            text: "Código rival validado. Tu presencia queda completa cuando un rival también valida tu código.",
            error: false,
          });
          setCode("");
          await onValidated();
        } else
          setNotice({
            text:
              messages[String(data)] ||
              "No se ha podido validar el código. Inténtalo de nuevo.",
            error: true,
          });
      } catch {
        setNotice({
          text: "No se ha podido conectar. Comprueba tu conexión e inténtalo de nuevo.",
          error: true,
        });
      } finally {
        sending.current = false;
        setBusy(false);
      }
    },
    [eventId, enabled, onValidated],
  );
  const closeScanner = useCallback(() => {
    setScanning(false);
    manual.current?.focus();
  }, []);
  const read = useCallback(
    (raw: string) => {
      setScanning(false);
      try {
        const token = readPresenceQr(raw, eventId);
        void submit(token);
      } catch (error) {
        setNotice({
          text: error instanceof Error ? error.message : "QR no válido.",
          error: true,
        });
      }
    },
    [eventId, submit],
  );
  async function generate() {
    if (sending.current || !enabled) return;
    sending.current = true;
    revision.current++;
    setBusy(true);
    setNotice(null);
    try {
      const { data, error } = await supabase.rpc("create_presence_token", {
        p_event_id: eventId,
      });
      if (error) setNotice({ text: operationError(error), error: true });
      else {
        setNow(Date.now());
        setStatus((data as TokenStatus) || EMPTY);
      }
    } catch {
      setNotice({
        text: "No se ha podido generar el código. Comprueba tu conexión.",
        error: true,
      });
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  if (!enabled)
    return (
      <p className="mt-4 rounded-xl bg-white/5 p-4 text-sm text-white/70">
        La presencia se habilita al completar los dos equipos de dos jugadores.
      </p>
    );
  return (
    <div className="mt-4">
      <p className="mb-3 text-sm text-white/70">
        Muestra tu QR y escanea el de un rival. Cada jugador debe hacer ambas
        cosas. Los códigos duran dos minutos y solo se pueden usar una vez.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <section
          aria-label="Mi presencia"
          className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10"
        >
          <h3 className="font-semibold">Mi QR y código</h3>
          {active ? (
            <>
              <PresenceQr eventId={eventId} token={status.token!} />
              <p
                aria-label="Mi código de presencia"
                className="text-center text-xl font-bold tracking-widest"
              >
                {status.token}
              </p>
              <p className="mt-2 text-center text-xs text-white/70">
                Caduca en {Math.floor(expires / 60)}m {expires % 60}s
              </p>
            </>
          ) : (
            <p role="status" className="mt-3 text-sm text-white/70">
              {status.token
                ? "Tu código ha caducado. Genera uno nuevo."
                : "Genera tu QR para que lo escanee un rival."}
            </p>
          )}
          <button
            type="button"
            disabled={busy || scanning || cooldown > 0}
            onClick={generate}
            className="btn-secondary mt-3"
          >
            {cooldown > 0
              ? `Renovar en ${cooldown}s`
              : active
                ? "Renovar QR y código"
                : "Generar QR y código"}
          </button>
        </section>
        <section
          aria-label="Validar rival"
          className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10"
        >
          <h3 className="font-semibold">Validar a un rival</h3>
          {!scanning && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setNotice(null);
                setScanning(true);
              }}
              className="btn-primary mt-3"
            >
              Escanear rival
            </button>
          )}
          {scanning && <PresenceScanner onRead={read} onClose={closeScanner} />}
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^[A-Z0-9]{6}$/.test(code)) void submit(code);
            }}
          >
            <label
              htmlFor="rival-presence-code"
              className="text-sm text-white/70"
            >
              O introduce su código manual
            </label>
            <input
              ref={manual}
              id="rival-presence-code"
              aria-label="Código de presencia rival"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
              pattern="[A-Za-z0-9]{6}"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
              }
              placeholder="AB3K9Q"
              className="mt-2 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2"
            />
            <button
              disabled={busy || scanning || !/^[A-Z0-9]{6}$/.test(code)}
              className="btn-secondary mt-3"
            >
              {busy ? "Validando…" : "Validar código"}
            </button>
          </form>
        </section>
      </div>
      {notice && (
        <p
          role={notice.error ? "alert" : "status"}
          className={`mt-3 rounded-xl p-3 text-sm ${notice.error ? "bg-red-500/10 text-red-200" : "bg-green-500/10 text-green-200"}`}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
