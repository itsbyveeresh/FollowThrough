"use client";

import { useMemo, useState } from "react";
import { useApp, useNow } from "@/components/app/AppContext";
import { suggestDates } from "@/lib/domain/nlp";
import { formatClock, formatDate } from "@/lib/domain/format";
import { Button } from "@/components/ui/controls";

export interface AppliedDate {
  field: "follow_up" | "due";
  date: string;
  time: string | null;
}

/**
 * Previews a date found in the typed text. Nothing is applied until the user
 * chooses; ambiguous phrases ask a question first.
 */
export function DateSuggestion({ text, onApply }: { text: string; onApply: (a: AppliedDate) => void }) {
  const { prefs } = useApp();
  const now = useNow();
  const s = useMemo(() => suggestDates(text, now, prefs), [text, now, prefs]);
  const key = s ? `${s.matched.join("|")}` : "";
  const [picked, setPicked] = useState<{ key: string; date?: string; time?: string; dismissed?: boolean }>({ key: "" });
  if (!s) return null;
  const current = picked.key === key ? picked : { key };
  if (current.dismissed) return null;
  const date = s.date ?? current.date ?? null;
  const time = s.time ?? current.time ?? null;
  const needsDate = !s.date && !!s.dateChoices && !current.date;
  const needsTime = !s.time && !!s.timeChoices && !current.time;
  const ready = !!date && !needsDate && !needsTime;

  return (
    <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2.5 text-sm" aria-live="polite">
      <p>
        Found “{s.matched.join(" ")}”
        {ready ? (
          <>
            {" "}
            → <strong>{formatDate(date!, prefs, now)}</strong>
            {time ? (
              <>
                {" "}
                at <strong>{formatClock(time, prefs)}</strong>
                {s.timeDefaulted ? <span className="text-muted"> (your default follow-up time)</span> : null}
              </>
            ) : null}
          </>
        ) : null}
      </p>
      {needsDate ? (
        <div className="mt-2" role="group" aria-label={s.dateQuestion}>
          <p className="font-medium">{s.dateQuestion}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {s.dateChoices!.map((c) => (
              <Button key={c.value} size="sm" onClick={() => setPicked({ ...current, key, date: c.value })}>
                {c.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {needsTime ? (
        <div className="mt-2" role="group" aria-label={s.timeQuestion}>
          <p className="font-medium">{s.timeQuestion}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {s.timeChoices!.map((c) => (
              <Button key={c.value} size="sm" onClick={() => setPicked({ ...current, key, time: c.value })}>
                {c.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {ready ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={s.field === "follow_up" ? "primary" : "secondary"}
            onClick={() => {
              onApply({ field: "follow_up", date: date!, time: time ?? prefs.defaultFollowUpTime });
              setPicked({ key, dismissed: true });
            }}
          >
            Use as follow-up
          </Button>
          <Button
            size="sm"
            variant={s.field === "due" ? "primary" : "secondary"}
            onClick={() => {
              onApply({ field: "due", date: date!, time: s.timeDefaulted ? null : time });
              setPicked({ key, dismissed: true });
            }}
          >
            Use as deadline
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked({ key, dismissed: true })}>
            Ignore
          </Button>
        </div>
      ) : null}
    </div>
  );
}
