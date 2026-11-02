/**
 * Reminder health: combines server facts (configuration, scheduler heartbeat,
 * devices, delivery attempts) with browser facts (permission, subscription) into
 * plain-language statuses. Pure so it can be tested and rendered anywhere.
 */

export type SchedulerState = "not_configured" | "stale" | "failing" | "healthy";

export interface SchedulerFacts {
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastOk: boolean | null;
  lastErrorAt: Date | null;
}

export function schedulerState(f: SchedulerFacts, now: Date): SchedulerState {
  if (!f.lastStartedAt) return "not_configured";
  if (now.getTime() - f.lastStartedAt.getTime() > 3 * 60_000) return "stale";
  if (f.lastOk === false) return "failing";
  return "healthy";
}

export type HealthLevel = "ok" | "warning" | "problem" | "info";

export interface HealthItem {
  id: string;
  level: HealthLevel;
  title: string;
  detail: string;
}

export interface HealthInput {
  now: Date;
  isDemo: boolean;
  missingConfig: string[];
  pushConfigured: boolean;
  scheduler: SchedulerFacts;
  enabledDevices: number;
  totalDevices: number;
  lastAcceptedAt: Date | null;
  recentFailures: number;
  /** Browser facts; undefined when rendered on the server. */
  browser?: {
    supported: boolean;
    permission: "granted" | "denied" | "default" | "unsupported";
    subscribedHere: boolean;
    registeredToThisAccount: boolean;
    standalone: boolean;
    iosNeedsInstall: boolean;
  };
}

export function reminderHealth(h: HealthInput): HealthItem[] {
  const items: HealthItem[] = [];
  if (h.isDemo) {
    items.push({
      id: "demo",
      level: "info",
      title: "Demo account: reminders are off",
      detail: "This account holds fictional sample data. Push reminders are never sent for demo accounts.",
    });
    return items;
  }
  if (h.missingConfig.length || !h.pushConfigured) {
    items.push({
      id: "config",
      level: "problem",
      title: "Server setup incomplete",
      detail: `Missing: ${h.missingConfig.join(", ") || "VAPID keys"}. See docs/SETUP.md.`,
    });
  }
  const s = schedulerState(h.scheduler, h.now);
  if (s === "not_configured")
    items.push({
      id: "scheduler",
      level: "problem",
      title: "Scheduler not configured",
      detail: "No dispatcher run has ever been recorded. Set up the Supabase Cron job (docs/SETUP.md, step 7).",
    });
  else if (s === "stale")
    items.push({
      id: "scheduler",
      level: "problem",
      title: "Scheduler not running",
      detail: "The dispatcher has not run in the last few minutes. Reminders are queued and will be sent (or summarized) when it recovers.",
    });
  else if (s === "failing")
    items.push({
      id: "scheduler",
      level: "warning",
      title: "Recent dispatch failure",
      detail: "The last dispatcher run reported an error. It retries every minute; check the reminder history below.",
    });
  else items.push({ id: "scheduler", level: "ok", title: "Scheduler healthy", detail: "The dispatcher ran in the last few minutes." });

  if (h.enabledDevices === 0)
    items.push({
      id: "devices",
      level: "problem",
      title: "No subscribed device",
      detail: h.totalDevices ? "All your devices are turned off or expired. Enable reminders on a device." : "Enable reminders on your phone to receive push notifications.",
    });
  else
    items.push({
      id: "devices",
      level: "ok",
      title: `${h.enabledDevices} device${h.enabledDevices === 1 ? "" : "s"} subscribed`,
      detail: "Reminders are sent to every enabled device.",
    });

  if (h.browser) {
    const b = h.browser;
    if (!b.supported && b.iosNeedsInstall)
      items.push({
        id: "browser",
        level: "warning",
        title: "Install to Home Screen first",
        detail: "On iPhone and iPad, notifications only work after adding FollowThrough to the Home Screen and opening it from there.",
      });
    else if (!b.supported)
      items.push({ id: "browser", level: "warning", title: "This browser can't receive push", detail: "Use a current Chrome, Edge, Firefox or Safari." });
    else if (b.permission === "denied")
      items.push({
        id: "browser",
        level: "problem",
        title: "Notifications blocked",
        detail: "This browser blocks notifications for FollowThrough. Allow them in the browser or system settings, then reload.",
      });
    else if (b.subscribedHere && b.registeredToThisAccount)
      items.push({ id: "browser", level: "ok", title: "This device is subscribed", detail: "This browser will receive your reminders." });
    else
      items.push({ id: "browser", level: "info", title: "This device is not subscribed", detail: "Use “Enable reminders on this device”." });
  }

  if (h.lastAcceptedAt)
    items.push({
      id: "accepted",
      level: "ok",
      title: "Push service accepted the latest message",
      detail: `Accepted ${h.lastAcceptedAt.toISOString()}. Acceptance means the browser's push service took the message; it does not prove the phone displayed it.`,
    });
  if (h.recentFailures > 0)
    items.push({
      id: "failures",
      level: "warning",
      title: `${h.recentFailures} failed delivery attempt${h.recentFailures === 1 ? "" : "s"} in the last 24 hours`,
      detail: "See the reminder history for details.",
    });
  return items;
}
