import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/server/supabase";
import { safeNextPath } from "@/lib/next-path";

/**
 * Email link landing (sign-up confirmation, password recovery, email change).
 * Works on any device because it uses the token hash from the email template,
 * not a PKCE verifier stored in the original browser.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"), "/today");
  const supabase = await supabaseServer();
  let ok = false;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }
  const dest = ok ? next : `/login?error=link_invalid`;
  const res = NextResponse.redirect(new URL(dest, request.url));
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
