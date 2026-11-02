import { DateTime } from "luxon";
import type { Prefs } from "./types";
import { addDays, isValidDate, localDate, localDateTimeString, minutesOf, resolveLocal, weekdayOf } from "./time";
import { formatClock, formatDate } from "./format";

/**
 * Deterministic natural-language date suggestions, e.g.
 *   "Follow up with Raj tomorrow at 11 AM"  -> follow-up tomorrow 11:00
 *   "Send proposal next Monday at 4 PM"     -> due next Monday 16:00
 * The result is only a suggestion: the UI previews it and the user applies or edits it.
 * When a phrase is ambiguous (e.g. "at 4", "next Friday" said early in the week,
 * "3/4"), choices are returned instead of a guess.
 */

export interface Choice {
  label: string;
  value: string;
}

export interface DateSuggestion {
  matched: string[];
  field: "follow_up" | "due";
  date: string | null;
  time: string | null;
  timeDefaulted: boolean;
  dateChoices?: Choice[];
  dateQuestion?: string;
  timeChoices?: Choice[];
  timeQuestion?: string;
}

type ParsePrefs = Pick<Prefs, "timezone" | "workStart" | "workEnd" | "workingDays" | "defaultFollowUpTime" | "timeStyle" | "dateStyle">;

const WEEKDAYS: Record<string, number> = {
  monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, wed: 3,
  thursday: 4, thurs: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7,
};
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const FULL_DAY_RE = "(monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
const SHORT_DAY_RE = "(mon|tues?|wed|thu(?:rs)?|fri|sat|sun)";

const FOLLOW_UP_HINT = /\b(follow[\s-]?up|chase|check[\s-]?in|nudge|remind|ping|call|ring|hear back|waiting)\b/i;
const DUE_HINT = /\b(by|due|deadline|before|no later than)\s+$/i;

interface DatePart {
  index: number;
  text: string;
  date?: string;
  choices?: Choice[];
  question?: string;
  time?: string; // some date phrases imply a time (eod, in 2 hours, tonight)
  instant?: Date;
}

interface TimePart {
  index: number;
  text: string;
  time?: string;
  choices?: Choice[];
  question?: string;
}

function ymd(y: number, m: number, d: number): string | null {
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidDate(s) ? s : null;
}

function nextMonthDay(today: string, m: number, d: number, year?: number): string | null {
  const ty = Number(today.slice(0, 4));
  if (year) return ymd(year, m, d);
  const thisYear = ymd(ty, m, d);
  if (thisYear && thisYear >= today) return thisYear;
  return ymd(ty + 1, m, d);
}

function findDate(text: string, now: Date, prefs: ParsePrefs): DatePart | null {
  const zone = prefs.timezone;
  const today = localDate(now, zone);
  const wd = weekdayOf(today);
  const fmt = (d: string) => formatDate(d, prefs, now);
  const found: DatePart[] = [];
  let m: RegExpExecArray | null;

  const push = (re: RegExp, fn: (m: RegExpExecArray) => Omit<DatePart, "index" | "text"> | null) => {
    re.lastIndex = 0;
    const r = re.exec(text);
    if (r) {
      const part = fn(r);
      if (part) found.push({ index: r.index, text: r[0].trim(), ...part });
    }
  };

  push(/\bday after tomorrow\b/i, () => ({ date: addDays(today, 2) }));
  push(/\b(tomorrow|tmrw|tmr|tomorow)\b/i, () => ({ date: addDays(today, 1) }));
  push(/\btoday\b/i, () => ({ date: today }));
  push(/\btonight\b/i, () => ({ date: today, time: "19:00" }));
  push(/\b(eod|end of (?:the )?day|cob|close of business)\b/i, () => ({ date: today, time: prefs.workEnd }));
  push(/\bnext week\b/i, () => {
    const monday = addDays(today, 8 - wd);
    const first = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i)).find((d) => prefs.workingDays.includes(weekdayOf(d)));
    return { date: first ?? monday };
  });
  push(/\b(end of (?:the )?week|eow)\b/i, () => {
    const lastWorking = Math.max(...prefs.workingDays);
    let delta = lastWorking - wd;
    if (delta < 0) delta += 7;
    return { date: addDays(today, delta) };
  });
  push(/\b(end of (?:the )?month|eom)\b/i, () => ({
    date: DateTime.fromISO(today, { zone: "UTC" }).endOf("month").toISODate()!,
  }));
  push(/\bin\s+(\d{1,3}|an?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/i, (r) => {
    const n = /^\d+$/.test(r[1]) ? Number(r[1]) : NUMBER_WORDS[r[1].toLowerCase()];
    const unit = r[2].toLowerCase();
    if (unit.startsWith("min") || unit.startsWith("h")) {
      const instant = new Date(now.getTime() + n * (unit.startsWith("min") ? 60_000 : 3600_000));
      const [d, t] = localDateTimeString(instant, zone).split("T");
      return { date: d, time: t, instant };
    }
    return { date: addDays(today, unit.startsWith("week") ? n * 7 : n) };
  });

  // Weekdays: full names anywhere; short names only after a cue word.
  const dayRe = new RegExp(`\\b(?:(this|next|coming|on|by|until|before)\\s+)?${FULL_DAY_RE}\\b|\\b(this|next|coming|on|by|until|before)\\s+${SHORT_DAY_RE}\\b`, "i");
  push(dayRe, (r) => {
    const modifier = (r[1] ?? r[3] ?? "").toLowerCase();
    const target = WEEKDAYS[(r[2] ?? r[4]).toLowerCase()];
    const delta = (target - wd + 7) % 7;
    const name = DateTime.fromISO(addDays(today, delta || 7), { zone: "UTC" }).toFormat("cccc");
    if (modifier === "next") {
      const upcoming = addDays(today, delta === 0 ? 7 : delta);
      const sameWeek = wd + (delta === 0 ? 7 : delta) <= 7;
      if (sameWeek) {
        const later = addDays(upcoming, 7);
        return {
          question: `Which ${name}?`,
          choices: [
            { label: `${fmt(upcoming)} (this week)`, value: upcoming },
            { label: `${fmt(later)} (next week)`, value: later },
          ],
        };
      }
      return { date: upcoming };
    }
    if (delta === 0) {
      if (modifier === "this") return { date: today };
      if (modifier === "coming") return { date: addDays(today, 7) };
      return {
        question: `Today is ${name}. Which one?`,
        choices: [
          { label: `Today (${fmt(today)})`, value: today },
          { label: `Next week (${fmt(addDays(today, 7))})`, value: addDays(today, 7) },
        ],
      };
    }
    return { date: addDays(today, delta) };
  });

  push(/\b(\d{4})-(\d{2})-(\d{2})\b/, (r) => {
    const d = ymd(Number(r[1]), Number(r[2]), Number(r[3]));
    return d ? { date: d } : null;
  });
  push(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b(?:,?\\s+(\\d{4}))?`, "i"), (r) => {
    const d = nextMonthDay(today, MONTHS[r[2].toLowerCase()], Number(r[1]), r[3] ? Number(r[3]) : undefined);
    return d ? { date: d } : null;
  });
  push(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "i"), (r) => {
    const d = nextMonthDay(today, MONTHS[r[1].toLowerCase()], Number(r[2]), r[3] ? Number(r[3]) : undefined);
    return d ? { date: d } : null;
  });
  // Numeric dates with a slash: ambiguous between day/month and month/day.
  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/;
  if ((m = numeric.exec(text))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    const dm = nextMonthDay(today, b, a, year); // day/month
    const md = nextMonthDay(today, a, b, year); // month/day
    const monthFirst = prefs.dateStyle === "MM/dd";
    const options = (monthFirst ? [md, dm] : [dm, md]).filter((x): x is string => !!x);
    const unique = [...new Set(options)];
    if (unique.length === 1) found.push({ index: m.index, text: m[0], date: unique[0] });
    else if (unique.length > 1)
      found.push({
        index: m.index,
        text: m[0],
        question: `Did you mean ${fmt(unique[0])} or ${fmt(unique[1])}?`,
        choices: unique.map((d) => ({ label: fmt(d), value: d })),
      });
  }

  if (!found.length) return null;
  // Prefer the most specific phrase that appears first; longer wins on ties.
  found.sort((x, y) => x.index - y.index || y.text.length - x.text.length);
  return found[0];
}

function findTime(text: string, prefs: ParsePrefs): TimePart | null {
  const clock = (t: string) => formatClock(t, { timeStyle: "12h" });
  const hhmm = (h: number, mi: number) => `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  const found: TimePart[] = [];
  let m: RegExpExecArray | null;

  if ((m = /\b(?:at\s+|@\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\W|$)/i.exec(text))) {
    let h = Number(m[1]);
    const mi = Number(m[2] ?? 0);
    const pm = m[3].toLowerCase().startsWith("p");
    if (h >= 1 && h <= 12 && mi < 60) {
      if (h === 12) h = pm ? 12 : 0;
      else if (pm) h += 12;
      found.push({ index: m.index, text: m[0].trim(), time: hhmm(h, mi) });
    }
  }
  if ((m = /\b(?:at\s+|@\s*)?([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(?:a\.?m|p\.?m))/i.exec(text))) {
    const raw = m[1];
    const h = Number(raw);
    const mi = Number(m[2]);
    if (h === 0 || h >= 13 || raw.startsWith("0") || h === 12 || prefs.timeStyle === "24h") {
      found.push({ index: m.index, text: m[0].trim(), time: hhmm(h, mi) });
    } else {
      found.push({ index: m.index, text: m[0].trim(), ...ampmChoices(h, mi) });
    }
  }
  if ((m = /\b(?:at|@)\s*(\d{1,2})\b(?![:./]\d)(?!\s*(?:a\.?m|p\.?m))/i.exec(text))) {
    const h = Number(m[1]);
    if (h >= 13 && h <= 23) found.push({ index: m.index, text: m[0], time: hhmm(h, 0) });
    else if (h === 12) found.push({ index: m.index, text: m[0], time: "12:00" });
    else if (h >= 1 && h <= 11) found.push({ index: m.index, text: m[0], ...ampmChoices(h, 0) });
  }
  if ((m = /\b(noon|midday|lunchtime)\b/i.exec(text))) found.push({ index: m.index, text: m[0], time: "12:00" });
  if ((m = /\b(?:in the |this )?morning\b/i.exec(text))) found.push({ index: m.index, text: m[0], time: prefs.workStart });
  if ((m = /\b(?:in the |this )?afternoon\b/i.exec(text))) found.push({ index: m.index, text: m[0], time: "14:00" });
  if ((m = /\b(?:in the |this )?evening\b/i.exec(text))) found.push({ index: m.index, text: m[0], time: "18:00" });

  function ampmChoices(h: number, mi: number): Pick<TimePart, "choices" | "question"> {
    const am = hhmm(h, mi);
    const pm = hhmm(h + 12, mi);
    const inHours = (t: string) => minutesOf(t) >= minutesOf(prefs.workStart) && minutesOf(t) < minutesOf(prefs.workEnd);
    const ordered = inHours(pm) && !inHours(am) ? [pm, am] : [am, pm];
    return {
      question: `Did you mean ${clock(am)} or ${clock(pm)}?`,
      choices: ordered.map((t) => ({ label: clock(t), value: t })),
    };
  }

  if (!found.length) return null;
  found.sort((x, y) => x.index - y.index);
  return found[0];
}

/** Suggest a follow-up or due date from free text. Returns null when nothing date-like is found. */
export function suggestDates(text: string, now: Date, prefs: ParsePrefs): DateSuggestion | null {
  if (!text || text.length > 500) return null;
  const datePart = findDate(text, now, prefs);
  const timePart = datePart?.time ? null : findTime(text, prefs);
  if (!datePart && !timePart) return null;

  const firstIndex = Math.min(datePart?.index ?? Infinity, timePart?.index ?? Infinity);
  const before = text.slice(0, firstIndex);
  const field: DateSuggestion["field"] =
    DUE_HINT.test(before) || /^(by|before|until)\b/i.test(datePart?.text ?? "")
    ? "due"
    : FOLLOW_UP_HINT.test(text)
      ? "follow_up"
      : "due";

  const matched = [datePart?.text, timePart?.text].filter((x): x is string => !!x);
  const s: DateSuggestion = { matched, field, date: null, time: null, timeDefaulted: false };

  if (datePart) {
    if (datePart.choices) {
      s.dateChoices = datePart.choices;
      s.dateQuestion = datePart.question;
    } else s.date = datePart.date ?? null;
    if (datePart.time) s.time = datePart.time;
  }
  if (timePart) {
    if (timePart.choices) {
      s.timeChoices = timePart.choices;
      s.timeQuestion = timePart.question;
    } else s.time = timePart.time ?? null;
  }
  // Time without a date: today if still ahead, otherwise tomorrow.
  if (!datePart && s.time) {
    const today = localDate(now, prefs.timezone);
    const at = resolveLocal(today, s.time, prefs.timezone).instant;
    s.date = at.getTime() > now.getTime() ? today : addDays(today, 1);
  }
  if (!datePart && timePart?.choices) s.date = localDate(now, prefs.timezone);
  if (field === "follow_up" && !s.time && !s.timeChoices) {
    s.time = prefs.defaultFollowUpTime;
    s.timeDefaulted = true;
  }
  return s;
}
