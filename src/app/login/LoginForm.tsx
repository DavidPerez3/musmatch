"use client";

import { assetPath } from "@/lib/paths";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { safeReturnPath, rememberAuthReturn } from "@/lib/authReturn";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

function Eye({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-white/70">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {open && <path d="m3 3 18 18" />}
    </svg>
  );
}

export default function LoginPage() {
  const search = useSearchParams();
  const router = useRouter();
  const next = safeReturnPath(search.get("next"));
  const [tab, setTab] = useState<"login" | "register">(search.get("tab") === "register" ? "register" : "login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");

  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    if (!email || !password) return false;
    if (tab === "register" && username.trim().length < 3) return false;
    return true;
  }, [email, password, username, tab]);

  async function signInWithGoogle() {
    setMsg(null);
    setLoading(true);

    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}${assetPath("/")}`
        : undefined;

    rememberAuthReturn(next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    setLoading(false);
    if (error) setMsg(error.message);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);
    if (error) setMsg(error.message);
    else if (next) router.replace(next);
    else setMsg("✅ Sesión iniciada. Ya puedes volver.");
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    // 1) Crear usuario (email+password)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // Puedes activar confirmación por email en Supabase si quieres
      options: {
        data: { username }, // queda en user_metadata (útil), pero lo guardaremos también en profiles
      },
    });

    if (error) {
      setLoading(false);
      setMsg(error.message);
      return;
    }

    // 2) Guardar username en profiles (si ya existe fila por trigger, hacemos update)
    const userId = data.user?.id;
    if (userId) {
      const { error: pErr } = await supabase
        .from("profiles")
        .update({ username: username.trim() })
        .eq("id", userId);

      if (pErr) {
        setLoading(false);
        setMsg(
          pErr.message.includes("duplicate key")
            ? "Ese username ya existe. Prueba otro."
            : pErr.message
        );
        return;
      }
    }

    setLoading(false);
    if (data.session && next) { router.replace(next); return; }
    setMsg("✅ Cuenta creada. Ya puedes iniciar sesión.");
    setTab("login");
  }

  async function forgotPassword() {
    setMsg(null);
    if (!email) {
      setMsg("Escribe tu email primero.");
      return;
    }
    setLoading(true);

    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}${assetPath("/reset-password/")}`
        : undefined;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    setLoading(false);
    setMsg(error ? error.message : "Te he enviado un email para resetear la contraseña.");
  }

  return (
    <main className="mm-page mm-auth-page max-w-md">
      <div className="mm-panel rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
        <p className="mm-eyebrow">El mus empieza aquí</p>
        <h1 className="text-2xl font-bold text-mm-card">MusMatch</h1>
        <p className="mt-1 text-sm text-white/70">
          {tab === "login" ? "Entra a tu cuenta" : "Crea tu cuenta"}
        </p>

        {/* Tabs */}
        <div className="mt-5 flex rounded-xl bg-white/5 p-1 ring-1 ring-white/10">
          <button
            onClick={() => setTab("login")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
              tab === "login" ? "bg-mm-gold text-mm-bg" : "text-white/70 hover:text-white"
            }`}
          >
            Login
          </button>
          <button
            onClick={() => setTab("register")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
              tab === "register" ? "bg-mm-gold text-mm-bg" : "text-white/70 hover:text-white"
            }`}
          >
            Registro
          </button>
        </div>

        {/* Google */}
        <button
          disabled={loading}
          onClick={signInWithGoogle}
          className="mm-google-button mt-4"
        >
          <Image src={assetPath("/icons/google-g.png")} alt="" width={20} height={20} />
          <span>Continuar con Google</span>
        </button>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-xs text-white/50">o</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        {/* Forms */}
        <form onSubmit={tab === "login" ? handleLogin : handleRegister} className="space-y-3">
          {tab === "register" && (
            <div>
              <label htmlFor="field-1" className="text-sm text-white/70">Username</label>
              <input id="field-1"
                className="mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <p className="mt-1 text-xs text-white/50">Mínimo 3 caracteres, único.</p>
            </div>
          )}

          <div>
            <label htmlFor="field-2" className="text-sm text-white/70">Email</label>
            <input id="field-2"
              className="mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tuemail@gmail.com"
              type="email"
              autoComplete="email"
            />
          </div>

          <div>
            <label htmlFor="password" className="text-sm text-white/70">Contraseña</label>
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2">
              <input id="password"
                className="w-full bg-transparent text-mm-card outline-none"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                type={showPw ? "text" : "password"}
                autoComplete={tab === "login" ? "current-password" : "new-password"}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="rounded-lg px-2 py-1 hover:bg-white/10"
                aria-label={showPw ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                <Eye open={showPw} />
              </button>
            </div>
          </div>

          <button
            disabled={!canSubmit || loading}
            className="w-full rounded-xl bg-mm-gold px-4 py-2 font-semibold text-mm-bg disabled:opacity-60"
          >
            {tab === "login" ? "Entrar" : "Crear cuenta"}
          </button>
        </form>

        {tab === "login" && (
          <button
            onClick={forgotPassword}
            disabled={loading}
            className="mt-3 w-full text-sm text-white/70 hover:text-white"
          >
            He olvidado mi contraseña
          </button>
        )}

        <p className="mt-4 text-xs text-white/70">Antes de crear una cuenta, consulta <Link className="underline" href="/privacy/">Privacidad</Link> y <Link className="underline" href="/terms/">Condiciones</Link>. Los datos legales pendientes están indicados en esas páginas.</p>
        {msg && <p role="status" className="mt-4 text-sm text-white/80">{msg}</p>}
      </div>
    </main>
  );
}