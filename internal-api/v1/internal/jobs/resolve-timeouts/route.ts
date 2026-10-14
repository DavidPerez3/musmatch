import { NextResponse } from "next/server";
import { ensureInternalApiAuth, jsonError } from "@/lib/server/internalApi";
import { callInternalRpc } from "@/lib/server/internalRpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = ensureInternalApiAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const affected = await callInternalRpc<number>("internal_resolve_timeouts");
    return NextResponse.json({ resolved_matches: affected });
  } catch (error) {
    return jsonError(error);
  }
}
