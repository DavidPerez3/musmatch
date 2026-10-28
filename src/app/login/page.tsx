import { Suspense } from "react";
import LoginForm from "./LoginForm";
export default function Page() { return <Suspense fallback={<p role="status">Cargando acceso…</p>}><LoginForm /></Suspense>; }
