import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/PageHeader";
import { Icon, type IconName } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "More" };

const LINKS: { href: string; label: string; hint: string; icon: IconName }[] = [
  { href: "/clients", label: "Clients & projects", hint: "Clients, projects and people", icon: "clients" },
  { href: "/settings/notifications", label: "Notifications & devices", hint: "Mobile reminders, tests, health", icon: "bell" },
  { href: "/settings", label: "Settings", hint: "Time zone, quiet hours, briefing, export, sign out", icon: "settings" },
  { href: "/trash", label: "Trash", hint: "Recover deleted tasks", icon: "trash" },
];

export default function MorePage() {
  return (
    <>
      <PageHeader title="More" />
      <ul className="overflow-hidden rounded-xl border border-border bg-surface">
        {LINKS.map((l) => (
          <li key={l.href} className="border-b border-border last:border-b-0">
            <Link href={l.href} className="flex min-h-16 items-center gap-3 px-4 hover:bg-surface-2">
              <Icon name={l.icon} className="h-6 w-6 text-muted" />
              <span className="flex-1">
                <span className="font-medium">{l.label}</span>
                <span className="block text-sm text-muted">{l.hint}</span>
              </span>
              <Icon name="arrow" className="h-4 w-4 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
