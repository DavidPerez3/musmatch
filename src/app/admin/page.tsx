"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type DisputedMatch = {
    id: string;
    title: string;
    winner_team: "A" | "B" | null;
    result_score: string | null;
    result_proposed_by: string | null;
    created_at: string;
};

type User = {
    id: string;
    username: string | null;
    full_name: string | null;
    elo_rating: number;
    reliability_score: number;
    created_at: string;
};

type PresenceOverview = {
    event_id: string;
    title: string;
    starts_at: string;
    status: string;
    result_status: "PENDING" | "CONFIRMED" | "DISPUTED" | null;
    match_type: "FRIENDLY" | "COMPETITIVE";
    players_count: number;
    checked_in_count: number;
    proofs_count: number;
    pending_checkins: number;
};

export default function AdminPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);

    const [disputedMatches, setDisputedMatches] = useState<DisputedMatch[]>([]);
    const [presenceOverview, setPresenceOverview] = useState<PresenceOverview[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<User[]>([]);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        checkAdmin();
    }, []);

    async function checkAdmin() {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            router.push("/login");
            return;
        }

        const { data: profile } = await supabase
            .from("profiles")
            .select("is_admin")
            .eq("id", user.id)
            .single();

        if (!profile?.is_admin) {
            router.push("/");
            return;
        }

        setIsAdmin(true);
        await loadDisputedMatches();
        await loadPresenceOverview();
        setLoading(false);
    }

    async function loadDisputedMatches() {
        const { data, error } = await supabase
            .from("events")
            .select("id, title, winner_team, result_score, result_proposed_by, created_at")
            .eq("result_status", "DISPUTED")
            .order("created_at", { ascending: false });

        if (error) {
            alert(error.message);
            return;
        }

        setDisputedMatches(data as DisputedMatch[]);
    }

    async function loadPresenceOverview() {
        const { data, error } = await supabase
            .from("admin_event_presence_overview")
            .select("*")
            .eq("match_type", "COMPETITIVE")
            .in("status", ["OPEN", "FULL", "CLOSED"])
            .order("pending_checkins", { ascending: false })
            .order("starts_at", { ascending: true })
            .limit(20);

        if (error) {
            alert(error.message);
            return;
        }

        setPresenceOverview((data || []) as PresenceOverview[]);
    }

    async function resolveDispute(matchId: string, winner: "A" | "B") {
        if (!confirm(`¿Confirmar victoria del Equipo ${winner}?`)) return;

        setBusy(true);
        const { error } = await supabase.rpc("admin_resolve_dispute", {
            match_id: matchId,
            winner_team: winner,
            apply_elo: true,
        });

        setBusy(false);

        if (error) {
            alert(error.message);
        } else {
            alert("Disputa resuelta correctamente");
            await loadDisputedMatches();
        }
    }

    async function searchUsers() {
        if (!searchQuery.trim()) {
            setSearchResults([]);
            return;
        }

        const { data, error } = await supabase
            .from("profiles")
            .select("id, username, full_name, elo_rating, reliability_score, created_at")
            .ilike("username", `%${searchQuery}%`)
            .limit(10);

        if (error) {
            alert(error.message);
            return;
        }

        setSearchResults(data as User[]);
    }

    async function adjustUser(userId: string, eloDelta: number, reliabilityDelta: number) {
        const confirmMsg = `Ajustar usuario:\nELO: ${eloDelta > 0 ? '+' : ''}${eloDelta}\nKarma: ${reliabilityDelta > 0 ? '+' : ''}${reliabilityDelta}`;
        if (!confirm(confirmMsg)) return;

        setBusy(true);
        const { error } = await supabase.rpc("admin_adjust_user", {
            target_user_id: userId,
            elo_delta: eloDelta,
            reliability_delta: reliabilityDelta,
        });

        setBusy(false);

        if (error) {
            alert(error.message);
        } else {
            alert("Usuario actualizado");
            await searchUsers();
        }
    }

    if (loading) {
        return (
            <main className="mx-auto max-w-5xl px-4 py-8 text-white/70">
                Verificando permisos...
            </main>
        );
    }

    if (!isAdmin) {
        return null;
    }

    return (
        <main className="mx-auto max-w-5xl px-4 py-8">
            <h1 className="text-3xl font-bold text-mm-card">Panel de Administración</h1>

            {/* DISPUTED MATCHES */}
            <section className="mt-8">
                <h2 className="text-2xl font-semibold text-mm-card">Partidas en Disputa</h2>

                {disputedMatches.length === 0 ? (
                    <p className="mt-4 text-white/60">No hay disputas pendientes</p>
                ) : (
                    <div className="mt-4 space-y-4">
                        {disputedMatches.map((match) => (
                            <div
                                key={match.id}
                                className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="font-semibold text-mm-card">{match.title}</h3>
                                        <p className="text-sm text-white/70">ID: {match.id}</p>
                                        <p className="mt-1 text-white">
                                            Resultado propuesto: <span className="font-bold">Equipo {match.winner_team}</span> ({match.result_score})
                                        </p>
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            disabled={busy}
                                            onClick={() => resolveDispute(match.id, "A")}
                                            className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                                        >
                                            Gana A
                                        </button>
                                        <button
                                            disabled={busy}
                                            onClick={() => resolveDispute(match.id, "B")}
                                            className="rounded-xl bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-500 disabled:opacity-50"
                                        >
                                            Gana B
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* PRESENCE RISK QUEUE */}
            <section className="mt-12">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-2xl font-semibold text-mm-card">Prioridad Presencia (Competitivas)</h2>
                    <button
                        onClick={loadPresenceOverview}
                        className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
                    >
                        Refrescar
                    </button>
                </div>

                {presenceOverview.length === 0 ? (
                    <p className="mt-4 text-white/60">Sin alertas de presencia ahora mismo</p>
                ) : (
                    <div className="mt-4 space-y-3">
                        {presenceOverview.map((row) => (
                            <div key={row.event_id} className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="font-semibold text-mm-card">{row.title}</h3>
                                        <p className="text-sm text-white/70">
                                            {new Date(row.starts_at).toLocaleString()} · Estado: {row.status}
                                        </p>
                                        <p className="mt-1 text-sm text-white/80">
                                            Check-in: <span className="font-bold text-mm-gold">{row.checked_in_count}/4</span> ·
                                            Pruebas: <span className="font-bold text-mm-gold"> {row.proofs_count}</span>
                                        </p>
                                    </div>

                                    <div className="text-right">
                                        <p className="text-xs text-white/60">Pendientes</p>
                                        <p className={`text-xl font-bold ${row.pending_checkins > 0 ? "text-red-400" : "text-green-400"}`}>
                                            {row.pending_checkins}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* USER SEARCH */}
            <section className="mt-12">
                <h2 className="text-2xl font-semibold text-mm-card">Gestión de Usuarios</h2>

                <div className="mt-4 flex gap-2">
                    <input
                        type="text"
                        placeholder="Buscar por username..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && searchUsers()}
                        className="flex-1 rounded-xl border border-white/10 bg-mm-bg2 px-4 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
                    />
                    <button
                        onClick={searchUsers}
                        className="rounded-xl bg-mm-gold px-6 py-2 font-semibold text-mm-bg hover:opacity-90"
                    >
                        Buscar
                    </button>
                </div>

                {searchResults.length > 0 && (
                    <div className="mt-4 space-y-3">
                        {searchResults.map((user) => (
                            <div
                                key={user.id}
                                className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="font-semibold text-mm-card">
                                            @{user.username || "Sin username"}
                                        </h3>
                                        <p className="text-sm text-white/70">{user.full_name}</p>
                                        <div className="mt-2 flex gap-4 text-sm">
                                            <span className="text-white">ELO: <span className="font-bold text-mm-gold">{user.elo_rating}</span></span>
                                            <span className="text-white">Karma: <span className="font-bold text-green-400">{user.reliability_score}</span></span>
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-2">
                                        <button
                                            disabled={busy}
                                            onClick={() => adjustUser(user.id, -50, 0)}
                                            className="rounded-xl bg-red-600 px-3 py-1 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                                        >
                                            -50 ELO
                                        </button>
                                        <button
                                            disabled={busy}
                                            onClick={() => adjustUser(user.id, 0, -20)}
                                            className="rounded-xl bg-orange-600 px-3 py-1 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                                        >
                                            -20 Karma
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </main>
    );
}
