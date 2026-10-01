import { NextResponse } from "next/server";
import { ensureInternalApiAuth, jsonError } from "@/lib/server/internalApi";
import { callInternalRpc } from "@/lib/server/internalRpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubmitResultPayload = {
  actor_user_id: string;
  winner_team: "A" | "B";
  result_score: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const unauthorized = ensureInternalApiAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await context.params;
    const body = (await request.json()) as SubmitResultPayload;
    const status = await callInternalRpc<string>("internal_submit_team_result", {
      p_actor_user_id: body.actor_user_id,
      p_match_id: id,
      p_winner_team: body.winner_team,
      p_result_score: body.result_score,
    });

    return NextResponse.json({ status });
  } catch (error) {
    return jsonError(error);
  }
}
