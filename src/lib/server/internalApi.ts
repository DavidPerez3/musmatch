import { NextResponse } from "next/server";

export const INTERNAL_API_HEADER = "x-internal-api-key";

function getInternalApiKey() {
  return process.env.INTERNAL_API_KEY ?? "";
}

export function ensureInternalApiAuth(request: Request): NextResponse | null {
  const expected = getInternalApiKey().trim();
  if (!expected) {
    return NextResponse.json(
      { error: "INTERNAL_API_KEY_NOT_CONFIGURED" },
      { status: 500 }
    );
  }

  const provided = request.headers.get(INTERNAL_API_HEADER)?.trim();
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  return null;
}

export function jsonError(error: unknown, fallback = "INTERNAL_ERROR") {
  const message =
    error instanceof Error && error.message ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 400 });
}
