import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath, safeNextPath } from "@/lib/next-path";

/**
 * Refreshes the Supabase session cookie on every request and gates the app:
 * signed-out visitors are sent to /login?next=<original path> so they land where
 * they meant to go (e.g. a task opened from a notification) after signing in.
 */
export async function proxy(request: NextRequest) {
  // Read at runtime (dynamic keys are not inlined at build time).
  const env = process.env as Record<string, string | undefined>;
  const url = env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] ?? env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  const dbUrl = env["DATABASE_URL"];
  const path = request.nextUrl.pathname;

  if (!url || !key || !dbUrl) {
    if (path === "/setup" || path.startsWith("/api/")) return NextResponse.next();
    return NextResponse.rewrite(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  let signedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = !!data?.claims?.sub;
  } catch {
    signedIn = false;
  }

  const withCookies = (res: NextResponse) => {
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  };

  if (!signedIn && !isPublicPath(path)) {
    if (path.startsWith("/api/")) return withCookies(NextResponse.json({ error: "not_authenticated" }, { status: 401 }));
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", path + request.nextUrl.search);
    return withCookies(NextResponse.redirect(login));
  }
  if (path === "/") return withCookies(NextResponse.redirect(new URL(signedIn ? "/today" : "/login", request.url)));
  if (signedIn && (path === "/login" || path === "/signup")) {
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    return withCookies(NextResponse.redirect(new URL(next, request.url)));
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, the service worker, icons, manifest and the cron endpoint.
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/|offline.html|api/dispatch).*)",
  ],
};
