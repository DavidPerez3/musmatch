"use client";

import { eventPath } from "@/lib/paths";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type MatchType = "FRIENDLY" | "COMPETITIVE";
type PairMode = "FIXED_PAIR" | "NEED_PARTNER";

type EventRow = {
  id: string;
  title: string;
  location_text: string | null;
  starts_at: string;
  notes: string | null;

  match_type: MatchType;
  pair_mode: PairMode;

  status?: string;
  result_status?: "PENDING" | "CONFIRMED" | "DISPUTED" | null;
  players_count: number;
};

type Filters = {
  location: string;
  dateFrom: string;
  matchType: "ALL" | "FRIENDLY" | "COMPETITIVE";
  pairMode: "ALL" | "FIXED_PAIR" | "NEED_PARTNER";
  status: "ALL" | "OPEN" | "FULL" | "FINISHED" | "DISPUTED";
};

function labelMatchType(t: MatchType) {
  return t === "FRIENDLY" ? "🟢 Amistosa" : "🔴 Competitiva";
}

function labelPairMode(m: PairMode) {
  return m === "FIXED_PAIR" ? "Voy con pareja" : "Necesito pareja";
}

export default function Home() {
  const [signedIn, setSignedIn] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>({
    location: "",
    dateFrom: "",
    matchType: "ALL",
    pairMode: "ALL",
    status: "OPEN",
  });
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErrorMsg(null);

      const { data: sessionData } = await supabase.auth.getSession();
      setSignedIn(!!sessionData.session);
      if (!sessionData.session) { setLoading(false); return; }
      const { data, error } = await supabase
        .from("events_with_counts")
        .select("*")
        .order("starts_at", { ascending: true });

      if (error) {
        console.error(error);
        setErrorMsg(error.message);
        setEvents([]);
      } else {
        setEvents((data as EventRow[]) ?? []);
      }

      setLoading(false);
    })();
  }, []);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      // Location filter
      if (filters.location && !e.location_text?.toLowerCase().includes(filters.location.toLowerCase())) {
        return false;
      }

      // Date filter
      if (filters.dateFrom) {
        const eventDate = new Date(e.starts_at);
        const filterDate = new Date(filters.dateFrom);
        if (eventDate < filterDate) return false;
      }

      // Match type filter
      if (filters.matchType !== "ALL" && e.match_type !== filters.matchType) {
        return false;
      }

      // Pair mode filter
      if (filters.pairMode !== "ALL" && e.pair_mode !== filters.pairMode) {
        return false;
      }

      // Status filter
      if (filters.status !== "ALL") {
        if (filters.status === "DISPUTED") {
          if (e.result_status !== "DISPUTED") return false;
        } else if (e.status !== filters.status) {
          return false;
        }
      }

      return true;
    });
  }, [events, filters]);

  return (
    <main className="mm-page max-w-5xl">
      <header className="mb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-mm-gold">A la mesa</p><h1 className="text-3xl font-bold text-mm-card">Tu próxima partida</h1><p className="mt-2 text-sm text-white/60">Encuentra pareja, reúne a cuatro y disfruta del mus.</p>
          </div>

          <div className="flex gap-2">
            <button
              aria-expanded={showFilters}
              aria-controls="filtros"
              onClick={() => setShowFilters(!showFilters)}
              className="rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-sm font-medium text-mm-card hover:bg-white/20"
            >
              Filtros {showFilters ? "−" : "+"}
            </button>
            <Link
              href="/create"
              className="rounded-xl bg-mm-gold px-4 py-2 text-center font-semibold text-mm-bg hover:opacity-90"
            >
              Crear partida
            </Link>
          </div>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div id="filtros" className="mt-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Location */}
              <div>
                <label htmlFor="field-1" className="text-sm text-white/70">Ubicación</label>
                <input id="field-1"
                  type="text"
                  placeholder="Buscar ubicación..."
                  value={filters.location}
                  onChange={(e) => setFilters({ ...filters, location: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
                />
              </div>

              {/* Date From */}
              <div>
                <label htmlFor="field-2" className="text-sm text-white/70">Desde fecha</label>
                <input id="field-2"
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
                />
              </div>

              {/* Match Type */}
              <div>
                <label htmlFor="field-3" className="text-sm text-white/70">Tipo</label>
                <select id="field-3"
                  value={filters.matchType}
                  onChange={(e) => setFilters({ ...filters, matchType: e.target.value as Filters["matchType"] })}
                  className="mm-select mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
                >
                  <option value="ALL">Todas</option>
                  <option value="FRIENDLY">Amistosas</option>
                  <option value="COMPETITIVE">Competitivas</option>
                </select>
              </div>

              {/* Pair Mode */}
              <div>
                <label htmlFor="field-4" className="text-sm text-white/70">Parejas</label>
                <select id="field-4"
                  value={filters.pairMode}
                  onChange={(e) => setFilters({ ...filters, pairMode: e.target.value as Filters["pairMode"] })}
                  className="mm-select mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
                >
                  <option value="ALL">Todas</option>
                  <option value="FIXED_PAIR">Voy con pareja</option>
                  <option value="NEED_PARTNER">Necesito pareja</option>
                </select>
              </div>

              {/* Status */}
              <div>
                <label htmlFor="field-5" className="text-sm text-white/70">Estado</label>
                <select id="field-5"
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value as Filters["status"] })}
                  className="mm-select mt-1 w-full rounded-xl border border-white/10 bg-mm-bg2 px-3 py-2 text-mm-card outline-none focus:ring-2 focus:ring-white/20"
                >
                  <option value="ALL">Todos</option>
                  <option value="OPEN">Abiertas</option>
                  <option value="FULL">Completas</option>
                  <option value="DISPUTED">En disputa</option>
                  <option value="FINISHED">Finalizadas</option>
                </select>
              </div>

              {/* Clear Filters */}
              <div className="flex items-end">
                <button
                  onClick={() => setFilters({
                    location: "",
                    dateFrom: "",
                    matchType: "ALL",
                    pairMode: "ALL",
                    status: "OPEN",
                  })}
                  className="w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white/70 hover:bg-white/10"
                >
                  Limpiar filtros
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Results Counter */}
      {!loading && signedIn && (
        <div className="mb-4 text-sm text-white/60">
          Mostrando {filteredEvents.length} de {events.length} partidas
        </div>
      )}

      {loading && <p className="text-white/70">Cargando partidas…</p>}

      {!loading && errorMsg && (
        <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <p className="text-mm-card font-semibold">Error cargando partidas</p>

          <p className="mt-2 text-sm text-white/70">No hemos podido cargar las partidas. Comprueba tu conexión e inténtalo de nuevo.</p>
        </div>
      )}

      {!loading && !signedIn && <div className="mm-empty"><h2 className="text-xl font-semibold text-mm-card">Hay sitio para ti</h2><p className="my-3">Entra para encontrar partidas y conocer a otros jugadores.</p><Link className="btn-primary mx-auto max-w-xs" href="/login">Entrar a MusMatch</Link></div>}
      {!loading && signedIn && !errorMsg && filteredEvents.length === 0 && (
        <p className="mm-empty">
          No hay partidas para este filtro. Crea una para empezar.
        </p>
      )}

      <div className="space-y-3">
        {filteredEvents.map((e) => {
          const maxPlayers = 4;
          const faltan = Math.max(0, maxPlayers - e.players_count);

          return (
            <Link
              key={e.id}
              href={eventPath(e.id)}
              className="block rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 transition hover:bg-white/10"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-mm-card">
                    {e.title}
                  </h2>
                  <p className="mt-1 text-sm text-white/70">
                    {new Date(e.starts_at).toLocaleString()} ·{" "}
                    {e.location_text ?? "Sin ubicación"}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-mm-card ring-1 ring-white/10">
                      {labelMatchType(e.match_type)}
                    </span>
                    <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-mm-card ring-1 ring-white/10">
                      {labelPairMode(e.pair_mode)}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 text-left sm:text-right">
                  <p className="text-sm font-medium text-mm-card">
                    {e.players_count}/4
                  </p>
                  <p className="text-sm text-white/70">faltan {faltan}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
