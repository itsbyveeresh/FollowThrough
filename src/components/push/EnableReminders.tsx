"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, FormError, Notice } from "@/components/ui/controls";
import { Icon } from "@/components/ui/Icon";
import { useApp } from "@/components/app/AppContext";
import { useMutation } from "@/components/app/useMutation";
import { confirmDeviceAction } from "@/app/actions/settings";
import { detectCapabilities, pushSupported, sendTest, subscribeThisDevice, syncThisDevice, type PushCapabilities } from "@/lib/push-client";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type TestState =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "sent"; accepted: number; deviceId: string | null }
  | { phase: "failed"; message: string };

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <h3 className="mb-2 flex items-center gap-2 font-semibold">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${done ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted"}`}>
          {done ? <Icon name="check" className="h-4 w-4" /> : n}
        </span>
        {title}
      </h3>
      <div className="flex flex-col gap-3 text-[0.95rem]">{children}</div>
    </li>
  );
}

/**
 * Guided setup: detect capabilities → explain installation where required →
 * ask for permission only on a button press → register the device → send a
 * test → let the user confirm they saw it. Never re-prompts automatically.
 */
export function EnableReminders({ onChanged }: { onChanged?: () => void }) {
  const { vapidPublicKey, isDemo } = useApp();
  const router = useRouter();
  const [caps, setCaps] = useState<PushCapabilities | null>(null);
  const [registered, setRegistered] = useState<{ deviceId: string | null; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ phase: "idle" });
  const [scheduled, setScheduled] = useState<{ reminderId: string; at: Date } | null>(null);
  const [scheduledStatus, setScheduledStatus] = useState<string | null>(null);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const confirm = useMutation();

  const refresh = useCallback(async () => {
    const c = detectCapabilities();
    setCaps(c);
    if (pushSupported(c) && c.permission === "granted") {
      try {
        const s = await syncThisDevice();
        setRegistered(s ? { deviceId: s.deviceId, ok: s.registered && s.enabled } : { deviceId: null, ok: false });
      } catch {
        setRegistered(null);
      }
    } else setRegistered({ deviceId: null, ok: false });
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => {
      clearTimeout(initial);
      window.removeEventListener("beforeinstallprompt", onPrompt);
    };
  }, [refresh]);

  // Poll the scheduled test so the user can see the server's progress if the app stays open.
  useEffect(() => {
    if (!scheduled) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/reminders/${scheduled.reminderId}`, { credentials: "same-origin" }).catch(() => null);
      if (!res?.ok) return;
      const data = (await res.json()) as { reminder: { status: string }; attempts: { outcome: string }[] };
      const accepted = data.attempts.filter((a) => a.outcome === "accepted").length;
      setScheduledStatus(
        data.reminder.status === "pending" || data.reminder.status === "processing"
          ? "Waiting for the scheduler…"
          : data.reminder.status === "sent" || data.reminder.status === "partial"
            ? `The scheduler sent it: accepted by the push service for ${accepted} device${accepted === 1 ? "" : "s"}.`
            : `Status: ${data.reminder.status.replace(/_/g, " ")}. See the history below.`,
      );
      if (!["pending", "processing"].includes(data.reminder.status)) clearInterval(t);
    }, 10_000);
    return () => clearInterval(t);
  }, [scheduled]);

  if (isDemo) return <Notice tone="warn">Demo accounts can&apos;t enable reminders. Create a real account to receive notifications.</Notice>;
  if (!caps) return <p className="text-sm text-muted">Checking this browser…</p>;
  if (!vapidPublicKey)
    return <Notice tone="warn">The server is missing its push keys (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). Follow step 4 of the setup guide.</Notice>;

  const supported = pushSupported(caps);
  const iosNeedsInstall = caps.ios && !caps.standalone;
  const iosTooOld = caps.ios && caps.iosVersion !== null && caps.iosVersion < 16.4;
  const subscribed = !!registered?.ok;

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const res = await subscribeThisDevice(vapidPublicKey!);
      if (res.permission !== "granted") {
        setError(res.permission === "denied" ? "Notifications were blocked. See the instructions below to allow them." : "Permission was not granted.");
      }
      await refresh();
      onChanged?.();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't enable reminders on this device.");
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setTest({ phase: "sending" });
    try {
      const r = await sendTest(0);
      const result = r.result as { sent: number; noDevices: number; failed: number; retried: number } | null;
      if (result && result.sent > 0) setTest({ phase: "sent", accepted: result.sent, deviceId: registered?.deviceId ?? null });
      else if (result?.noDevices) setTest({ phase: "failed", message: "No enabled device is registered. Enable reminders on this device first." });
      else setTest({ phase: "failed", message: "The push service did not accept the message. Check the history below for the reason." });
      router.refresh();
    } catch (e) {
      setTest({ phase: "failed", message: e instanceof Error ? e.message : "Test failed." });
    }
  }

  return (
    <ol className="flex flex-col gap-3">
      <Step n={1} title="Check this browser" done={supported && !iosNeedsInstall}>
        <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          {[
            ["Secure connection (HTTPS)", caps.secure],
            ["Service worker", caps.serviceWorker],
            ["Push messaging", caps.pushManager],
            ["Notifications", caps.notification],
            ["Opened as installed app", caps.standalone],
          ].map(([label, ok]) => (
            <li key={String(label)} className="flex items-center gap-2">
              <span className={ok ? "text-ok" : "text-muted"} aria-hidden="true">
                {ok ? "✓" : "–"}
              </span>
              {label}
              <span className="sr-only">{ok ? "available" : "not available"}</span>
            </li>
          ))}
        </ul>
        {iosTooOld ? <Notice tone="warn">This iPhone/iPad runs iOS {caps.iosVersion}. Web push needs iOS/iPadOS 16.4 or later. Update in Settings → General → Software Update.</Notice> : null}
        {!caps.secure ? <Notice tone="warn">Push only works over HTTPS. Open the deployed https:// address.</Notice> : null}
        {!supported && !caps.ios ? <Notice tone="warn">This browser can&apos;t receive web push. Use a current Chrome, Edge, Firefox or Safari.</Notice> : null}
      </Step>

      {caps.ios ? (
        <Step n={2} title="Add FollowThrough to your Home Screen" done={caps.standalone}>
          {caps.standalone ? (
            <p>You&apos;re using the installed app. </p>
          ) : (
            <>
              <p>On iPhone and iPad, notifications only work for web apps added to the Home Screen (iOS/iPadOS 16.4 or later).</p>
              <ol className="list-decimal pl-5 text-sm">
                <li>In Safari, tap the Share button (square with an arrow).</li>
                <li>Choose “Add to Home Screen”, then “Add”.</li>
                <li>Close Safari and open FollowThrough from the new Home Screen icon.</li>
                <li>Sign in if asked, then return to Settings → Notifications & devices.</li>
              </ol>
            </>
          )}
        </Step>
      ) : (
        <Step n={2} title="Install the app (recommended)" done={caps.standalone}>
          {caps.standalone ? (
            <p>Installed.</p>
          ) : installEvent ? (
            <Button
              onClick={async () => {
                await installEvent.prompt();
                setInstallEvent(null);
              }}
            >
              Install FollowThrough
            </Button>
          ) : (
            <p className="text-sm text-muted">
              Optional on Android and desktop. In Chrome use the menu → “Install app” or “Add to Home screen”. Reminders also work in the browser.
            </p>
          )}
        </Step>
      )}

      <Step n={3} title="Allow notifications on this device" done={subscribed}>
        {caps.permission === "denied" ? (
          <div className="flex flex-col gap-2 text-sm">
            <Notice tone="warn">Notifications are blocked for FollowThrough in this browser. The app won&apos;t ask again; change it in settings:</Notice>
            <ul className="list-disc pl-5">
              <li>iPhone/iPad: Settings → Notifications → FollowThrough → Allow Notifications. If it isn&apos;t listed, remove the Home Screen app, add it again, and retry.</li>
              <li>Android (Chrome): long-press the app icon → App info → Notifications, or in Chrome tap ⋮ → Settings → Site settings → Notifications.</li>
              <li>Desktop: click the icon left of the address bar → Site settings → Notifications → Allow.</li>
            </ul>
            <Button size="sm" onClick={() => void refresh()}>
              I&apos;ve changed it — check again
            </Button>
          </div>
        ) : subscribed ? (
          <p>
            <span className="text-ok">✓</span> This device is registered for your reminders.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">Your browser will ask for permission after you press the button. We only ask when you choose to.</p>
            <Button variant="primary" busy={busy} disabled={!supported || iosNeedsInstall} onClick={enable}>
              <Icon name="bell" /> Enable reminders on this device
            </Button>
          </>
        )}
        <FormError message={error} />
      </Step>

      <Step n={4} title="Send a test notification" done={test.phase === "sent"}>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!subscribed || test.phase === "sending"} busy={test.phase === "sending"} onClick={runTest}>
            Send test now
          </Button>
        </div>
        {test.phase === "sent" ? (
          <div className="flex flex-col gap-2">
            <p>
              The push service accepted the message for {test.accepted} device{test.accepted === 1 ? "" : "s"}. That means it was handed over — not
              that your phone displayed it.
            </p>
            <p className="font-medium">Did a notification appear on this device?</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                busy={confirm.busy}
                disabled={!test.deviceId}
                onClick={() => test.deviceId && confirm.run(() => confirmDeviceAction(test.deviceId!), { success: "Great — this device is confirmed" })}
              >
                Yes, I saw it
              </Button>
              <a href="#troubleshooting" className="inline-flex min-h-9 items-center rounded-lg border border-border px-3 text-sm hover:bg-surface-2">
                No — help me fix it
              </a>
            </div>
          </div>
        ) : null}
        {test.phase === "failed" ? <FormError message={test.message} /> : null}
      </Step>

      <Step n={5} title="Prove it works with the app closed" done={!!scheduledStatus?.startsWith("The scheduler sent")}>
        <p className="text-sm">
          This sends a test through the server scheduler — the same path real reminders use. After pressing the button, close the app or lock your
          phone and wait about 2–3 minutes.
        </p>
        <Button
          disabled={!subscribed}
          onClick={async () => {
            try {
              const r = await sendTest(2);
              setScheduled({ reminderId: r.reminderId, at: new Date(r.availableAt) });
              setScheduledStatus("Scheduled. Close the app now.");
            } catch (e) {
              setScheduledStatus(e instanceof Error ? e.message : "Couldn't schedule the test.");
            }
          }}
        >
          Schedule a test in 2 minutes
        </Button>
        {scheduledStatus ? (
          <p role="status" className="text-sm">
            {scheduledStatus}
          </p>
        ) : null}
      </Step>
    </ol>
  );
}
