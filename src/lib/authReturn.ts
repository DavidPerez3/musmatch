// A small allowlist, not an arbitrary URL redirect. Never accept a foreign origin,
// encoded separators, duplicate parameters, or backend/admin paths.
export function safeReturnPath(value: string | null): string | null {
  if (typeof value !== "string" || !value) return null;
  if (value === "/create/" || value === "/?buscar=1#partidas") return value;
  const match = /^\/events\/\?id=([a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})$/i.exec(value);
  return match ? `/events/?id=${match[1]}` : null;
}
const key = "musmatch-auth-return";
export function rememberAuthReturn(path: string | null) {
  try {
    sessionStorage.removeItem(key);
    const safe = safeReturnPath(path);
    if (safe) sessionStorage.setItem(key, JSON.stringify({path:safe, expires:Date.now()+30*60*1000}));
  } catch { /* Login still works if browser storage is disabled. */ }
}
export function consumeAuthReturn(): string | null {
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return typeof saved.expires === "number" && saved.expires > Date.now() ? safeReturnPath(saved.path) : null;
  } catch { return null; }
}
