"use client";

import { assetPath } from "@/lib/paths";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NotificationBell from "./NotificationBell";
import { removeCurrentPush } from "@/lib/push";
import NavIcon, { type IconName } from "./NavIcon";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function Navbar() {
  const pathname = usePathname();
  const [userId, setUserId] = useState<string|null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingActions, setPendingActions] = useState(0);



  const checkAdmin = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", userId)
      .single();

    setIsAdmin(data?.is_admin || false);
  }, []);

  const loadPendingActions = useCallback(async (userId: string) => {
    const {data: invites} = await supabase.from("match_invitations").select("id").eq("invitee_id",userId).eq("status","PENDING");
    const invitationCount = invites?.length || 0;
    const { data: parts, error: pErr } = await supabase
      .from("event_participants")
      .select("event_id,team")
      .eq("user_id", userId);

    if (pErr || !parts || parts.length === 0) {
      setPendingActions(invitationCount);
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
      .eq("result_status", "PENDING")
      .is("simulation_owner_id", null);

    if (eErr || !evs) {
      setPendingActions(invitationCount);
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

    setPendingActions(count + invitationCount);
  }, []);

  async function logout() {
    try { await removeCurrentPush(); } catch { /* Local unsubscribe is attempted even offline. */ }
    await supabase.auth.signOut();
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      setSignedIn(!!session);
      setUserId(session?.user.id || null);
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
      setUserId(session?.user.id || null);
      if (session) {
        checkAdmin(session.user.id);
        loadPendingActions(session.user.id);
      } else {
        setIsAdmin(false);
        setPendingActions(0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [checkAdmin, loadPendingActions]);
  useEffect(() => {
    if (!signedIn) return;
    const timer = setInterval(async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (uid) await loadPendingActions(uid);
    }, 30000);
    return () => clearInterval(timer);
  }, [signedIn, loadPendingActions]);

  const items: Array<{ href: string; label: string; icon: IconName }> = [
    { href: "/", label: "Partidas", icon: "cards" },
    { href: "/my-matches", label: "Mis partidas", icon: "calendar" },
    { href: "/create", label: "Crear", icon: "plus" },
    { href: "/rankings", label: "Ranking", icon: "trophy" },
    { href: "/profile", label: "Perfil", icon: "user" },
  ];
  const active = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);
  const navigation = (mobile: boolean) => items.map(item => (
    <Link key={item.href} href={item.href} aria-current={active(item.href) ? "page" : undefined}
      className={`${mobile ? "mm-bottom-link" : "mm-desktop-link"} ${active(item.href) ? "is-active" : ""} ${item.href === "/create" ? "is-create" : ""}`}>
      <span className="relative inline-flex"><NavIcon name={item.icon} />
        {item.href === "/my-matches" && signedIn && pendingActions > 0 && <span className="mm-badge" aria-label={`${pendingActions} acciones pendientes`}>{pendingActions > 9 ? "9+" : pendingActions}</span>}
      </span>
      <span>{item.label}</span>
    </Link>
  ));
  return <>
    <header className="mm-header">
      <div className="mm-header-inner">
        <Link href="/" className="mm-brand" aria-label="MusMatch, inicio">
          <Image src={assetPath("/icons/icon-192.png")} alt="" width={40} height={40} priority />
          <span>MusMatch<span className="mm-brand-caption">Encuentra tu mesa</span></span>
        </Link>
        <nav className="mm-desktop-nav" aria-label="Navegación principal">{navigation(false)}</nav>
        <div className="mm-account-actions">
          <NotificationBell key={userId} userId={userId}/>
          {!signedIn && <Link href="/login" className="mm-login-link">Entrar</Link>}
          <details className="mm-account-menu" key={pathname}>
            <summary aria-label="Más opciones"><NavIcon name="people" /></summary>
            <div className="mm-account-panel">
              <Link href="/users">Amigos y jugadores</Link>
              <button onClick={() => window.dispatchEvent(new Event("musmatch-check-update"))}>Buscar actualizaciones</button>
              {signedIn && <><Link href="/notifications">Avisos y notificaciones</Link><Link href="/pilot">Piloto e incidencias</Link></>}
              {isAdmin && <><Link href="/admin">Administración</Link><Link href="/simulator">Simulador de partidas</Link></>}
              {signedIn ? <button onClick={logout}>Cerrar sesión</button> : <Link href="/login">Acceder a mi cuenta</Link>}
            </div>
          </details>
        </div>
      </div>
    </header>
    <nav className="mm-bottom-nav" aria-label="Navegación móvil">{navigation(true)}</nav>
  </>;
}
