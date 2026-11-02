"use client";

import { useEffect, useState } from "react";
import { useApp, useNow } from "@/components/app/AppContext";
import { useMutation } from "@/components/app/useMutation";
import { Button, FormError, Input } from "@/components/ui/controls";
import { removeDeviceAction, updateDeviceAction } from "@/app/actions/settings";
import { formatDateTime } from "@/lib/domain/format";
import { currentSubscription } from "@/lib/push-client";
import type { DeviceView } from "@/server/services/devices";

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function DeviceList({ devices }: { devices: DeviceView[] }) {
  const { prefs } = useApp();
  const now = useNow();
  const { run, busy, error } = useMutation();
  const [thisHash, setThisHash] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  useEffect(() => {
    currentSubscription()
      .then((s) => (s ? sha256Hex(s.endpoint) : null))
      .then(setThisHash)
      .catch(() => setThisHash(null));
  }, []);

  if (!devices.length) return <p className="text-sm text-muted">No devices yet. Use the steps above on each phone or computer that should get reminders.</p>;
  return (
    <>
      <ul className="overflow-hidden rounded-xl border border-border bg-surface">
        {devices.map((d) => (
          <li key={d.id} className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0">
            <div className="flex flex-wrap items-center gap-2">
              {renaming?.id === d.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await run(() => updateDeviceAction(d.id, { deviceLabel: renaming.label }), { success: "Renamed" })) setRenaming(null);
                  }}
                >
                  <label className="sr-only" htmlFor={`label-${d.id}`}>
                    Device name
                  </label>
                  <Input id={`label-${d.id}`} value={renaming.label} maxLength={100} onChange={(e) => setRenaming({ id: d.id, label: e.target.value })} />
                  <Button type="submit" size="sm" variant="primary" busy={busy}>
                    Save
                  </Button>
                </form>
              ) : (
                <span className="font-medium">{d.deviceLabel ?? "Unnamed device"}</span>
              )}
              {thisHash === d.endpointHash ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs">This device</span> : null}
              <span className={`rounded-full px-2 py-0.5 text-xs ${d.enabled ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted"}`}>{d.enabled ? "On" : "Off"}</span>
              {d.confirmedAt ? <span className="text-xs text-muted">Test confirmed</span> : null}
            </div>
            <p className="text-xs text-muted">
              Added {formatDateTime(d.createdAt, prefs, now)}
              {d.lastSuccessAt ? ` · last accepted by push service ${formatDateTime(d.lastSuccessAt, prefs, now)}` : " · nothing sent yet"}
              {d.lastFailureAt ? ` · last failure ${formatDateTime(d.lastFailureAt, prefs, now)}` : ""}
              {d.disabledReason ? ` · ${d.disabledReason}` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => run(() => updateDeviceAction(d.id, { enabled: !d.enabled }), { success: d.enabled ? "Reminders off for this device" : "Reminders on for this device" })}>
                {d.enabled ? "Turn off" : "Turn on"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRenaming({ id: d.id, label: d.deviceLabel ?? "" })}>
                Rename
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => {
                  if (confirm("Remove this device? It will stop receiving reminders until you enable it again on that device."))
                    void run(() => removeDeviceAction(d.id), { success: "Device removed" });
                }}
              >
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <FormError message={error} />
    </>
  );
}
