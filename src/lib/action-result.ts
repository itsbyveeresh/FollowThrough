export type ActionResult<T = null> =
  | { ok: true; data: T; notices?: string[] }
  | { ok: false; error: string; fields?: Record<string, string>; code?: string };
