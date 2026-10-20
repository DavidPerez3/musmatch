"use client";
import { assetPath } from "@/lib/paths";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}
export default function PwaRegister() {
  const offline = !useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null),
    [dismissed, setDismissed] = useState(false),
    [applying, setApplying] = useState(false),
    [message, setMessage] = useState("");
  const registration = useRef<ServiceWorkerRegistration | null>(null),
    dirty = useRef(false),
    requested = useRef(false);
  useEffect(() => {
    let live = true,
      lastCheck = 0,
      hadController =
        "serviceWorker" in navigator && !!navigator.serviceWorker.controller;
    const removers: (() => void)[] = [];
    let noticeTimer: ReturnType<typeof setTimeout> | undefined,
      applyTimer: ReturnType<typeof setTimeout> | undefined;
    function notice(text: string) {
      if (!live) return;
      setMessage(text);
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        if (live) setMessage("");
      }, 9000);
    }
    function connect() {
      if (navigator.onLine) {
        notice(
          "Conexión recuperada. Puedes volver a consultar tus partidas; las acciones fallidas no se reenvían solas.",
        );
        void check();
      }
    }
    function changed(event: Event) {
      const el = event.target;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      )
        dirty.current = true;
    }
    function showWorker(reg: ServiceWorkerRegistration) {
      if (live && reg.waiting && navigator.serviceWorker.controller) {
        setWaiting(reg.waiting);
      }
    }
    async function check(manual = false) {
      if (!navigator.onLine) {
        if (manual) notice("Conéctate a internet para buscar actualizaciones.");
        return;
      }
      const reg = registration.current;
      if (!reg) {
        if (manual)
          notice(
            "La actualización automática no está disponible en este navegador.",
          );
        return;
      }
      if (!manual && Date.now() - lastCheck < 60000) return;
      lastCheck = Date.now();
      try {
        await reg.update();
        if (!live) return;
        showWorker(reg);
        if (manual) {
          setDismissed(false);
          if (!reg.waiting && !reg.installing) notice("MusMatch está al día.");
        }
      } catch {
        if (manual)
          notice("No se pudo comprobar la actualización. Inténtalo más tarde.");
      }
    }
    function manual() {
      void check(true);
    }
    function visible() {
      if (document.visibilityState === "visible") void check();
    }
    function controllerChanged() {
      if (!hadController) {
        hadController = true;
        return;
      }
      if (requested.current) {
        requested.current = false;
        clearTimeout(applyTimer);
        window.location.reload();
      } else if (live) {
        setWaiting(null);
        notice(
          "Hay una nueva versión activa. La próxima vez que recargues usarás la versión actualizada.",
        );
      }
    }
    function applyStarted() {
      clearTimeout(applyTimer);
      applyTimer = setTimeout(() => {
        if (live && requested.current) {
          requested.current = false;
          setApplying(false);
          notice(
            "La actualización no ha terminado. Puedes volver a intentarlo.",
          );
        }
      }, 15000);
    }
    window.addEventListener("online", connect);
    window.addEventListener("offline", connect);
    window.addEventListener("musmatch-check-update", manual);
    window.addEventListener("musmatch-update-started", applyStarted);
    document.addEventListener("input", changed, true);
    document.addEventListener("change", changed, true);
    document.addEventListener("visibilitychange", visible);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        controllerChanged,
      );
      void navigator.serviceWorker
        .register(assetPath("/sw.js"), {
          scope: assetPath("/"),
          updateViaCache: "none",
        })
        .then((reg) => {
          if (!live) return;
          registration.current = reg;
          showWorker(reg);
          function track() {
            const worker = reg.installing;
            if (!worker) return;
            const state = () => {
              if (!live) return;
              if (worker.state === "installed") showWorker(reg);
            };
            worker.addEventListener("statechange", state);
            removers.push(() =>
              worker.removeEventListener("statechange", state),
            );
          }
          reg.addEventListener("updatefound", track);
          removers.push(() => reg.removeEventListener("updatefound", track));
          track();
        })
        .catch(() => {});
    }
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, 15 * 60000);
    return () => {
      live = false;
      registration.current = null;
      clearInterval(timer);
      clearTimeout(noticeTimer);
      clearTimeout(applyTimer);
      removers.forEach((remove) => remove());
      window.removeEventListener("online", connect);
      window.removeEventListener("offline", connect);
      window.removeEventListener("musmatch-check-update", manual);
      window.removeEventListener("musmatch-update-started", applyStarted);
      document.removeEventListener("input", changed, true);
      document.removeEventListener("change", changed, true);
      document.removeEventListener("visibilitychange", visible);
      if ("serviceWorker" in navigator)
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          controllerChanged,
        );
    };
  }, []);
  function apply() {
    if (!waiting || offline || applying) return;
    if (
      dirty.current &&
      !window.confirm(
        "Puede haber cambios sin guardar en esta pantalla. ¿Quieres actualizar y recargar de todas formas?",
      )
    )
      return;
    requested.current = true;
    setApplying(true);
    window.dispatchEvent(new Event("musmatch-update-started"));
    try {
      waiting.postMessage({ type: "MUSMATCH_SKIP_WAITING" });
    } catch {
      requested.current = false;
      setApplying(false);
      setMessage(
        "No se pudo iniciar la actualización. Recarga cuando hayas guardado tus cambios.",
      );
    }
  }
  if (!offline && (!waiting || dismissed) && !message) return null;
  return (
    <aside className="mm-pwa-status" aria-label="Estado de la aplicación">
      {offline && (
        <div role="status" className="mm-pwa-notice">
          <strong>Sin conexión</strong>
          <p>
            Puedes seguir en esta pantalla. Para consultar o guardar partidas
            necesitas internet. No se enviarán acciones automáticamente al
            reconectar.
          </p>
        </div>
      )}
      {waiting && !dismissed && (
        <div className="mm-pwa-notice">
          <p role="status">
            <strong>Nueva versión disponible</strong>
          </p>
          <p>
            Se recargará esta pantalla. Guarda tus cambios antes de actualizar.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="btn-primary w-auto"
              disabled={offline || applying}
              onClick={apply}
            >
              {applying ? "Actualizando…" : "Actualizar y recargar"}
            </button>
            <button
              className="btn-secondary w-auto"
              disabled={applying}
              onClick={() => setDismissed(true)}
            >
              Más tarde
            </button>
          </div>
        </div>
      )}
      {message && (
        <div className="mm-pwa-notice flex items-start gap-3">
          <p role="status" className="flex-1">
            {message}
          </p>
          <button
            className="min-h-11 min-w-11 rounded-lg border border-white/20"
            aria-label="Cerrar mensaje de la aplicación"
            onClick={() => setMessage("")}
          >
            ×
          </button>
        </div>
      )}
    </aside>
  );
}
