"use client";
import { useState, useSyncExternalStore } from "react";
import { assetPath, eventPath } from "@/lib/paths";
const subscribe = () => () => {};
const invitation = "¿Echamos un mus? Abre esta partida en MusMatch e inicia sesión para consultar las reglas y las plazas. El enlace no te inscribe.";
export default function ShareMatch({id}: {id:string}) {
  const origin = useSyncExternalStore(subscribe, () => window.location.origin, () => "");
  const url = origin ? `${origin}${assetPath(eventPath(id))}` : "";
  const [message, setMessage] = useState("");
  const [manual, setManual] = useState(false);
  async function copy() {
    setMessage("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setMessage("Enlace copiado. Quien lo reciba necesitará iniciar sesión y apuntarse si hay plaza.");
      setManual(false);
    } catch {
      setManual(true);
      setMessage("No se pudo copiar automáticamente. Selecciona y copia el enlace de abajo.");
    }
  }
  async function share() {
    if (!navigator.share) { await copy(); return; }
    setMessage("");
    try { await navigator.share({title:"MusMatch",text:invitation,url}); }
    catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setMessage("No se pudo compartir. Puedes copiar el enlace o enviarlo por WhatsApp.");
    }
  }
  return <section className="mm-share mt-4" aria-label="Compartir esta partida">
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-secondary w-auto! text-sm" disabled={!url} onClick={share}>Compartir partida</button>
      <button type="button" className="mm-text-link text-sm" disabled={!url} onClick={copy}>Copiar enlace</button>
      {url && <a className="mm-text-link text-sm" href={`https://wa.me/?text=${encodeURIComponent(`${invitation}\n${url}`)}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">WhatsApp<span className="sr-only"> (se abre en otra pestaña)</span></a>}
    </div>
    <p className="mt-2 text-xs text-white/70">Comparte solo el enlace. No incluye ubicación, título ni datos de jugadores.</p>
    <p role="status" className="text-sm text-mm-gold">{message}</p>
    {manual && <label className="mt-2 block text-sm">Enlace de la partida<input className="mm-input mt-1 w-full" value={url} readOnly onFocus={e=>e.currentTarget.select()} /></label>}
  </section>;
}
