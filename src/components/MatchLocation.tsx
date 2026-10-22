"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
export type Place = {
  name?: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  osm_ref?: string;
  venue_id?: string;
};
export type LocationChoice = Place & {
  type: "PUBLIC_VENUE" | "PRIVATE_LOCATION";
  authorized: boolean;
};
type Venue = {
  id: string;
  name: string;
  status: "CANDIDATE" | "COLLABORATOR";
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  conditions: string | null;
};
export function PlaceMap({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}) {
  const bbox = [
    longitude - 0.008,
    latitude - 0.005,
    longitude + 0.008,
    latitude + 0.005,
  ].join(",");
  return (
    <div className="mt-3 overflow-hidden rounded-xl">
      <iframe
        title="Mapa del lugar seleccionado"
        className="h-56 w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${latitude},${longitude}`}
      />
      <p className="text-xs text-white/60">
        ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap contributors
        </a>
      </p>
    </div>
  );
}
export default function MatchLocation({
  value,
  onChange,
  publicLabel,
  onPublicLabel,
}: {
  value: LocationChoice;
  onChange: (v: LocationChoice) => void;
  publicLabel: string;
  onPublicLabel: (v: string) => void;
}) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void supabase
      .from("venues")
      .select("*")
      .order("name")
      .then(({ data }) => setVenues(data || []));
  }, []);
  function choose(place: Place) {
    onChange({ ...place, type: "PUBLIC_VENUE", authorized: false });
    onPublicLabel(place.address);
    setPlaces([]);
  }
  async function search(input: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("place-search", {
        body: input,
      });
      if (error || data?.error) {
        setMessage(
          data?.error ||
            "No se pudo buscar. Espera unos segundos o indica el lugar manualmente.",
        );
        return;
      }
      setPlaces(data.places || []);
      if (!data.places?.length)
        setMessage("No se encontraron lugares. Puedes escribirlo manualmente.");
    } catch {
      setMessage(
        "Sin conexión con el buscador. Puedes escribir el lugar manualmente.",
      );
    } finally {
      setBusy(false);
    }
  }
  function nearby() {
    if (!navigator.geolocation) {
      setMessage("Este navegador no ofrece ubicación. Busca por nombre.");
      return;
    }
    setBusy(true);
    setMessage("");
    navigator.geolocation.getCurrentPosition(
      (p) =>
        void search({
          mode: "nearby",
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
        }),
      () => {
        setBusy(false);
        setMessage(
          "No se pudo obtener tu ubicación. Busca por nombre o añade el lugar manualmente.",
        );
      },
      { timeout: 10000, maximumAge: 300000, enableHighAccuracy: false },
    );
  }
  return (
    <fieldset className="mm-panel rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 space-y-3">
      <legend className="font-semibold">Lugar de la partida</legend>
      <label className="block">
        Tipo de lugar
        <select
          className="mm-input mt-1 w-full"
          value={value.type}
          onChange={(e) => {
            onChange({
              address: "",
              type: e.target.value as LocationChoice["type"],
              authorized: false,
            });
            onPublicLabel("");
            setPlaces([]);
            setMessage("");
          }}
        >
          <option value="PUBLIC_VENUE">Establecimiento o lugar público</option>
          <option value="PRIVATE_LOCATION">Lugar privado</option>
        </select>
      </label>
      {value.type === "PUBLIC_VENUE" ? (
        <>
          <label className="block">
            Locales propuestos
            <select
              className="mm-input mt-1 w-full"
              value={value.venue_id || ""}
              onChange={(e) => {
                const v = venues.find((v) => v.id === e.target.value);
                if (v)
                  choose({
                    venue_id: v.id,
                    name: v.name,
                    address: v.address || v.name,
                    latitude: v.latitude,
                    longitude: v.longitude,
                  });
                else choose({ address: "" });
              }}
            >
              <option value="">Otro lugar / selección manual</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ·{" "}
                  {v.status === "COLLABORATOR"
                    ? "Colaborador verificado"
                    : "Sin colaboración confirmada"}
                </option>
              ))}
            </select>
          </label>
          {value.venue_id && (
            <p className="text-sm text-white/70">
              {venues.find((v) => v.id === value.venue_id)?.conditions}
            </p>
          )}
          <label className="block" htmlFor="place-query">
            Buscar nombre y municipio
          </label>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              id="place-query"
              className="mm-input min-w-0 flex-1"
              value={query}
              maxLength={120}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ej.: nombre del bar, Vitoria"
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || query.trim().length < 3}
              onClick={() => void search({ query })}
            >
              Buscar
            </button>
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={nearby}
          >
            Bares cerca de mí
          </button>
          <p className="text-xs text-white/60">
            «Cerca de mí» solicita ubicación solo al pulsar y envía una posición
            aproximada al buscador. No la guardamos en tu perfil. Datos ©{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
            >
              OpenStreetMap contributors
            </a>
            .
          </p>
          {busy && <p role="status">Buscando…</p>}
          {message && (
            <p role="status" className="text-sm text-amber-200">
              {message}
            </p>
          )}
          <ul className="space-y-2">
            {places.map((p, i) => (
              <li key={p.osm_ref || i}>
                <button
                  type="button"
                  className="w-full rounded-xl bg-white/5 p-3 text-left break-words"
                  onClick={() => choose(p)}
                >
                  <strong>{p.name}</strong>
                  <span className="block text-sm text-white/60">
                    {p.address}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <label htmlFor="field-3" className="block">
            Ubicación
            <input
              id="field-3"
              className="mm-input mt-1 w-full"
              value={value.address}
              maxLength={500}
              onChange={(e) => {
                onChange({
                  ...value,
                  address: e.target.value,
                  venue_id: undefined,
                  latitude: null,
                  longitude: null,
                  osm_ref: undefined,
                  authorized: false,
                });
                onPublicLabel(e.target.value);
              }}
              placeholder="Nombre y dirección o punto de encuentro"
              required
            />
          </label>
          <details>
            <summary className="cursor-pointer text-sm">
              Añadir coordenadas manualmente
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["latitude", "longitude"] as const).map((key, i) => (
                <label key={key}>
                  {i === 0 ? "Latitud" : "Longitud"}
                  <input
                    type="number"
                    step="any"
                    min={i === 0 ? -90 : -180}
                    max={i === 0 ? 90 : 180}
                    className="mm-input w-full"
                    value={value[key] ?? ""}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        [key]:
                          e.target.value === "" ? null : Number(e.target.value),
                        authorized: false,
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          {value.latitude != null && value.longitude != null && (
            <PlaceMap latitude={value.latitude} longitude={value.longitude} />
          )}
          <p className="text-sm text-white/70">
            Elegir un local no reserva mesa ni confirma que permita jugar.
            Consulta permiso y disponibilidad con el establecimiento.
          </p>
        </>
      ) : (
        <>
          <label className="block">
            Zona visible para todos
            <input
              className="mm-input mt-1 w-full"
              required
              maxLength={150}
              value={publicLabel}
              onChange={(e) => onPublicLabel(e.target.value)}
              placeholder="Ej.: Gazalbide, Vitoria — sin dirección exacta"
            />
          </label>
          <label className="block">
            Dirección privada
            <input
              className="mm-input mt-1 w-full"
              required
              maxLength={500}
              value={value.address}
              onChange={(e) =>
                onChange({
                  ...value,
                  address: e.target.value,
                  authorized: false,
                })
              }
            />
          </label>
          <p className="text-sm text-white/70">
            Solo el organizador, los jugadores apuntados y administración podrán
            consultar la dirección. No escribas la dirección en el título, la
            zona ni las notas públicas. No se envía al buscador de mapas.
          </p>
        </>
      )}
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={value.authorized}
          required
          onChange={(e) => onChange({ ...value, authorized: e.target.checked })}
        />
        <span>
          {value.type === "PRIVATE_LOCATION"
            ? "Confirmo que dispongo de autorización para organizar la partida y compartir esta dirección con sus participantes."
            : "Me encargo de confirmar con el local el permiso para jugar y la disponibilidad de mesa."}{" "}
          Respetaremos el aforo y las normas del lugar.
        </span>
      </label>
    </fieldset>
  );
}
