"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

type RankingUser = {
    id: string;
    username: string | null;
    full_name: string | null;
    elo_rating: number;
    reliability_score: number;
};

export default function RankingsPage() {
    const [loading, setLoading] = useState(true);
    const [rankings, setRankings] = useState<RankingUser[]>([]);
    const [myUserId, setMyUserId] = useState<string | null>(null);

    useEffect(() => {
        loadRankings();
    }, []);

    async function loadRankings() {
        setLoading(true);

        const { data: { user } } = await supabase.auth.getUser();
        setMyUserId(user?.id || null);

        const { data, error } = await supabase
            .from("profiles")
            .select("id, username, full_name, elo_rating, reliability_score")
            .order("elo_rating", { ascending: false })
            .limit(50);

        if (error) {
            console.error(error);
        } else {
            setRankings(data as RankingUser[]);
        }

        setLoading(false);
    }

    if (loading) {
        return (
            <main className="mx-auto max-w-4xl px-4 py-8 text-white/70">
                Cargando rankings...
            </main>
        );
    }

    return (
        <main className="mx-auto max-w-4xl px-4 py-8">
            <h1 className="text-3xl font-bold text-mm-card">🏆 Rankings</h1>
            <p className="mt-2 text-white/70">Top 50 jugadores por ELO</p>

            <div className="mt-6 overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10">
                <table className="w-full">
                    <thead className="bg-white/5">
                        <tr className="text-left text-sm text-white/70">
                            <th className="px-4 py-3 font-medium">Rank</th>
                            <th className="px-4 py-3 font-medium">Jugador</th>
                            <th className="px-4 py-3 font-medium text-right">ELO</th>
                            <th className="px-4 py-3 font-medium text-right">Karma</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {rankings.map((user, index) => {
                            const isMe = user.id === myUserId;
                            const rank = index + 1;

                            return (
                                <tr
                                    key={user.id}
                                    className={`${isMe ? 'bg-mm-gold/10 ring-2 ring-mm-gold/30' : 'hover:bg-white/5'
                                        } transition`}
                                >
                                    <td className="px-4 py-3">
                                        <span className={`font-bold ${rank === 1 ? 'text-yellow-400' :
                                                rank === 2 ? 'text-gray-300' :
                                                    rank === 3 ? 'text-orange-400' :
                                                        'text-white/70'
                                            }`}>
                                            {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div>
                                            <p className="font-semibold text-mm-card">
                                                {user.username || "Sin username"}
                                                {isMe && <span className="ml-2 text-xs text-mm-gold">(Tú)</span>}
                                            </p>
                                            {user.full_name && (
                                                <p className="text-xs text-white/60">{user.full_name}</p>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <span className="font-bold text-mm-gold">{user.elo_rating}</span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <span className="text-green-400">{user.reliability_score}</span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {myUserId && !rankings.find(u => u.id === myUserId) && (
                <p className="mt-4 text-center text-sm text-white/60">
                    No estás en el top 50. ¡Sigue jugando para subir!
                </p>
            )}
        </main>
    );
}
