import { NextResponse } from "next/server";
import { ensureInternalApiAuth, jsonError } from "@/lib/server/internalApi";
import { callInternalRpc } from "@/lib/server/internalRpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateTokenPayload = {
  actor_user_id: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const unauthorized = ensureInternalApiAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await context.params;
    const body = (await request.json()) as CreateTokenPayload;
    const data = await callInternalRpc<Record<string, unknown>>(
      "internal_create_presence_token",
      {
        p_actor_user_id: body.actor_user_id,
        p_event_id: id,
      }
    );
    return NextResponse.json(data);
  } catch (error) {
    return jsonError(error);
  }
}
