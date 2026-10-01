import { NextResponse } from "next/server";
import { ensureInternalApiAuth, jsonError } from "@/lib/server/internalApi";
import { callInternalRpc } from "@/lib/server/internalRpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const unauthorized = ensureInternalApiAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await context.params;
    const event = await callInternalRpc<Record<string, unknown>>(
      "internal_get_event",
      {
        p_event_id: id,
      }
    );

    return NextResponse.json({ event });
  } catch (error) {
    return jsonError(error);
  }
}
