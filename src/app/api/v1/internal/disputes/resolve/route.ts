import { NextResponse } from "next/server";
import { ensureInternalApiAuth, jsonError } from "@/lib/server/internalApi";
import { callInternalRpc } from "@/lib/server/internalRpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResolveDisputePayload = {
  admin_user_id: string;
  match_id: string;
  winner_team: "A" | "B";
  apply_elo?: boolean;
};

export async function POST(request: Request) {
  const unauthorized = ensureInternalApiAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json()) as ResolveDisputePayload;
    await callInternalRpc<void>("internal_admin_resolve_dispute", {
      p_admin_user_id: body.admin_user_id,
      p_match_id: body.match_id,
      p_winner_team: body.winner_team,
      p_apply_elo: body.apply_elo ?? true,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
