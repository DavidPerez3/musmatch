"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

type User = {
    id: string;
    username: string | null;
    full_name: string | null;
    elo_rating: number;
};

export default function UsersPage() {
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<User[]>([]);
    const [myFriends, setMyFriends] = useState<string[]>([]);
    const [sentRequests, setSentRequests] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        loadMyFriends();
    }, []);

    async function loadMyFriends() {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Load friends
        const { data: friends } = await supabase
            .from("friendships")
            .select("friend_id")
            .eq("user_id", user.id);

        setMyFriends((friends || []).map((f: any) => f.friend_id));

        // Load sent requests
        const { data: requests } = await supabase
            .from("friend_requests")
            .select("to_user_id")
            .eq("from_user_id", user.id)
            .eq("status", "PENDING");

        setSentRequests((requests || []).map((r: any) => r.to_user_id));
    }

    async function searchUsers() {
        if (!searchQuery.trim()) {
            setSearchResults([]);
            return;
        }

        const { data, error } = await supabase
            .from("profiles")
            .select("id, username, full_name, elo_rating")
            .ilike("username", `%${searchQuery}%`)
            .limit(20);

        if (error) {
            alert(error.message);
            return;
        }

        setSearchResults(data as User[]);
    }

    async function sendFriendRequest(userId: string) {
        setBusy(true);
        const { error } = await supabase.rpc("send_friend_request", {
            target_user_id: userId,
        });

        setBusy(false);

        if (error) {
            alert(error.message);
        } else {
            await loadMyFriends();
        }
    }

    function getButtonState(userId: string) {
        if (myFriends.includes(userId)) return "friends";
        if (sentRequests.includes(userId)) return "pending";
        return "add";
    }

    return (
        <main className="mx-auto max-w-4xl px-4 py-8">
            <h1 className="text-3xl font-bold text-mm-card">Buscar Usuarios</h1>
            <p className="mt-2 text-white/70">Encuentra y añade amigos</p>

            <div className="mt-6 flex gap-2">
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
                <div className="mt-6 space-y-3">
                    {searchResults.map((user) => {
                        const buttonState = getButtonState(user.id);

                        return (
                            <div
                                key={user.id}
                                className="flex items-center justify-between rounded-2xl bg-white/5 p-4 ring-1 ring-white/10"
                            >
                                <div>
                                    <h3 className="font-semibold text-mm-card">
                                        @{user.username || "Sin username"}
                                    </h3>
                                    {user.full_name && (
                                        <p className="text-sm text-white/70">{user.full_name}</p>
                                    )}
                                    <p className="mt-1 text-sm text-white/60">
                                        ELO: <span className="font-bold text-mm-gold">{user.elo_rating}</span>
                                    </p>
                                </div>

                                <div>
                                    {buttonState === "friends" && (
                                        <span className="rounded-xl bg-green-600/20 px-4 py-2 text-sm font-semibold text-green-400">
                                            ✓ Amigos
                                        </span>
                                    )}
                                    {buttonState === "pending" && (
                                        <span className="rounded-xl bg-yellow-600/20 px-4 py-2 text-sm font-semibold text-yellow-400">
                                            ⏳ Pendiente
                                        </span>
                                    )}
                                    {buttonState === "add" && (
                                        <button
                                            disabled={busy}
                                            onClick={() => sendFriendRequest(user.id)}
                                            className="rounded-xl bg-mm-gold px-4 py-2 font-semibold text-mm-bg hover:opacity-90 disabled:opacity-50"
                                        >
                                            + Añadir
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {searchQuery && searchResults.length === 0 && (
                <p className="mt-6 text-center text-white/60">
                    No se encontraron usuarios con ese username
                </p>
            )}
        </main>
    );
}
