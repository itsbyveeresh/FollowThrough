"use client";

import { useApp, useNow } from "@/components/app/AppContext";
import { Field, Input } from "@/components/ui/controls";
import { followUpPresets } from "@/lib/domain/presets";

/** Preset chips plus a precise date-time input (interpreted in the profile time zone). */
export function FollowUpPicker({
  value,
  onChange,
  label = "Next follow-up",
  error,
  allowNone,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  error?: string;
  allowNone?: boolean;
}) {
  const { prefs } = useApp();
  const now = useNow();
  const presets = followUpPresets(now, prefs);
  return (
    <div className="flex flex-col gap-2">
      <Field label={label} error={error} hint={`Times are in ${prefs.timezone}.`}>
        {(p) => <Input {...p} type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} />}
      </Field>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick choices">
        {presets.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(p.value)}
            aria-pressed={value === p.value}
            className="rounded-full border border-border px-3 py-1.5 text-sm hover:bg-surface-2 aria-pressed:border-accent aria-pressed:bg-accent-soft"
          >
            {p.label}
          </button>
        ))}
        {allowNone ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-pressed={value === ""}
            className="rounded-full border border-border px-3 py-1.5 text-sm hover:bg-surface-2 aria-pressed:border-accent aria-pressed:bg-accent-soft"
          >
            No further follow-up
          </button>
        ) : null}
      </div>
    </div>
  );
}
