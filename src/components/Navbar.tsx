"use client";

import { assetPath } from "@/lib/paths";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function Navbar() {
  const [signedIn, setSignedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingActions, setPendingActions] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      setSignedIn(!!session);
      if (session) {
        await checkAdmin(session.user.id);
        await loadPendingActions(session.user.id);
      } else {
        setIsAdmin(false);
        setPendingActions(0);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session);
      if (session) {
        checkAdmin(session.user.id);
        loadPendingActions(session.user.id);
      } else {
        setIsAdmin(false);
        setPendingActions(0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    const timer = setInterval(async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (uid) await loadPendingActions(uid);
    }, 30000);
    return () => clearInterval(timer);
  }, [signedIn]);

  async function checkAdmin(userId: string) {
    const { data } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", userId)
      .single();

    setIsAdmin(data?.is_admin || false);
  }

  async function loadPendingActions(userId: string) {
    const { data: parts, error: pErr } = await supabase
      .from("event_participants")
      .select("event_id,team")
      .eq("user_id", userId);

    if (pErr || !parts || parts.length === 0) {
      setPendingActions(0);
      return;
    }

    const myByEvent = new Map(
      (parts as Array<{ event_id: string; team: "A" | "B" | null }>).map((p) => [p.event_id, p.team])
    );

    const ids = [...new Set((parts as Array<{ event_id: string }>).map((p) => p.event_id))];
    const { data: evs, error: eErr } = await supabase
      .from("events")
      .select("id,result_status,result_team_a_submitted_at,result_team_b_submitted_at")
      .in("id", ids)
      .eq("result_status", "PENDING");

    if (eErr || !evs) {
      setPendingActions(0);
      return;
    }

    let count = 0;
    for (const e of evs as Array<{
      id: string;
      result_status: "PENDING" | "CONFIRMED" | "DISPUTED" | null;
      result_team_a_submitted_at: string | null;
      result_team_b_submitted_at: string | null;
    }>) {
      const myTeam = myByEvent.get(e.id);
      if (!myTeam) continue;

      const mySubmitted =
        myTeam === "A" ? !!e.result_team_a_submitted_at : !!e.result_team_b_submitted_at;
      const rivalSubmitted =
        myTeam === "A" ? !!e.result_team_b_submitted_at : !!e.result_team_a_submitted_at;

      if (!mySubmitted && rivalSubmitted) {
        count += 1;
      }
    }

    setPendingActions(count);
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  return (
    <header className="sticky top-0 z-50 w-full bg-[#052a1e] shadow-lg shadow-black/30 border-b border-black/40">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        {/* LOGO */}
        <Link href="/" className="flex items-center gap-4">
          <div className="relative h-16 w-16 overflow-hidden rounded-xl ring-1 ring-white/15">
            <Image
              src={assetPath("/brand/musmatch-logo3.png")}
              alt="MusMatch"
              fill
              className="object-cover"
              priority
            />
          </div>

          <span className="text-2xl font-bold tracking-tight text-mm-card">
            MusMatch
          </span>
        </Link>

        {/* NAV */}
        <nav className="flex items-center gap-2">
          <Link
            href="/"
            className="rounded-xl px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
          >
            Partidas
          </Link>

          <Link
            href="/rankings"
            className="rounded-xl px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
          >
            Rankings
          </Link>

          <Link
            href="/create"
            className="rounded-xl px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
          >
            Crear
          </Link>

          <Link
            href="/my-matches"
            className="relative rounded-xl px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
          >
            Mis partidas
            {signedIn && pendingActions > 0 && (
              <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-bold text-white">
                {pendingActions}
              </span>
            )}
          </Link>

          <Link
            href="/profile"
            className="rounded-xl px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
          >
            Perfil
          </Link>

          <Link
            href="/users"
            className="rounded-xl px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
          >
            Usuarios
          </Link>

          {isAdmin && (
            <Link
              href="/admin"
              className="rounded-xl px-4 py-2 text-sm font-medium text-orange-400 hover:bg-white/10 hover:text-orange-300"
            >
              Admin
            </Link>
          )}

          <span className="mx-1 hidden h-6 w-px bg-white/20 sm:block" />

          {!signedIn ? (
            <Link
              href="/login"
              className="rounded-xl bg-mm-gold px-5 py-2 text-sm font-semibold text-mm-bg hover:opacity-90"
            >
              Entrar
            </Link>
          ) : (
            <button
              onClick={logout}
              className="rounded-xl bg-white/10 px-5 py-2 text-sm font-medium text-white hover:bg-white/20"
            >
              Salir
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
