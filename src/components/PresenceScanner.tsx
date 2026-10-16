"use client";
import { useEffect, useRef, useState } from "react";

function cameraError(error: unknown) {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "No se ha concedido acceso a la cámara. Puedes permitirlo en los ajustes del navegador o usar el código manual.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No encontramos una cámara disponible. Usa el código manual.";
  if (name === "NotReadableError")
    return "La cámara está ocupada o no se puede abrir. Cierra otras aplicaciones o usa el código manual.";
  return "No hemos podido iniciar el escáner. Puedes usar el código manual.";
}

export default function PresenceScanner({
  onRead,
  onClose,
}: {
  onRead: (data: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onRead, onClose });
  useEffect(() => {
    callbacks.current = { onRead, onClose };
  }, [onRead, onClose]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(timeout);
      const active = stream;
      stream = null;
      active?.getTracks().forEach((track) => track.stop());
      if (video.current) video.current.srcObject = null;
    };
    const hide = () => {
      if (document.visibilityState === "hidden") {
        stop();
        callbacks.current.onClose();
      }
    };
    const leave = () => {
      stop();
      callbacks.current.onClose();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError(
            "Este navegador no permite acceder a la cámara. Abre MusMatch con HTTPS o usa el código manual.",
          );
          return;
        }
        const { default: decode } = await import("jsqr");
        if (cancelled) return;
        const acquired = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 640 },
            height: { ideal: 640 },
          },
          audio: false,
        });
        if (cancelled) {
          acquired.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = acquired;
        const element = video.current;
        if (!element) {
          stop();
          return;
        }
        element.srcObject = stream;
        await element.play();
        if (cancelled) return;
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas unavailable");
        timeout = setTimeout(() => {
          if (!cancelled) {
            stop();
            setError(
              "No se ha detectado ningún QR en un minuto. Puedes intentarlo de nuevo o usar el código manual.",
            );
          }
        }, 60000);
        const scan = () => {
          if (cancelled) return;
          try {
            if (
              element.readyState >= 2 &&
              element.videoWidth &&
              element.videoHeight
            ) {
              const scale = Math.min(
                640 / element.videoWidth,
                640 / element.videoHeight,
                1,
              );
              canvas.width = Math.max(
                1,
                Math.floor(element.videoWidth * scale),
              );
              canvas.height = Math.max(
                1,
                Math.floor(element.videoHeight * scale),
              );
              context.drawImage(element, 0, 0, canvas.width, canvas.height);
              const frame = context.getImageData(
                0,
                0,
                canvas.width,
                canvas.height,
              );
              const result = decode(frame.data, frame.width, frame.height, {
                inversionAttempts: "dontInvert",
              });
              if (result) {
                stop();
                callbacks.current.onRead(result.data);
                return;
              }
            }
            timer = setTimeout(scan, 250);
          } catch {
            stop();
            setError("No hemos podido leer la cámara. Usa el código manual.");
          }
        };
        scan();
      } catch (cause) {
        if (!cancelled) {
          stop();
          setError(cameraError(cause));
        }
      }
    }
    void start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
    };
  }, []);
  return (
    <section
      aria-label="Escáner de presencia"
      className="mt-3 rounded-xl border border-white/20 p-3"
    >
      {error ? (
        <p role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      ) : (
        <>
          <video
            ref={video}
            aria-label="Vista previa de la cámara"
            autoPlay
            playsInline
            muted
            className="aspect-square w-full rounded-lg bg-black object-contain"
          />
          <p role="status" className="mt-2 text-sm text-white/70">
            Apunta al QR de un rival. La imagen se procesa aquí y no se sube.
          </p>
        </>
      )}
      <button type="button" onClick={onClose} className="btn-secondary mt-3">
        Cerrar escáner
      </button>
    </section>
  );
}
