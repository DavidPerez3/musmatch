"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type RankingUser = { id: string; username: string | null; full_name: string | null; elo_rating: number; reliability_score: number };

export default function RankingsPage() {
  const [loading, setLoading] = useState(true);
  const [rankings, setRankings] = useState<RankingUser[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      setMyUserId(user?.id || null);
      if (!user) { setLoading(false); return; }
      const { data, error } = await supabase.from("profiles")
        .select("id,username,full_name,elo_rating,reliability_score")
        .order("elo_rating", { ascending: false }).order("id", { ascending: true }).limit(50);
      if (cancelled) return;
      setError(!!error);
      setRankings((data as RankingUser[]) || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);
  return <main className="mm-page max-w-3xl">
    <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-mm-gold">Cada partida cuenta</p>
    <h1 className="font-bold">Ranking</h1>
    <p className="mt-2 mb-6 text-sm text-white/60">Los 50 jugadores con más ELO. Las amistosas no modifican tu nivel.</p>
    {loading ? <p role="status">Cargando ranking…</p> : !myUserId ? <div className="mm-empty"><p className="mb-4">Entra para consultar la clasificación.</p><Link href="/login" className="btn-primary mx-auto max-w-xs">Entrar</Link></div> : error ? <p role="alert" className="mm-empty">No hemos podido cargar el ranking. Comprueba tu conexión y vuelve a intentarlo.</p> : rankings.length === 0 ? <p className="mm-empty">Todavía no hay jugadores en el ranking.</p> : <ol className="mm-ranking-list" aria-label="Clasificación por ELO">
      {rankings.map((user, index) => <li key={user.id} className={`mm-ranking-row ${user.id === myUserId ? "is-me" : ""}`}>
        <span className="mm-ranking-number" aria-label={`Puesto ${index + 1}`}>{`#${index + 1}`}</span>
        <div className="min-w-0">
          <p className="font-semibold">{user.username || "Jugador"}{user.id === myUserId && <span className="ml-2 text-xs text-mm-gold">Tú</span>}</p>
          {user.full_name && <p className="mt-1 text-xs text-white/50">{user.full_name}</p>}
          <p className="mt-1 text-xs text-white/60">Fiabilidad {user.reliability_score}</p>
        </div>
        <div className="mm-ranking-rating">{user.elo_rating}<span className="mm-ranking-meta block">ELO</span></div>
      </li>)}
    </ol>}
    {!loading && myUserId && !error && rankings.length > 0 && !rankings.some(user => user.id === myUserId) && <p className="mt-6 text-center text-sm text-white/60">Aún no estás en el top 50. Consulta tu ELO en tu perfil.</p>}
  </main>;
}
