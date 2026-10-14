import { NextResponse } from "next/server";
import { ensureInternalApiAuth, jsonError } from "@/lib/server/internalApi";
import { callInternalRpc } from "@/lib/server/internalRpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateEventPayload = {
  actor_user_id: string;
  title?: string;
  match_type: "FRIENDLY" | "COMPETITIVE";
  pair_mode: "FIXED_PAIR" | "NEED_PARTNER";
  starts_at: string;
  location_text?: string | null;
  notes?: string | null;
};

export async function POST(request: Request) {
  const unauthorized = ensureInternalApiAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json()) as CreateEventPayload;
    const eventId = await callInternalRpc<string>("internal_create_event", {
      p_actor_user_id: body.actor_user_id,
      p_title: body.title ?? "Partida de mus",
      p_match_type: body.match_type,
      p_pair_mode: body.pair_mode,
      p_starts_at: body.starts_at,
      p_location_text: body.location_text ?? null,
      p_notes: body.notes ?? null,
    });

    return NextResponse.json({ event_id: eventId });
  } catch (error) {
    return jsonError(error);
  }
}
