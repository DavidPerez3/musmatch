"use client";

import MatchRulesCard from "@/components/MatchRulesCard";
import { MatchRules, RulesVariant } from "@/lib/matchRules";
import { eventPath } from "@/lib/paths";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Friend = {
  id: string;
  friend_id: string;
  username: string | null;
  elo_rating: number;
};

type MatchType = "FRIENDLY" | "COMPETITIVE";
type PairMode = "FIXED_PAIR" | "NEED_PARTNER";

type ProfileMini = {
  id: string;
  username: string | null;
};

export default function CreateEventPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [me, setMe] = useState<string | null>(null);

  // Form
  const [title, setTitle] = useState("Partida de mus");
  const [locationText, setLocationText] = useState<string>("");
  const [startsAt, setStartsAt] = useState<string>(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16); // local wall time for datetime-local
  });
  const [rulesVariant, setRulesVariant] = useState<RulesVariant>("EIGHT_KINGS");
  const [points, setPoints] = useState(40);
  const [games, setGames] = useState(3);
  const [vacas, setVacas] = useState(1);
  const [houseRules, setHouseRules] = useState("");
  const rules: MatchRules = {
    rules_version: 1,
    rules_variant: rulesVariant,
    points_per_game: points,
    games_to_win: games,
    vacas_to_win: vacas,
    house_rules: houseRules,
  };
  const [notes, setNotes] = useState<string>("");

  const [matchType, setMatchType] = useState<MatchType>("FRIENDLY");
  const [pairMode, setPairMode] = useState<PairMode>("FIXED_PAIR");

  const [profile, setProfile] = useState<ProfileMini | null>(null);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(
    null,
  );
  const [friendSearch, setFriendSearch] = useState("");

  const filteredFriends = useMemo(() => {
    if (!friendSearch.trim()) return friends;
    return friends.filter((f) =>
      f.username?.toLowerCase().includes(friendSearch.toLowerCase()),
    );
  }, [friends, friendSearch]);

  const canSubmit = useMemo(() => {
    if (!me) return false;
    if (title.trim().length < 3) return false;
    if (!startsAt) return false;
    // Si es FIXED_PAIR, debe seleccionar un amigo
    if (pairMode === "FIXED_PAIR" && !selectedPartnerId) return false;
    return true;
  }, [me, title, startsAt, pairMode, selectedPartnerId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErrorMsg(null);

      const { data } = await supabase.auth.getUser();
      const user = data.user;

      if (!user) {
        router.push("/login");
        return;
      }

      setMe(user.id);

      // Exigir username (igual que en detalle)
      const { data: prof, error: pErr } = await supabase
        .from("profiles")
        .select("id,username")
        .eq("id", user.id)
        .single();

      if (pErr) {
        setErrorMsg(pErr.message);
        setLoading(false);
        return;
      }

      setProfile(prof as ProfileMini);

      if (!prof?.username || prof.username.trim().length < 3) {
        router.push("/profile");
        return;
      }

      // Load friends
      const { data: friendsData } = await supabase
        .from("friendships")
        .select("id, friend_id")
        .eq("user_id", user.id);

      const friendsWithDetails = await Promise.all(
        (friendsData || []).map(
          async (f: { id: string; friend_id: string }) => {
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
          },
        ),
      );

      setFriends(friendsWithDetails);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;

    setErrorMsg(null);
    setSubmitting(true);

    // Convertir datetime-local a ISO
    const isoStartsAt = new Date(startsAt).toISOString();

    // Usar RPC para crear partida con amigo
    const { data: eventId, error } = await supabase.rpc(
      "create_match_with_rules",
      {
        p_rules_variant: rulesVariant,
        p_points_per_game: points,
        p_games_to_win: games,
        p_vacas_to_win: vacas,
        p_house_rules: houseRules.trim() || null,
        p_title: title.trim(),
        p_location_text: locationText.trim() || null,
        p_starts_at: isoStartsAt,
        p_notes: notes.trim() || null,
        p_match_type: matchType,
        p_pair_mode: pairMode,
        p_partner_id: pairMode === "FIXED_PAIR" ? selectedPartnerId : null,
      },
    );

    if (error) {
      setSubmitting(false);
      setErrorMsg(error.message);
      return;
    }

    setSubmitting(false);
    router.push(eventPath(eventId));
  }

  if (loading) {
    return <main className="mm-page max-w-2xl text-white/70">Cargando…</main>;
  }

  return (
    <main className="mm-page max-w-2xl">
      <div className="mt-4 rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
        <h1 className="text-2xl font-bold text-mm-card">Crear partida</h1>
        <p className="mt-1 text-sm text-white/70">
          El mus siempre es{" "}
          <span className="text-mm-card font-medium">2 vs 2</span>. Aquí eliges
          si es amistosa o competitiva y cómo se forman las parejas.
        </p>

        {profile?.username && (
          <p className="mt-3 text-sm text-white/70">
            Creando como{" "}
            <span className="text-mm-card font-semibold">
              @{profile.username}
            </span>
          </p>
        )}

        <form onSubmit={handleCreate} className="mt-6 space-y-5">
          <div>
            <label htmlFor="field-1" className="text-sm text-white/70">
              Título
            </label>
            <input
              id="field-1"
              className="mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Partida de mus"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="field-2" className="text-sm text-white/70">
                Fecha y hora
              </label>
              <input
                id="field-2"
                className="mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="field-3" className="text-sm text-white/70">
                Ubicación
              </label>
              <input
                id="field-3"
                className="mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
                value={locationText}
                onChange={(e) => setLocationText(e.target.value)}
                placeholder="Ej: Gazalbide"
              />
              <p className="mt-1 text-xs text-white/50">
                Indica el local o punto de encuentro.
              </p>
            </div>
          </div>

          {/* Tipo */}
          <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
            <p className="font-semibold text-mm-card">Tipo</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={matchType === "FRIENDLY"}
                onClick={() => setMatchType("FRIENDLY")}
                className={`rounded-xl px-4 py-3 text-left ring-1 transition ${
                  matchType === "FRIENDLY"
                    ? "bg-mm-gold/20 ring-mm-gold/40"
                    : "bg-white/5 ring-white/10 hover:bg-white/10"
                } `}
              >
                <p className="font-semibold text-mm-card">🟢 Amistosa</p>
                <p className="mt-1 text-sm text-white/70">
                  Para jugar con calma. No afecta al ELO.
                </p>
              </button>

              <button
                type="button"
                aria-pressed={matchType === "COMPETITIVE"}
                onClick={() => setMatchType("COMPETITIVE")}
                className={`rounded-xl px-4 py-3 text-left ring-1 transition ${
                  matchType === "COMPETITIVE"
                    ? "bg-mm-gold/20 ring-mm-gold/40"
                    : "bg-white/5 ring-white/10 hover:bg-white/10"
                } `}
              >
                <p className="font-semibold text-mm-card">🔴 Competitiva</p>
                <p className="mt-1 text-sm text-white/70">
                  Se registrará el resultado y afectará al ELO.
                </p>
              </button>
            </div>
          </div>

          <fieldset className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
            <legend className="px-1 font-semibold">Reglas y formato</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="rules-variant"
                  className="text-sm text-white/70"
                >
                  Modalidad de mus
                </label>
                <select
                  id="rules-variant"
                  value={rulesVariant}
                  onChange={(e) =>
                    setRulesVariant(e.target.value as RulesVariant)
                  }
                  className="mm-select mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2"
                >
                  <option value="EIGHT_KINGS">8 reyes / 8 ases</option>
                  <option value="FOUR_KINGS">4 reyes / 4 ases</option>
                </select>
              </div>
              <div>
                <label htmlFor="rules-points" className="text-sm text-white/70">
                  Tantos por juego
                </label>
                <select
                  id="rules-points"
                  value={points}
                  onChange={(e) => setPoints(Number(e.target.value))}
                  className="mm-select mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2"
                >
                  <option value="30">30 tantos</option>
                  <option value="40">40 tantos</option>
                </select>
              </div>
              <div>
                <label htmlFor="rules-games" className="text-sm text-white/70">
                  Juegos para ganar una vaca
                </label>
                <select
                  id="rules-games"
                  value={games}
                  onChange={(e) => setGames(Number(e.target.value))}
                  className="mm-select mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2"
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                </select>
              </div>
              <div>
                <label htmlFor="rules-vacas" className="text-sm text-white/70">
                  Vacas para ganar la partida
                </label>
                <select
                  id="rules-vacas"
                  value={vacas}
                  onChange={(e) => setVacas(Number(e.target.value))}
                  className="mm-select mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2"
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </div>
            </div>
            <label
              htmlFor="house-rules"
              className="mt-4 block text-sm text-white/70"
            >
              Otras reglas acordadas (opcional)
            </label>
            <textarea
              id="house-rules"
              maxLength={1000}
              rows={3}
              value={houseRules}
              onChange={(e) => setHouseRules(e.target.value)}
              placeholder="Ej: sin juego real, señas permitidas…"
              className="mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2"
            />
            <p className="mt-1 text-xs text-white/60">
              Especifica aquí variantes como juego real o deje. Las notas
              generales no cambian estas reglas.
            </p>
            <MatchRulesCard rules={rules} />
          </fieldset>

          {/* Parejas */}
          <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
            <p className="font-semibold text-mm-card">Parejas</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={pairMode === "FIXED_PAIR"}
                onClick={() => setPairMode("FIXED_PAIR")}
                className={`rounded-xl px-4 py-3 text-left ring-1 transition ${
                  pairMode === "FIXED_PAIR"
                    ? "bg-mm-gold/20 ring-mm-gold/40"
                    : "bg-white/5 ring-white/10 hover:bg-white/10"
                } `}
              >
                <p className="font-semibold text-mm-card">Voy con pareja</p>
                <p className="mt-1 text-sm text-white/70">
                  Selecciona un amigo como compañero.
                </p>
              </button>

              <button
                type="button"
                aria-pressed={pairMode === "NEED_PARTNER"}
                onClick={() => setPairMode("NEED_PARTNER")}
                className={`rounded-xl px-4 py-3 text-left ring-1 transition ${
                  pairMode === "NEED_PARTNER"
                    ? "bg-mm-gold/20 ring-mm-gold/40"
                    : "bg-white/5 ring-white/10 hover:bg-white/10"
                } `}
              >
                <p className="font-semibold text-mm-card">Necesito pareja</p>
                <p className="mt-1 text-sm text-white/70">
                  Te apuntas solo y el sistema te emparejará.
                </p>
              </button>
            </div>
          </div>

          {/* Friend Selector - only for FIXED_PAIR */}
          {pairMode === "FIXED_PAIR" && (
            <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
              <p className="font-semibold text-mm-card">
                Selecciona tu compañero
              </p>

              {friends.length === 0 ? (
                <p className="mt-3 text-sm text-white/60">
                  No tienes amigos añadidos. Ve a{" "}
                  <span className="text-mm-gold">Usuarios</span> para añadir
                  amigos.
                </p>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Buscar amigo..."
                    value={friendSearch}
                    onChange={(e) => setFriendSearch(e.target.value)}
                    className="mt-3 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
                  />

                  <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                    {filteredFriends.map((friend) => (
                      <button
                        key={friend.friend_id}
                        type="button"
                        onClick={() => setSelectedPartnerId(friend.friend_id)}
                        className={`w-full rounded-xl p-3 text-left ring-1 transition ${
                          selectedPartnerId === friend.friend_id
                            ? "bg-mm-gold/20 ring-mm-gold/40"
                            : "bg-white/5 ring-white/10 hover:bg-white/10"
                        }`}
                      >
                        <p className="font-medium text-mm-card">
                          @{friend.username || "Usuario"}
                        </p>
                        <p className="text-xs text-white/60">
                          ELO:{" "}
                          <span className="font-bold text-mm-gold">
                            {friend.elo_rating}
                          </span>
                        </p>
                      </button>
                    ))}
                  </div>

                  {filteredFriends.length === 0 && (
                    <p className="mt-3 text-sm text-white/60">
                      No se encontraron amigos con ese nombre
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <div>
            <label htmlFor="field-4" className="text-sm text-white/70">
              Notas (opcional)
            </label>
            <textarea
              id="field-4"
              className="mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: llegad cinco minutos antes..."
            />
          </div>

          <button
            disabled={!canSubmit || submitting}
            className="w-full rounded-xl bg-mm-gold px-4 py-2 font-semibold text-mm-bg disabled:opacity-60"
          >
            {submitting ? "Creando…" : "Crear partida"}
          </button>

          {errorMsg && <p className="text-sm text-red-400">{errorMsg}</p>}
        </form>
      </div>
    </main>
  );
}
