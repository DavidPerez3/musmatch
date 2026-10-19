import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
const source = await readFile(
  "supabase/functions/place-search/index.ts",
  "utf8",
);
function endpoint({
  authenticated = true,
  gate = {},
  providerError = false,
} = {}) {
  let handler;
  const calls = [],
    writes = [];
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: authenticated ? { id: "test-user" } : null },
        error: authenticated ? null : { message: "Denied" },
      }),
    },
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: gate, error: null };
    },
    from: () => ({
      upsert: async (value) => {
        writes.push(value);
        return { error: null };
      },
    }),
  };
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(code, {
    exports: {},
    require: () => ({ createClient: () => client }),
    Deno: {
      env: {
        get: (key) =>
          ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].includes(key)
            ? "test-value"
            : undefined,
      },
      serve: (fn) => {
        handler = fn;
      },
    },
    Request,
    Response,
    URL,
    URLSearchParams,
    AbortSignal,
    Set,
    Date,
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });
      if (providerError) throw new Error("private-provider-details");
      return new Response(
        JSON.stringify(
          String(url).includes("overpass")
            ? {
                elements: [
                  {
                    id: 1,
                    type: "node",
                    lat: 42.85,
                    lon: -2.67,
                    tags: { name: "Bar sintético" },
                  },
                ],
              }
            : [
                {
                  name: "Bar sintético",
                  display_name: "Bar sintético, Vitoria",
                  lat: "42.85",
                  lon: "-2.67",
                  osm_type: "node",
                  osm_id: 1,
                },
              ],
        ),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  });
  return {
    request: async (body = {}, extra = {}) =>
      handler(
        new Request("https://test.invalid/place-search", {
          method: "POST",
          headers: {
            origin: "https://davidperez3.github.io",
            authorization: "Bearer synthetic",
            ...extra,
          },
          body: JSON.stringify(body),
        }),
      ),
    calls,
    writes,
  };
}
test("place search requires authenticated callers and valid inputs", async () => {
  let e = endpoint({ authenticated: false });
  assert.equal((await e.request({ query: "bar test" })).status, 401);
  assert.equal(e.calls.length, 0);
  e = endpoint();
  assert.equal((await e.request({ query: "ab" })).status, 400);
  assert.equal(
    (await e.request({ mode: "nearby", latitude: null, longitude: 0 })).status,
    400,
  );
  assert.equal(
    (await e.request({ mode: "nearby", latitude: 91, longitude: 0 })).status,
    400,
  );
  assert.equal(
    (await e.request({ query: "bar test" }, { origin: "https://evil.invalid" }))
      .status,
    403,
  );
  assert.equal(e.calls.length, 0);
});
test("name search uses global throttle, identifiable request and cache", async () => {
  const e = endpoint(),
    r = await e.request({ query: "Bar sintético Vitoria" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).places[0].osm_ref, "node/1");
  assert.equal(e.calls[0].name, "claim_place_search");
  assert.ok(
    e.calls[1].url.startsWith("https://nominatim.openstreetmap.org/search?"),
  );
  assert.ok(e.calls[1].options.headers["User-Agent"].includes("MusMatch/"));
  assert.equal(e.writes.length, 1);
});
test("nearby searches quantize coordinates with bounded radius and categories", async () => {
  const e = endpoint(),
    r = await e.request({
      mode: "nearby",
      latitude: 42.85123456,
      longitude: -2.67123456,
    });
  assert.equal(r.status, 200);
  assert.equal(e.calls[0].args.p_key, "near:42.851,-2.671");
  const query = e.calls[1].options.body.get("data");
  assert.ok(query.includes("around:1500,42.851,-2.671"));
  assert.ok(query.includes("bar|pub|cafe"));
  assert.equal((await r.json()).places.length, 1);
});
test("cache, rate limits and provider errors retain a safe manual fallback", async () => {
  let e = endpoint({ gate: { cached: [{ name: "Cached" }] } }),
    r = await e.request({ query: "Bar test" });
  assert.equal((await r.json()).places[0].name, "Cached");
  assert.equal(e.calls.length, 1);
  e = endpoint({ gate: { busy: true } });
  r = await e.request({ query: "Bar test" });
  assert.equal(r.status, 429);
  assert.equal(e.calls.length, 1);
  e = endpoint({ providerError: true });
  r = await e.request({ query: "Bar test" });
  assert.equal(r.status, 503);
  assert.ok(!(await r.text()).includes("private-provider-details"));
});
