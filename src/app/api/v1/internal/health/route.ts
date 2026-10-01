import { NextResponse } from "next/server";
import { ensureInternalApiAuth, jsonError } from "@/lib/server/internalApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = ensureInternalApiAuth(request);
  if (unauthorized) return unauthorized;

  try {
    return NextResponse.json({
      ok: true,
      now: new Date().toISOString(),
      service: "musmatch-internal-api",
    });
  } catch (error) {
    return jsonError(error);
  }
}
