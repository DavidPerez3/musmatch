import { NextResponse } from "next/server";
import { ensureInternalApiAuth, jsonError } from "@/lib/server/internalApi";
import { callInternalRpc } from "@/lib/server/internalRpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AddParticipantPayload = {
  user_id: string;
  team?: "A" | "B" | null;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const unauthorized = ensureInternalApiAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await context.params;
    const body = (await request.json()) as AddParticipantPayload;
    await callInternalRpc<void>("internal_add_participant", {
      p_event_id: id,
      p_user_id: body.user_id,
      p_team: body.team ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
