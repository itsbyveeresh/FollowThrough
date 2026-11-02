import Link from "next/link";
import type { Metadata } from "next";
import { loadPage } from "@/server/page";
import { listOpenTasks } from "@/server/services/tasks";
import { groupForToday, TODAY_SECTION_HINTS, TODAY_SECTION_TITLES, type TodaySection } from "@/lib/domain/today";
import { TaskList } from "@/components/tasks/TaskRow";
import { EmptyState, PageHeader, Section } from "@/components/app/PageHeader";
import { formatDate } from "@/lib/domain/format";
import { localDate } from "@/lib/domain/time";
import { AutoRefresh } from "@/components/app/AutoRefresh";

export const metadata: Metadata = { title: "Today" };

const ORDER: TodaySection[] = ["overdue", "follow_up_today", "due_today", "needs_planning", "upcoming"];

export default async function TodayPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const data = await loadPage(async ({ tx, profile, now }) => {
    const tasks = await listOpenTasks(tx);
    const [missed] = await tx`
      select count(*)::int as n from ft.reminders
       where status = 'missed' and task_id is not null and finished_at > ${new Date(now.getTime() - 24 * 3600_000)}`;
    const [devices] = await tx`select count(*) filter (where enabled)::int as n from ft.push_subscriptions`;
    return { tasks, profile, now, missed: missed.n as number, devices: devices.n as number };
  });
  const { sections, counts } = groupForToday(data.tasks, data.profile, data.now);
  const todayLabel = formatDate(localDate(data.now, data.profile.timezone), data.profile, data.now);
  const nothing = ORDER.every((k) => sections[k].length === 0);

  const stats = [
    { label: "Overdue", value: counts.overdue, href: "/tasks?overdue=1", tone: counts.overdue ? "text-danger" : "" },
    { label: "Follow-ups today", value: counts.followUpsToday, href: "#follow_up_today", tone: "" },
    { label: "Waiting on others", value: counts.waitingOn, href: "/waiting", tone: "" },
    { label: "In inbox", value: counts.inbox, href: "/inbox", tone: "" },
  ];

  return (
    <>
      <AutoRefresh />
      <PageHeader title="Today" subtitle={todayLabel} />
      {sp.welcome ? (
        <div className="mb-4 rounded-xl border border-accent/30 bg-accent-soft p-4 text-sm">
          Welcome to FollowThrough. Add your first task with the <strong>+</strong> button, then{" "}
          <Link className="font-medium text-accent underline" href="/settings/notifications">
            enable mobile reminders
          </Link>
          .
        </div>
      ) : null}
      {data.missed > 0 ? (
        <div className="mb-4 rounded-xl border border-warn/40 bg-warn-soft p-3 text-sm">
          {data.missed} reminder{data.missed === 1 ? "" : "s"} could not be sent on time in the last 24 hours. The tasks are still listed below.{" "}
          <Link className="font-medium underline" href="/settings/notifications#history">
            See reminder history
          </Link>
        </div>
      ) : null}
      {data.devices === 0 && !data.profile.isDemo ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3 text-sm">
          <span>Reminders aren&apos;t reaching any device yet.</span>
          <Link className="font-medium text-accent underline" href="/settings/notifications">
            Enable mobile reminders
          </Link>
        </div>
      ) : null}

      <dl className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="rounded-xl border border-border bg-surface px-4 py-3 hover:bg-surface-2">
            <dt className="text-xs text-muted">{s.label}</dt>
            <dd className={`text-2xl font-semibold ${s.tone}`}>{s.value}</dd>
          </Link>
        ))}
      </dl>

      {nothing ? (
        <EmptyState title="Nothing needs your attention today">
          Follow-ups and deadlines you add will appear here on the right day.
        </EmptyState>
      ) : (
        <>
          <p className="mb-4 text-xs text-muted">Each task appears once, in its most urgent group.</p>
          {ORDER.filter((k) => sections[k].length).map((k) => (
            <Section key={k} id={k} title={TODAY_SECTION_TITLES[k]} hint={TODAY_SECTION_HINTS[k]} count={sections[k].length}>
              <TaskList tasks={sections[k]} showStatus={k === "needs_planning" || k === "upcoming"} />
            </Section>
          ))}
        </>
      )}
    </>
  );
}
