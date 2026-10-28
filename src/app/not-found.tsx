import Link from "next/link";
import TableCards from "@/components/TableCards";
export default function NotFound() {
  return <main className="mm-page max-w-2xl">
    <div className="mm-home-hero mm-error-table">
      <TableCards /><div className="mm-hero-content">
        <p className="mm-eyebrow">404 · Fuera del mazo</p>
        <h1>Esta carta no está en la mesa</h1>
        <p className="mt-4 text-white/80">La página no existe o el enlace ha cambiado. Volvamos a repartir.</p>
      </div>
    </div>
    <div className="mt-6 flex flex-wrap gap-3">
      <Link className="btn-primary flex-1" href="/">Volver al inicio</Link>
      <Link className="btn-secondary flex-1" href="/?buscar=1#partidas">Buscar partidas</Link>
    </div>
  </main>;
}
