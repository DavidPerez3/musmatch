import { Suspense } from "react";
import Simulator from "@/components/Simulator";
export default function SimulatorPage() {
  return (
    <Suspense fallback={<p className="mm-page">Cargando simulador…</p>}>
      <Simulator />
    </Suspense>
  );
}
