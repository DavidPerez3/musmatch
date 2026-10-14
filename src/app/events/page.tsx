import { Suspense } from "react";
import EventDetail from "./EventDetail";
export default function EventsPage() {
  return <Suspense fallback={<p className="text-white/70">Cargando partida…</p>}><EventDetail /></Suspense>;
}
