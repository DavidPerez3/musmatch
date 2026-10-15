"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password: pw });

    setLoading(false);
    if (error) setMsg(error.message);
    else {
      setMsg("✅ Contraseña actualizada. Ya puedes entrar.");
      router.push("/login");
    }
  }

  return (
    <main className="mm-page max-w-md">
      <div className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
        <h1 className="text-2xl font-bold text-mm-card">Cambiar contraseña</h1>
        <p className="mt-1 text-sm text-white/70">
          Escribe tu nueva contraseña.
        </p>

        <form onSubmit={updatePassword} className="mt-6 space-y-3">
          <input
            className="w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            type="password"
            placeholder="Nueva contraseña"
            autoComplete="new-password"
          />
          <button
            disabled={loading || pw.length < 6}
            className="w-full rounded-xl bg-mm-gold px-4 py-2 font-semibold text-mm-bg disabled:opacity-60"
          >
            Guardar
          </button>
        </form>

        {msg && <p className="mt-4 text-sm text-white/80">{msg}</p>}
      </div>
    </main>
  );
}