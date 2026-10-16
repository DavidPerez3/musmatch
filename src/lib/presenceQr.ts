// A data-only payload, never an external URL to navigate to. No identity or session tokens.
export function presenceQrPayload(eventId: string, token: string) {
  return `musmatch:presence:v1:${eventId}:${token}`;
}
export function readPresenceQr(raw: string, eventId: string): string {
  const match =
    /^musmatch:presence:v1:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([A-Z0-9]{6})$/i.exec(
      raw,
    );
  if (!match)
    throw new Error("Este QR no es un código de presencia de MusMatch.");
  if (match[1].toLowerCase() !== eventId.toLowerCase())
    throw new Error("Este QR pertenece a otra partida.");
  return match[2].toUpperCase();
}
