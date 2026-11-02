import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/AuthForms";
import { safeNextPath } from "@/lib/next-path";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  const notice = sp.error === "link_invalid"
    ? "That link is invalid or has expired. Sign in, or request a new link."
    : sp.signedOut
      ? "You're signed out. Reminders for that account no longer go to this device."
      : next !== "/today"
        ? "Sign in to continue to the page you opened."
        : undefined;
  return <SignInForm next={next} notice={notice} />;
}
