import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ConfigError, serverConfig } from "./env";

/** Supabase client for Server Components, Server Actions and Route Handlers (one per request). */
export async function supabaseServer() {
  const cfg = serverConfig();
  if (!cfg.supabaseUrl) throw new ConfigError("NEXT_PUBLIC_SUPABASE_URL");
  if (!cfg.supabaseKey) throw new ConfigError("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const cookieStore = await cookies();
  return createServerClient(cfg.supabaseUrl, cfg.supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there. The proxy refreshes sessions.
        }
      },
    },
  });
}
