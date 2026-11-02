import type { Metadata } from "next";
import Link from "next/link";
import { loadPage } from "@/server/page";
import { listDevices, reminderHistory } from "@/server/services/devices";
import { loadHealthFacts } from "@/server/services/health";
import { PageHeader, Section } from "@/components/app/PageHeader";
import { EnableReminders } from "@/components/push/EnableReminders";
import { DeviceList } from "@/components/push/DeviceList";
import { HealthPanel } from "@/components/push/HealthPanel";
import { ReminderHistory } from "@/components/push/ReminderHistory";
import { AutoRefresh } from "@/components/app/AutoRefresh";

export const metadata: Metadata = { title: "Notifications & devices" };

export default async function NotificationsPage() {
  const d = await loadPage(async ({ tx, userId }) => ({
    facts: await loadHealthFacts(tx, userId),
    devices: await listDevices(tx),
    history: await reminderHistory(tx, 60),
  }));
  return (
    <>
      <AutoRefresh everyMs={60_000} />
      <PageHeader title="Notifications & devices" subtitle={<Link href="/settings" className="underline">Back to settings</Link>} />
      <Section title="Status">
        <HealthPanel facts={d.facts} />
      </Section>
      <Section title="Enable mobile reminders" hint="Do this once on each phone or computer that should receive reminders.">
        <EnableReminders />
      </Section>
      <Section title="Your devices" count={d.devices.length}>
        <DeviceList devices={d.devices} />
      </Section>
      <Section id="history" title="Reminder history" hint="“Accepted by push service” means Apple/Google/Mozilla took the message for delivery. It does not prove the phone showed it.">
        <ReminderHistory reminders={d.history.reminders} attempts={d.history.attempts} />
      </Section>
      <Section id="troubleshooting" title="If notifications don't arrive">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>iPhone/iPad: open FollowThrough from the Home Screen icon (not a Safari tab) and enable reminders there. iOS 16.4 or later is required.</li>
          <li>Check that Focus / Do Not Disturb isn&apos;t silencing FollowThrough, and that notifications are allowed in the phone&apos;s Settings.</li>
          <li>Android: battery saver or “sleeping apps” can delay notifications from the browser. Allow Chrome to run in the background.</li>
          <li>The phone needs a network connection; messages wait at the push service (up to about 12 hours) until it reconnects.</li>
          <li>If the status above says “Scheduler not running”, reminders are queued but not being sent — see the setup guide, step 7.</li>
          <li>Still stuck? See docs/TROUBLESHOOTING.md.</li>
        </ul>
      </Section>
    </>
  );
}
