import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import webpush from "web-push";
import { createECDH, randomBytes } from "node:crypto";
const source = await readFile(
  "supabase/functions/push-dispatch/index.ts",
  "utf8",
);
const keys = webpush.generateVAPIDKeys(),
  ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const clientKeys = {
  p256dh: ecdh.getPublicKey().toString("base64url"),
  auth: randomBytes(16).toString("base64url"),
};
const token = "a".repeat(72);
function setup({
  jobs = [],
  status = 201,
  initialized = true,
  throwFetch = false,
  ackError = false,
} = {}) {
  let handler;
  const calls = [],
    requests = [],
    logs = [];
  const runtime = {
    enabled: true,
    dispatch_token: token,
    public_key: initialized ? keys.publicKey : null,
    private_key: initialized ? keys.privateKey : null,
  };
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === "push_runtime_config")
      return { data: { ...runtime }, error: null };
    if (name === "initialize_push_runtime") {
      runtime.public_key = args.p_public_key;
      runtime.private_key = args.p_private_key;
      return { data: null, error: null };
    }
    if (name === "claim_push_batch") return { data: jobs, error: null };
    return {
      data: null,
      error: ackError ? { message: "secret-database-error" } : null,
    };
  };
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(code, {
    exports: {},
    require: (n) =>
      n.includes("web-push") ? webpush : { createClient: () => ({ rpc }) },
    Deno: {
      env: { get: () => "server-only" },
      serve: (fn) => {
        handler = fn;
      },
    },
    Request,
    Response,
    URL,
    Uint8Array,
    AbortSignal,
    console: { error: (...x) => logs.push(x.join(" ")) },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (throwFetch) throw new Error("private-provider-token");
      return new Response(null, { status });
    },
  });
  return {
    calls,
    requests,
    logs,
    request: (secret = token, method = "POST") =>
      handler(
        new Request("https://server.test", {
          method,
          headers: secret ? { "x-dispatch-token": secret } : {},
        }),
      ),
  };
}
const job = (endpoint = "https://fcm.googleapis.com/fcm/send/synthetic") => ({
  id: "job-id",
  lease_token: "lease",
  endpoint,
  keys: clientKeys,
  notification_id: "10000000-0000-4000-8000-000000000001",
  event_id: "20000000-0000-4000-8000-000000000001",
  category: "results",
});
test("dispatcher rejects anonymous, bearer-only and incorrect secrets before claiming any jobs", async () => {
  for (const secret of [null, "Bearer user-jwt", "b".repeat(72)]) {
    const s = setup();
    assert.equal((await s.request(secret)).status, 401);
    assert.equal(
      s.calls.some((c) => c.name === "claim_push_batch"),
      false,
    );
  }
  const s = setup();
  assert.equal((await s.request(token, "GET")).status, 405);
});
test("real Web Push encryption and VAPID signing happen before a bounded, non-redirecting delivery", async () => {
  const s = setup({ jobs: [job()] });
  const r = await s.request();
  assert.equal(r.status, 200);
  assert.equal((await r.json()).accepted, 1);
  assert.equal(s.requests.length, 1);
  const { options } = s.requests[0];
  assert.equal(options.redirect, "manual");
  assert.equal(options.headers["Content-Encoding"], "aes128gcm");
  assert.match(options.headers.Authorization, /vapid/);
  assert.ok(options.body.byteLength > 80);
  assert.equal(
    Buffer.from(options.body).includes(Buffer.from("Tu partida")),
    false,
  );
  assert.equal(
    s.calls.find((c) => c.name === "finish_push_delivery").args.p_status,
    201,
  );
});
test("private signing key is initialized server-side once, never included in HTTP responses", async () => {
  const s = setup({ initialized: false });
  const r = await s.request();
  assert.equal(r.status, 200);
  assert.equal(
    s.calls.filter((c) => c.name === "initialize_push_runtime").length,
    1,
  );
  assert.doesNotMatch(await r.text(), /private_key|dispatch_token|public_key/);
});
test("invalid providers cannot cause SSRF and provider redirects are permanent failures", async () => {
  for (const endpoint of [
    "https://127.0.0.1/private",
    "https://fcm.googleapis.com@localhost/private",
    "https://fcm.googleapis.com.evil.test/x",
    "http://fcm.googleapis.com/x",
    "https://fcm.googleapis.com:444/x",
  ]) {
    const s = setup({ jobs: [job(endpoint)] });
    await s.request();
    assert.equal(s.requests.length, 0);
    assert.equal(
      s.calls.find((c) => c.name === "finish_push_delivery").args.p_status,
      400,
    );
  }
  const s = setup({ jobs: [job()], status: 302 });
  await s.request();
  assert.equal(
    s.calls.find((c) => c.name === "finish_push_delivery").args.p_status,
    400,
  );
});
test("gone subscriptions, throttling, transient errors and acknowledgement failures retain safe status codes", async () => {
  for (const status of [410, 429, 503]) {
    const s = setup({ jobs: [job()], status });
    await s.request();
    assert.equal(
      s.calls.find((c) => c.name === "finish_push_delivery").args.p_status,
      status,
    );
  }
  const s = setup({ jobs: [job()], throwFetch: true });
  await s.request();
  assert.equal(
    s.calls.find((c) => c.name === "finish_push_delivery").args.p_status,
    503,
  );
  const bad = setup({ jobs: [job()], ackError: true });
  const r = await bad.request();
  assert.equal(r.status, 503);
  assert.doesNotMatch(await r.text(), /secret|private-provider/);
  assert.doesNotMatch(bad.logs.join(""), /private-provider|secret-database/);
});
