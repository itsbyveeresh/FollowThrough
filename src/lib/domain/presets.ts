import type { Prefs } from "./types";
import { addDays, localDate, localDateTimeString, resolveLocal, weekdayOf } from "./time";
import { formatClock, formatDate } from "./format";

export interface Preset {
  label: string;
  value: string; // local "yyyy-MM-ddTHH:mm"
}

function nextWorkingDay(from: string, prefs: Pick<Prefs, "workingDays">, skip = 1): string {
  let d = from;
  let n = 0;
  for (let i = 0; i < 21 && n < skip; i++) {
    d = addDays(d, 1);
    if (prefs.workingDays.includes(weekdayOf(d))) n++;
  }
  return d;
}

/** One-tap choices for the next follow-up, in the user's time zone. */
export function followUpPresets(now: Date, prefs: Prefs): Preset[] {
  const today = localDate(now, prefs.timezone);
  const t = prefs.defaultFollowUpTime;
  const at = (date: string) => `${date}T${t}`;
  const label = (date: string, prefix: string) => `${prefix} · ${formatDate(date, prefs, now)}, ${formatClock(t, prefs)}`;
  const out: Preset[] = [];
  const later = new Date(now.getTime() + 3 * 3600_000);
  if (localDate(later, prefs.timezone) === today) {
    const v = localDateTimeString(new Date(Math.ceil(later.getTime() / (30 * 60_000)) * 30 * 60_000), prefs.timezone);
    out.push({ label: `Later today · ${formatClock(v.slice(11), prefs)}`, value: v });
  }
  const nwd = nextWorkingDay(today, prefs);
  out.push({ label: label(nwd, nwd === addDays(today, 1) ? "Tomorrow" : "Next working day"), value: at(nwd) });
  const two = nextWorkingDay(today, prefs, 2);
  out.push({ label: label(two, "In 2 working days"), value: at(two) });
  const monday = addDays(today, 8 - weekdayOf(today));
  out.push({ label: label(monday, "Next week"), value: at(monday) });
  return out;
}

/** "yyyy-MM-ddTHH:mm" for a datetime-local input, in the user's zone. */
export function toLocalInput(d: Date | null, zone: string): string {
  return d ? localDateTimeString(d, zone) : "";
}

export function isFutureLocal(local: string, zone: string, now: Date): boolean {
  try {
    return resolveLocal(local.slice(0, 10), local.slice(11, 16), zone).instant.getTime() > now.getTime();
  } catch {
    return false;
  }
}
