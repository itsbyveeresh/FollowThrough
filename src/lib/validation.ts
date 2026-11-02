import { z } from "zod";
import { FOLLOW_UP_METHODS, TASK_PRIORITIES, TASK_STATUSES } from "./domain/types";
import { isValidDate, isValidTimeZone } from "./domain/time";

/**
 * Validation shared by forms (client) and services (server). The server always
 * re-validates; the database adds CHECK constraints and ownership foreign keys.
 */

const emptyToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);

export const uuid = z.string().uuid("Invalid id");
export const optionalId = z.preprocess(emptyToNull, uuid.nullable());
export const dateStr = z.string().refine(isValidDate, "Use a valid date");
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid time (HH:mm)");
export const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, "Use a valid date and time")
  .refine((v) => isValidDate(v.slice(0, 10)), "Use a valid date");

const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().max(max, `Keep this under ${max} characters`).nullable());

export const tagList = z
  .array(z.string().trim().min(1).max(40, "Tags are limited to 40 characters"))
  .max(20, "Up to 20 tags");

export const taskFieldsSchema = z.object({
  title: z.string().trim().min(1, "A title is required").max(300, "Keep the title under 300 characters"),
  notes: optionalText(20000),
  clientId: optionalId,
  projectId: optionalId,
  contactId: optionalId,
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  dueDate: z.preprocess(emptyToNull, dateStr.nullable()),
  dueTime: z.preprocess(emptyToNull, timeStr.nullable()),
  followUpLocal: z.preprocess(emptyToNull, localDateTime.nullable()),
  followUpReminder: z.boolean(),
  deadlineReminderMinutes: z.number().int().min(0).max(10080).nullable(),
  repeatDaily: z.boolean(),
  tags: tagList,
});

export type TaskFields = z.infer<typeof taskFieldsSchema>;

function dueTimeNeedsDate<T extends { dueDate?: string | null; dueTime?: string | null }>(v: T) {
  return !(v.dueTime && !v.dueDate);
}
const dueTimeIssue = { message: "Add a due date before setting a due time", path: ["dueTime"] };

/** Creating: only the title is required (fast capture). */
export const createTaskSchema = taskFieldsSchema
  .partial()
  .required({ title: true })
  .refine(dueTimeNeedsDate, dueTimeIssue);
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** Updating: any subset of fields. */
export const updateTaskSchema = taskFieldsSchema.partial().refine(dueTimeNeedsDate, dueTimeIssue);
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const logFollowUpSchema = z.object({
  method: z.enum(FOLLOW_UP_METHODS),
  note: optionalText(5000),
  outcome: optionalText(2000),
  nextFollowUpLocal: z.preprocess(emptyToNull, localDateTime.nullable()),
  status: z.enum(TASK_STATUSES).nullable().optional(),
});
export type LogFollowUpInput = z.infer<typeof logFollowUpSchema>;

export const noteSchema = z.object({ note: z.string().trim().min(1, "Write a note").max(5000) });

export const snoozeSchema = z.object({
  option: z.enum(["15m", "1h", "tomorrow_morning", "custom"]),
  customLocal: z.preprocess(emptyToNull, localDateTime.nullable()).optional(),
});

export const clientSchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(200),
  notes: optionalText(10000),
});

export const projectSchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(200),
  clientId: optionalId,
  notes: optionalText(10000),
});

export const contactSchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(200),
  clientId: optionalId,
  email: z.preprocess(emptyToNull, z.string().trim().email("Enter a valid email").max(320).nullable()),
  phone: optionalText(50),
  notes: optionalText(5000),
});

const hhmm = timeStr;
export const settingsSchema = z
  .object({
    displayName: optionalText(100),
    timezone: z.string().refine(isValidTimeZone, "Choose a valid time zone"),
    dateStyle: z.enum(["d MMM", "MMM d", "yyyy-MM-dd", "dd/MM", "MM/dd"]),
    timeStyle: z.enum(["12h", "24h"]),
    workingDays: z.array(z.number().int().min(1).max(7)).min(1, "Pick at least one working day").max(7),
    workStart: hhmm,
    workEnd: hhmm,
    quietHoursEnabled: z.boolean(),
    quietStart: hhmm,
    quietEnd: hhmm,
    urgentBypassesQuiet: z.boolean(),
    dateOnlyReminderTime: hhmm,
    defaultFollowUpTime: hhmm,
    defaultFollowUpReminder: z.boolean(),
    defaultDeadlineReminderMinutes: z.number().int().min(0).max(10080).nullable(),
    repeatMaxPerTask: z.number().int().min(1).max(14),
    briefingEnabled: z.boolean(),
    briefingTime: hhmm,
    briefingWorkingDaysOnly: z.boolean(),
    notificationDetail: z.enum(["discreet", "detailed"]),
  })
  .refine((v) => v.workStart < v.workEnd, { message: "Work must start before it ends", path: ["workEnd"] })
  .refine((v) => v.quietStart !== v.quietEnd, { message: "Quiet hours need different start and end times", path: ["quietEnd"] });
export type SettingsInput = z.infer<typeof settingsSchema>;

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().startsWith("https://").max(1000),
  keys: z.object({
    p256dh: z.string().min(20).max(200),
    auth: z.string().min(8).max(100),
  }),
  deviceLabel: z.preprocess(emptyToNull, z.string().trim().max(100).nullable()).optional(),
});

/** First error message per field, for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
