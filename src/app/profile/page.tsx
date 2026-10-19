"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type Profile = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  elo_rating: number;
};

type MatchHistory = {
  match_id: string;
  title: string;
  winner_team: "A" | "B" | null;
  result_score: string | null;
  created_at: string;
  team: "A" | "B";
  result: "WON" | "LOST" | "PENDING" | "CANCELLED";
};

type Friend = {
  id: string;
  friend_id: string;
  username: string | null;
  elo_rating: number;
};

type FriendRequest = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  from_username: string | null;
  to_username: string | null;
  status: string;
  created_at: string;
};

function initialsFrom(nameOrEmail: string) {
  const parts = nameOrEmail.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function colorFromId(id: string) {
  // color estable por id
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 55% 35%)`;
}

export default function ProfilePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");

  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [matchHistory, setMatchHistory] = useState<MatchHistory[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
  const [sentRequests, setSentRequests] = useState<FriendRequest[]>([]);

  const mustSetUsername = useMemo(() => {
    return profile && (!profile.username || profile.username.trim().length < 3);
  }, [profile]);

  const initials = useMemo(() => {
    const base = profile?.full_name || email || "User";
    return initialsFrom(base);
  }, [profile?.full_name, email]);

  const avatarBg = useMemo(() => {
    return userId ? colorFromId(userId) : "hsl(160 55% 25%)";
  }, [userId]);

  async function load() {
    setLoading(true);
    setMsg(null);

    const { data: u } = await supabase.auth.getUser();
    const user = u.user;
    if (!user) {
      router.push("/login");
      return;
    }

    setUserId(user.id);
    setEmail(user.email ?? "");

    const { data: p, error } = await supabase
      .from("profiles")
      .select("id,username,full_name,avatar_url,elo_rating")
      .eq("id", user.id)
      .single();

    if (error) {
      setLoading(false);
      setMsg(error.message);
      return;
    }

    const prof = p as Profile;
    setProfile(prof);
    setUsername(prof.username ?? "");
    setFullName(prof.full_name ?? "");

    // Load match history
    const { data: history } = await supabase
      .from("user_match_history")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", {ascending:false})
      .limit(10);

    setMatchHistory((history || []) as MatchHistory[]);

    // Load friends
    const { data: friendsData, error: friendsError } = await supabase
      .from("friendships")
      .select("id, friend_id")
      .eq("user_id", user.id);

    if (friendsError) {
      console.error("Error loading friends:", friendsError);
    }

    // Get usernames and ELO for friends
    const friendsWithDetails = await Promise.all(
      (friendsData || []).map(async (f: { id: string; friend_id: string }) => {
        const { data: profile } = await supabase
          .from("profiles")
          .select("username, elo_rating")
          .eq("id", f.friend_id)
          .single();

        return {
          id: f.id,
          friend_id: f.friend_id,
          username: profile?.username,
          elo_rating: profile?.elo_rating || 1000,
        };
      })
    );

    setFriends(friendsWithDetails);

    // Load pending requests (received)
    const { data: pending, error: pendingError } = await supabase
      .from("friend_requests")
      .select("id, from_user_id, to_user_id, status, created_at")
      .eq("to_user_id", user.id)
      .eq("status", "PENDING");

    if (pendingError) {
      console.error("Error loading pending requests:", pendingError);
    }

    // Get usernames for pending requests
    const pendingWithUsernames = await Promise.all(
      (pending || []).map(async (r: { id: string; from_user_id: string; to_user_id: string; created_at: string; status: string }) => {
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", r.from_user_id)
          .single();

        return {
          id: r.id,
          from_user_id: r.from_user_id,
          to_user_id: r.to_user_id,
          from_username: profile?.username,
          to_username: null,
          status: r.status,
          created_at: r.created_at,
        };
      })
    );

    setPendingRequests(pendingWithUsernames);

    // Load sent requests
    const { data: sent, error: sentError } = await supabase
      .from("friend_requests")
      .select("id, from_user_id, to_user_id, status, created_at")
      .eq("from_user_id", user.id)
      .eq("status", "PENDING");

    if (sentError) {
      console.error("Error loading sent requests:", sentError);
    }

    // Get usernames for sent requests
    const sentWithUsernames = await Promise.all(
      (sent || []).map(async (r: { id: string; from_user_id: string; to_user_id: string; created_at: string; status: string }) => {
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", r.to_user_id)
          .single();

        return {
          id: r.id,
          from_user_id: r.from_user_id,
          to_user_id: r.to_user_id,
          from_username: null,
          to_username: profile?.username,
          status: r.status,
          created_at: r.created_at,
        };
      })
    );

    setSentRequests(sentWithUsernames);

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;

    setMsg(null);
    setLoading(true);

    const cleanUsername = username.trim();

    if (cleanUsername.length < 3) {
      setLoading(false);
      setMsg("El username debe tener mínimo 3 caracteres.");
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        username: cleanUsername,
        full_name: fullName.trim() || null,
      })
      .eq("id", userId);

    setLoading(false);

    if (error) {
      if (error.message.toLowerCase().includes("duplicate")) {
        setMsg("Ese username ya existe. Prueba otro.");
      } else {
        setMsg(error.message);
      }
      return;
    }

    setMsg("✅ Perfil actualizado.");
    await load();
  }

  async function acceptFriendRequest(requestId: string) {
    const { error } = await supabase.rpc("accept_friend_request", {
      request_id: requestId,
    });

    if (error) {
      alert(error.message);
    } else {
      await load();
    }
  }

  async function rejectFriendRequest(requestId: string) {
    const { error } = await supabase.rpc("reject_friend_request", {
      request_id: requestId,
    });

    if (error) {
      alert(error.message);
    } else {
      await load();
    }
  }

  async function removeFriend(friendId: string) {
    if (!confirm("¿Eliminar de amigos?")) return;

    const { error } = await supabase.rpc("remove_friend", {
      target_friend_id: friendId,
    });

    if (error) {
      alert(error.message);
    } else {
      await load();
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading && !profile) {
    return (
      <main className="mm-page max-w-xl text-white/70">
        Cargando perfil…
      </main>
    );
  }

  return (
    <main className="mm-page max-w-xl">
      <div className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
        <div className="flex flex-wrap items-center gap-3">
          {profile?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt="Avatar"
              className="shrink-0 h-14 w-14 rounded-2xl object-cover ring-1 ring-white/10"
            />
          ) : (
            <div
              className="shrink-0 grid h-14 w-14 place-items-center rounded-2xl text-lg font-bold text-white ring-1 ring-white/10"
              style={{ background: avatarBg }}
            >
              {initials}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold text-mm-card">
              {profile?.username ? `@${profile.username}` : "Completa tu perfil"}
            </h1>
            <p className="text-sm text-white/70">{email}</p>
          </div>

          <div className="w-full sm:w-auto sm:ml-auto rounded-2xl bg-white/5 px-4 py-3 ring-1 ring-white/10">
            <p className="text-xs text-white/60">ELO</p>
            <p className="text-lg font-bold text-mm-card">{profile?.elo_rating ?? 1000}</p>
          </div>
        </div >

        {mustSetUsername && (
          <div className="mt-4 rounded-2xl bg-mm-gold/15 p-4 ring-1 ring-mm-gold/30">
            <p className="font-semibold text-mm-card">Te falta el username</p>
            <p className="mt-1 text-sm text-white/70">
              Necesitas un username para que en las partidas no salga “Jugador 1”.
            </p>
          </div>
        )}

        <form onSubmit={saveProfile} className="mt-6 space-y-4">
          <div>
            <label htmlFor="field-1" className="text-sm text-white/70">Username</label>
            <input id="field-1"
              className="mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <p className="mt-1 text-xs text-white/50">
              Único, mínimo 3 caracteres. Se mostrará en las partidas.
            </p>
          </div>

          <div>
            <label htmlFor="field-2" className="text-sm text-white/70">Nombre (opcional)</label>
            <input id="field-2"
              className="mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Tu nombre"
            />
          </div>

          <button
            disabled={loading}
            className="w-full rounded-xl bg-mm-gold px-4 py-2 font-semibold text-mm-bg disabled:opacity-60"
          >
            Guardar cambios
          </button>
        </form>

        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={() => router.push("/reset-password")}
            className="w-full rounded-xl bg-white/10 px-4 py-2 font-medium text-white hover:bg-white/20"
          >
            Cambiar contraseña
          </button>

          <button
            onClick={logout}
            className="w-full rounded-xl bg-white/10 px-4 py-2 font-medium text-white hover:bg-white/20"
          >
            Cerrar sesión
          </button>
        </div>

        {msg && <p className="mt-4 text-sm text-white/80">{msg}</p>}

        {/* FRIEND REQUESTS */}
        {pendingRequests.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-bold text-mm-card">Solicitudes de Amistad</h2>
            <div className="mt-4 space-y-2">
              {pendingRequests.map((req) => (
                <div
                  key={req.id}
                  className="flex mm-stack items-center justify-between rounded-xl bg-white/5 p-3 ring-1 ring-white/10"
                >
                  <p className="font-medium text-mm-card">
                    @{req.from_username || "Usuario"}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => acceptFriendRequest(req.id)}
                      className="rounded-lg bg-green-600 px-3 py-1 text-sm font-semibold text-white hover:bg-green-500"
                    >
                      Aceptar
                    </button>
                    <button
                      onClick={() => rejectFriendRequest(req.id)}
                      className="rounded-lg bg-red-600 px-3 py-1 text-sm font-semibold text-white hover:bg-red-500"
                    >
                      Rechazar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* FRIENDS LIST */}
        <div className="mt-8">
          <h2 className="text-xl font-bold text-mm-card">Amigos ({friends.length})</h2>

          {friends.length === 0 ? (
            <p className="mt-3 text-sm text-white/60">Aún no tienes amigos añadidos</p>
          ) : (
            <div className="mt-4 space-y-2">
              {friends.map((friend) => (
                <div
                  key={friend.id}
                  className="flex mm-stack items-center justify-between rounded-xl bg-white/5 p-3 ring-1 ring-white/10"
                >
                  <div>
                    <p className="font-medium text-mm-card">
                      @{friend.username || "Usuario"}
                    </p>
                    <p className="text-xs text-white/60">
                      ELO: <span className="font-bold text-mm-gold">{friend.elo_rating}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => removeFriend(friend.friend_id)}
                    className="rounded-lg bg-red-600/20 px-3 py-1 text-sm font-semibold text-red-400 hover:bg-red-600/30"
                  >
                    Eliminar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SENT REQUESTS */}
        {sentRequests.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-white/70">Solicitudes Enviadas</h3>
            <div className="mt-2 space-y-1">
              {sentRequests.map((req) => (
                <p key={req.id} className="text-sm text-white/60">
                  → @{req.to_username || "Usuario"} (Pendiente)
                </p>
              ))}
            </div>
          </div>
        )}

        {/* MATCH HISTORY */}
        <div className="mt-8">
          <h2 className="text-xl font-bold text-mm-card">Historial de Partidas</h2>

          {matchHistory.length === 0 ? (
            <p className="mt-3 text-sm text-white/60">Aún no has jugado ninguna partida</p>
          ) : (
            <div className="mt-4 space-y-2">
              {matchHistory.map((match) => (
                <div
                  key={match.match_id}
                  className="flex mm-stack items-center justify-between rounded-xl bg-white/5 p-3 ring-1 ring-white/10"
                >
                  <div className="flex-1">
                    <p className="font-medium text-mm-card">{match.title}</p>
                    <p className="text-xs text-white/60">
                      {new Date(match.created_at).toLocaleDateString('es-ES')}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-sm text-white/70">
                      Equipo {match.team}
                    </span>
                    <span className={`rounded-lg px-3 py-1 text-sm font-bold ${match.result === 'WON'
                      ? 'bg-green-500/20 text-green-400'
                      : match.result === 'LOST' ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white/70'
                      }`}>
                      {match.result === 'WON' ? '✓ Victoria' : match.result === 'LOST' ? '✗ Derrota' : match.result === 'CANCELLED' ? 'Cancelada' : 'Pendiente'}
                    </span>
                    <span className="text-sm text-white/70">
                      {match.result_score}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div >
    </main >
  );
}