import { DateTime, IANAZone } from "luxon";

/**
 * Local-time handling.
 *
 * Instants are JavaScript Dates (UTC). Wall-clock values are strings:
 *   date "yyyy-MM-dd", time "HH:mm", local date-time "yyyy-MM-ddTHH:mm".
 *
 * Daylight-saving policy (documented in docs/SETUP.md and Settings):
 *   - Nonexistent local times (inside a spring-forward gap, e.g. 02:30 on the
 *     night clocks jump from 02:00 to 03:00) move FORWARD by the length of the
 *     gap (02:30 becomes 03:30).
 *   - Ambiguous local times (inside a fall-back overlap, e.g. 01:30 happens
 *     twice) resolve to the EARLIER of the two instants.
 */

export type LocalAdjustment = "none" | "shifted_forward" | "ambiguous_earlier";

export interface ResolvedLocal {
  instant: Date;
  adjustment: LocalAdjustment;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export function isValidTimeZone(zone: string): boolean {
  return typeof zone === "string" && zone.length > 0 && IANAZone.isValidZone(zone);
}

export function normalizeTime(time: string): string {
  if (!TIME_RE.test(time)) throw new Error(`Invalid time: ${time}`);
  return time.slice(0, 5);
}

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  return DateTime.fromISO(date, { zone: "UTC" }).isValid;
}

function wallClockAsUtcMillis(date: string, time: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = normalizeTime(time).split(":").map(Number);
  return Date.UTC(y, mo - 1, d, h, mi);
}

/** Offset of `zone` (minutes east of UTC) at the given instant. */
function offsetAt(zone: string, millis: number): number {
  return IANAZone.create(zone).offset(millis);
}

/** Convert a wall-clock date + time in `zone` to an instant, applying the DST policy. */
export function resolveLocal(date: string, time: string, zone: string): ResolvedLocal {
  if (!isValidDate(date)) throw new Error(`Invalid date: ${date}`);
  if (!isValidTimeZone(zone)) throw new Error(`Invalid time zone: ${zone}`);
  const wall = wallClockAsUtcMillis(date, time);
  // Candidate offsets: the offsets in force a little before and after.
  const candidates = new Set<number>([
    offsetAt(zone, wall - 36 * 3600_000),
    offsetAt(zone, wall),
    offsetAt(zone, wall + 36 * 3600_000),
  ]);
  const valid: number[] = [];
  for (const off of candidates) {
    const instant = wall - off * 60_000;
    if (offsetAt(zone, instant) === off) valid.push(instant);
  }
  valid.sort((a, b) => a - b);
  if (valid.length === 1) return { instant: new Date(valid[0]), adjustment: "none" };
  if (valid.length > 1) return { instant: new Date(valid[0]), adjustment: "ambiguous_earlier" };
  // Nonexistent: interpret with the offset in force before the transition,
  // which lands the same distance past the gap.
  const before = offsetAt(zone, wall - 36 * 3600_000);
  return { instant: new Date(wall - before * 60_000), adjustment: "shifted_forward" };
}

/** Parse "yyyy-MM-ddTHH:mm" in zone. */
export function resolveLocalDateTime(local: string, zone: string): ResolvedLocal {
  const [date, time] = local.split("T");
  if (!date || !time) throw new Error(`Invalid local date-time: ${local}`);
  return resolveLocal(date, time, zone);
}

export function toZoned(instant: Date, zone: string): DateTime {
  return DateTime.fromJSDate(instant, { zone });
}

export function localDate(instant: Date, zone: string): string {
  return toZoned(instant, zone).toISODate()!;
}

export function localTime(instant: Date, zone: string): string {
  return toZoned(instant, zone).toFormat("HH:mm");
}

export function localDateTimeString(instant: Date, zone: string): string {
  return toZoned(instant, zone).toFormat("yyyy-MM-dd'T'HH:mm");
}

/** ISO weekday 1 (Mon) .. 7 (Sun) of a "yyyy-MM-dd" date. */
export function weekdayOf(date: string): number {
  return DateTime.fromISO(date, { zone: "UTC" }).weekday;
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: "UTC" }).plus({ days }).toISODate()!;
}

export function diffDays(a: string, b: string): number {
  return Math.round(
    DateTime.fromISO(a, { zone: "UTC" }).diff(DateTime.fromISO(b, { zone: "UTC" }), "days").days,
  );
}

/** Start of the local day containing `instant`. */
export function startOfLocalDay(instant: Date, zone: string): Date {
  return resolveLocal(localDate(instant, zone), "00:00", zone).instant;
}

/** Start of the local day after `date` (used as the "passes" instant for date-only deadlines). */
export function endOfLocalDate(date: string, zone: string): Date {
  return resolveLocal(addDays(date, 1), "00:00", zone).instant;
}

/** Minutes since local midnight for "HH:mm". */
export function minutesOf(time: string): number {
  const [h, m] = normalizeTime(time).split(":").map(Number);
  return h * 60 + m;
}

/** Instant at which a deadline passes. Date-only deadlines pass at the end of the local day. */
export function deadlineInstant(dueDate: string, dueTime: string | null, zone: string): Date {
  return dueTime ? resolveLocal(dueDate, dueTime, zone).instant : endOfLocalDate(dueDate, zone);
}
