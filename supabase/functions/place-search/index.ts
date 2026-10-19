// Only public places. Private addresses are never sent to this endpoint.
import { createClient } from "npm:@supabase/supabase-js@2.89.0";
const allowed = new Set([
  "https://davidperez3.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const headers = {
    "Access-Control-Allow-Origin": allowed.has(origin)
      ? origin
      : "https://davidperez3.github.io",
    "Access-Control-Allow-Headers":
      "authorization, apikey, x-client-info, content-type",
    "Content-Type": "application/json",
    Vary: "Origin",
  };
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST" || (origin && !allowed.has(origin)))
    return reply({ error: "Solicitud no permitida" }, 403);
  try {
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!bearer) return reply({ error: "Inicia sesión" }, 401);
    const {
      data: { user },
      error,
    } = await client.auth.getUser(bearer);
    if (error || !user) return reply({ error: "Inicia sesión" }, 401);
    const input = await req.json();
    const nearby = input.mode === "nearby";
    const q =
      typeof input.query === "string" ? input.query.trim().slice(0, 120) : "";
    const lat = Number(input.latitude),
      lon = Number(input.longitude);
    if (
      nearby
        ? typeof input.latitude !== "number" ||
          typeof input.longitude !== "number" ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          Math.abs(lat) > 90 ||
          Math.abs(lon) > 180
        : q.length < 3
    )
      return reply(
        { error: "Indica nombre y municipio o una ubicación válida" },
        400,
      );
    const latitude = Math.round(lat * 1000) / 1000,
      longitude = Math.round(lon * 1000) / 1000;
    const key = nearby
      ? `near:${latitude},${longitude}`
      : `name:${q.toLocaleLowerCase("es")}`;
    const { data: gate, error: gateError } = await client.rpc(
      "claim_place_search",
      { p_user_id: user.id, p_key: key },
    );
    if (gateError)
      return reply({ error: "Búsqueda temporalmente no disponible" }, 503);
    if (gate.cached) return reply({ places: gate.cached });
    if (gate.busy)
      return reply({ error: "Espera unos segundos y vuelve a buscar" }, 429);
    const ua = "MusMatch/0.1 (+https://github.com/DavidPerez3/musmatch)";
    let places;
    if (nearby) {
      const query = `[out:json][timeout:15];nwr[amenity~"^(bar|pub|cafe)$"](around:1500,${latitude},${longitude});out center 40;`;
      const r = await fetch(
        Deno.env.get("OVERPASS_URL") ||
          "https://overpass-api.de/api/interpreter",
        {
          method: "POST",
          headers: {
            "User-Agent": ua,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!r.ok) throw new Error("Provider");
      const data = await r.json();
      if (data.remark) throw new Error("Incomplete provider result");
      places = (data.elements || [])
        .filter((e: { tags?: { name?: string } }) => e.tags?.name)
        .map(
          (e: {
            type: string;
            id: number;
            lat?: number;
            lon?: number;
            center?: { lat: number; lon: number };
            tags: Record<string, string>;
          }) => ({
            name: e.tags.name,
            address: [
              e.tags.name,
              e.tags["addr:street"],
              e.tags["addr:housenumber"],
              e.tags["addr:city"],
            ]
              .filter(Boolean)
              .join(", "),
            latitude: e.lat ?? e.center?.lat,
            longitude: e.lon ?? e.center?.lon,
            osm_ref: `${e.type}/${e.id}`,
          }),
        );
    } else {
      const url = new URL(
        Deno.env.get("NOMINATIM_URL") ||
          "https://nominatim.openstreetmap.org/search",
      );
      url.search = new URLSearchParams({
        q,
        format: "jsonv2",
        limit: "8",
        "accept-language": "es",
        countrycodes: "es",
      }).toString();
      const r = await fetch(url, {
        headers: { "User-Agent": ua },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error("Provider");
      const data = await r.json();
      places = data.map(
        (e: {
          name?: string;
          display_name: string;
          lat: string;
          lon: string;
          osm_type: string;
          osm_id: number;
        }) => ({
          name: e.name || e.display_name.split(",")[0],
          address: e.display_name,
          latitude: Number(e.lat),
          longitude: Number(e.lon),
          osm_ref: `${e.osm_type}/${e.osm_id}`,
        }),
      );
    }
    places = places.filter(
      (p: { latitude: number; longitude: number }) =>
        Number.isFinite(p.latitude) && Number.isFinite(p.longitude),
    );
    await client
      .from("place_search_cache")
      .upsert({
        cache_key: key,
        results: places,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      });
    return reply({ places });
  } catch {
    return reply(
      {
        error:
          "No se ha podido consultar el mapa. Puedes indicar el lugar manualmente.",
      },
      503,
    );
  }
});
