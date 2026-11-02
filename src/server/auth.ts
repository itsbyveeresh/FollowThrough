import "server-only";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { supabaseServer } from "./supabase";
import { serverConfig } from "./env";

export interface SessionUser {
  id: string;
  email: string | null;
}

/** The verified signed-in user, or null. Uses getClaims(), which validates the JWT. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { id: data.claims.sub, email: (data.claims.email as string | undefined) ?? null };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Absolute origin for auth email links. Prefers NEXT_PUBLIC_SITE_URL. */
export async function siteOrigin(): Promise<string> {
  const configured = serverConfig().siteUrl;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
