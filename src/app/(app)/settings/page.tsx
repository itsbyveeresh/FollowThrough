import Link from "next/link";
import type { Metadata } from "next";
import { loadPage } from "@/server/page";
import { PageHeader } from "@/components/app/PageHeader";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { SignOutButton } from "@/components/settings/SignOutButton";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { profile, email } = await loadPage(async ({ profile, email }) => ({ profile, email }));
  const zones = Intl.supportedValuesOf("timeZone");
  if (!zones.includes(profile.timezone)) zones.unshift(profile.timezone);
  if (!zones.includes("UTC")) zones.unshift("UTC");
  return (
    <>
      <PageHeader title="Settings" subtitle={email ?? undefined} />
      <Link
        href="/settings/notifications"
        className="mb-6 flex items-center justify-between rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 hover:bg-surface-2"
      >
        <span>
          <span className="font-semibold">Notifications &amp; devices</span>
          <span className="block text-sm text-muted">Enable mobile reminders, send a test, check scheduler health and reminder history.</span>
        </span>
        <Icon name="arrow" />
      </Link>
      <SettingsForm initial={profile} displayName={profile.displayName} timezones={zones} />
      <section className="mt-8 rounded-xl border border-border bg-surface p-4" aria-labelledby="data-h">
        <h2 id="data-h" className="font-semibold">
          Your data
        </h2>
        <p className="mt-1 text-sm text-muted">Download everything you have entered. Exports are generated on request and not stored.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="/api/export?format=csv" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 hover:bg-surface-2">
            <Icon name="download" /> Tasks (CSV)
          </a>
          <a href="/api/export?format=json" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 hover:bg-surface-2">
            <Icon name="download" /> Everything incl. history (JSON)
          </a>
          <Link href="/trash" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 hover:bg-surface-2">
            <Icon name="trash" /> Trash
          </Link>
        </div>
      </section>
      <section className="mt-6 rounded-xl border border-border bg-surface p-4" aria-labelledby="account-h">
        <h2 id="account-h" className="mb-3 font-semibold">
          Account
        </h2>
        <SignOutButton />
      </section>
    </>
  );
}
