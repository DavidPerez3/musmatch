import { createClient } from "npm:@supabase/supabase-js@2.89.0";
import webpush from "npm:web-push@3.6.7";

// No public send endpoint: only the scheduler's independent secret is accepted.
const pushHosts =
  /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
function validEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      pushHosts.test(url.hostname)
    );
  } catch {
    return false;
  }
}
const messages: Record<string, string> = {
  invitations: "Tienes novedades sobre una invitación a jugar.",
  matches: "Hay cambios en una de tus partidas.",
  results: "Hay novedades sobre el resultado de tu partida.",
  reminders: "Tu partida empieza en menos de una hora.",
  friends: "Tienes novedades en tus amistades.",
  test: "Las notificaciones de MusMatch funcionan en este dispositivo.",
};
type Job = {
  id: string;
  lease_token: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  notification_id: string;
  event_id: string | null;
  category: string;
};
Deno.serve(async (req: Request) => {
  const reply = (status: number, data: object) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
  const token = req.headers.get("x-dispatch-token");
  if (!token || token.length < 64) return reply(401, { error: "Unauthorized" });
  try {
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: runtime, error: cfgError } = await client.rpc(
      "push_runtime_config",
    );
    if (cfgError || !runtime || token !== runtime.dispatch_token)
      return reply(401, { error: "Unauthorized" });
    if (!runtime.enabled) return reply(200, { disabled: true });
    if (!runtime.public_key) {
      const keys = webpush.generateVAPIDKeys();
      const { error } = await client.rpc("initialize_push_runtime", {
        p_public_key: keys.publicKey,
        p_private_key: keys.privateKey,
      });
      if (error) throw new Error("Initialization failed");
      // Re-read the winner's keys if two schedulers initialized concurrently.
      const result = await client.rpc("push_runtime_config");
      if (result.error || !result.data?.private_key)
        throw new Error("Initialization unavailable");
      Object.assign(runtime, result.data);
    }
    if (!runtime.private_key) throw new Error("Signing key unavailable");
    const { data, error } = await client.rpc("claim_push_batch", {
      p_limit: 30,
    });
    if (error) throw new Error("Queue unavailable");
    const jobs: Job[] = data || [];
    if (!jobs.length) {
      // Check encryption/signing in the deployed Deno runtime without contacting a provider.
      const probe = webpush.generateRequestDetails(
        {
          endpoint: "https://fcm.googleapis.com/fcm/send/local-crypto-probe",
          keys: { p256dh: runtime.public_key, auth: "AAAAAAAAAAAAAAAAAAAAAA" },
        },
        "{}",
        {
          vapidDetails: {
            subject: "https://davidperez3.github.io/musmatch/",
            publicKey: runtime.public_key,
            privateKey: runtime.private_key,
          },
        },
      );
      if (!probe.body?.length) throw new Error("Encryption unavailable");
    }
    let accepted = 0,
      failed = 0;
    for (let offset = 0; offset < jobs.length; offset += 5) {
      await Promise.all(
        jobs.slice(offset, offset + 5).map(async (job) => {
          let status = 400;
          if (validEndpoint(job.endpoint)) {
            try {
              const details = webpush.generateRequestDetails(
                { endpoint: job.endpoint, keys: job.keys },
                JSON.stringify({
                  title: "MusMatch",
                  body:
                    messages[job.category] ||
                    "Tienes un nuevo aviso en MusMatch.",
                  notificationId: job.notification_id,
                  eventId: job.event_id,
                  category: job.category,
                }),
                {
                  TTL: 3600,
                  urgency: "normal",
                  vapidDetails: {
                    subject: "https://davidperez3.github.io/musmatch/",
                    publicKey: runtime.public_key,
                    privateKey: runtime.private_key,
                  },
                },
              );
              const response = await fetch(details.endpoint, {
                method: "POST",
                headers: details.headers,
                body: new Uint8Array(details.body!),
                redirect: "manual",
                signal: AbortSignal.timeout(8000),
              });
              // Never follow push-provider redirects, including to private infrastructure.
              status =
                response.status >= 300 && response.status < 400
                  ? 400
                  : response.status;
              await response.body?.cancel();
            } catch {
              status = 503;
            }
          }
          const done = await client.rpc("finish_push_delivery", {
            p_id: job.id,
            p_lease_token: job.lease_token,
            p_status: status,
          });
          if (done.error) throw new Error("Queue acknowledgement failed");
          if (status >= 200 && status < 300) accepted++;
          else failed++;
        }),
      );
    }
    return reply(200, { processed: jobs.length, accepted, failed });
  } catch {
    // Never log endpoint URLs, subscription keys, JWTs or VAPID secrets.
    console.error(
      "MusMatch push dispatcher failed; unacknowledged leases will retry",
    );
    return reply(503, { error: "Push temporarily unavailable" });
  }
});
