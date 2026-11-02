"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/server/supabase";
import { siteOrigin } from "@/server/auth";
import { safeNextPath } from "@/lib/next-path";
import { ConfigError } from "@/server/env";

export type AuthState = { error?: string; message?: string; fields?: Record<string, string> } | null;

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(320);
const password = z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters");

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (m.includes("email not confirmed")) return "Please confirm your email address first — check your inbox for the link.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please wait a few minutes and try again.";
  if (m.includes("weak") || m.includes("password should")) return "That password is too weak. Use a longer passphrase.";
  if (m.includes("same") && m.includes("password")) return "Choose a password different from your current one.";
  if (m.includes("fetch failed") || m.includes("network")) return "Could not reach the sign-in service. Check your connection and try again.";
  return "Something went wrong. Please try again.";
}

async function client() {
  try {
    return await supabaseServer();
  } catch (e) {
    if (e instanceof ConfigError) return null;
    throw e;
  }
}

export async function signInAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const e = email.safeParse(form.get("email"));
  const p = z.string().min(1, "Enter your password").safeParse(form.get("password"));
  if (!e.success || !p.success)
    return { fields: { ...(e.success ? {} : { email: e.error.issues[0].message }), ...(p.success ? {} : { password: p.error.issues[0].message }) } };
  const supabase = await client();
  if (!supabase) return { error: "Sign-in is not configured on this server yet. See the setup guide." };
  const { error } = await supabase.auth.signInWithPassword({ email: e.data, password: p.data });
  if (error) return { error: friendly(error.message) };
  redirect(safeNextPath(form.get("next") as string | null));
}

export async function signUpAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const e = email.safeParse(form.get("email"));
  const p = password.safeParse(form.get("password"));
  if (!e.success || !p.success)
    return { fields: { ...(e.success ? {} : { email: e.error.issues[0].message }), ...(p.success ? {} : { password: p.error.issues[0].message }) } };
  if (form.get("password") !== form.get("confirm")) return { fields: { confirm: "Passwords do not match" } };
  const supabase = await client();
  if (!supabase) return { error: "Sign-up is not configured on this server yet. See the setup guide." };
  const origin = await siteOrigin();
  const { data, error } = await supabase.auth.signUp({
    email: e.data,
    password: p.data,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=/today` },
  });
  if (error) return { error: friendly(error.message) };
  if (data.session) redirect("/today?welcome=1");
  // Same message whether or not the address already has an account (no account enumeration).
  return { message: "Check your email for a confirmation link, then sign in." };
}

export async function requestPasswordResetAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const e = email.safeParse(form.get("email"));
  if (!e.success) return { fields: { email: e.error.issues[0].message } };
  const supabase = await client();
  if (!supabase) return { error: "Password reset is not configured on this server yet." };
  const origin = await siteOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(e.data, { redirectTo: `${origin}/auth/confirm?next=/reset-password` });
  if (error && /rate limit|too many/i.test(error.message)) return { error: friendly(error.message) };
  return { message: "If an account exists for that email, a reset link is on its way." };
}

export async function updatePasswordAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const p = password.safeParse(form.get("password"));
  if (!p.success) return { fields: { password: p.error.issues[0].message } };
  if (form.get("password") !== form.get("confirm")) return { fields: { confirm: "Passwords do not match" } };
  const supabase = await client();
  if (!supabase) return { error: "Not configured." };
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { error: "Your reset link has expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password: p.data });
  if (error) return { error: friendly(error.message) };
  redirect("/today?passwordUpdated=1");
}

/** Ends the session on this device. The client removes this device's push subscription first. */
export async function signOutAction(): Promise<{ ok: boolean }> {
  const supabase = await client();
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  return { ok: true };
}
