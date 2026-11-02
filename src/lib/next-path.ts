/**
 * Validate a post-login destination. Only same-origin relative paths are allowed
 * (prevents open redirects like "//evil.example" or "https://…").
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/today"): string {
  if (!raw || typeof raw !== "string") return fallback;
  let value = raw.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (value.length > 500) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  const pathOnly = value.split(/[?#]/)[0];
  if (["/login", "/signup", "/forgot-password", "/auth/confirm", "/auth/callback"].includes(pathOnly)) return fallback;
  return value;
}

/** Paths that do not require a signed-in user. */
export const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/auth/", "/setup", "/offline", "/privacy"];

export function isPublicPath(pathname: string): boolean {
  return pathname === "/" || PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));
}
