import type { Prefs, ReminderKind, ReminderStatus, TaskPriority, TaskSchedule, TaskStatus, FollowUpMethod } from "@/lib/domain/types";
import { DEFAULT_PREFS } from "@/lib/domain/types";

/** A task as shown in the UI, with related names joined in. */
export interface TaskView {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  clientId: string | null;
  clientName: string | null;
  projectId: string | null;
  projectName: string | null;
  contactId: string | null;
  contactName: string | null;
  dueDate: string | null;
  dueTime: string | null;
  dueAt: Date | null;
  followUpAt: Date | null;
  followUpReminder: boolean;
  deadlineReminderMinutes: number | null;
  repeatDaily: boolean;
  snoozedUntil: Date | null;
  tags: string[];
  scheduleVersion: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  lastFollowedUpAt: Date | null;
  deletedAt: Date | null;
}

export interface ActivityView {
  id: string;
  taskId: string;
  kind: string;
  method: FollowUpMethod | null;
  note: string | null;
  outcome: string | null;
  changes: Record<string, unknown>;
  occurredAt: Date;
}

export interface ReminderView {
  id: string;
  taskId: string | null;
  taskTitle?: string | null;
  kind: ReminderKind;
  status: ReminderStatus;
  statusReason: string | null;
  scheduledFor: Date;
  availableAt: Date;
  deferredReason: string | null;
  attempts: number;
  firstAcceptedAt: Date | null;
  finishedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

export interface ProfileView extends Prefs {
  id: string;
  displayName: string | null;
  isDemo: boolean;
}

type Row = Record<string, unknown>;

export const trimTime = (t: unknown): string | null => (typeof t === "string" ? t.slice(0, 5) : null);

export function toTaskView(r: Row): TaskView {
  return {
    id: r.id as string,
    title: r.title as string,
    notes: (r.notes as string) ?? null,
    status: r.status as TaskStatus,
    priority: r.priority as TaskPriority,
    clientId: (r.clientId as string) ?? null,
    clientName: (r.clientName as string) ?? null,
    projectId: (r.projectId as string) ?? null,
    projectName: (r.projectName as string) ?? null,
    contactId: (r.contactId as string) ?? null,
    contactName: (r.contactName as string) ?? null,
    dueDate: (r.dueDate as string) ?? null,
    dueTime: trimTime(r.dueTime),
    dueAt: (r.dueAt as Date) ?? null,
    followUpAt: (r.followUpAt as Date) ?? null,
    followUpReminder: r.followUpReminder as boolean,
    deadlineReminderMinutes: (r.deadlineReminderMinutes as number) ?? null,
    repeatDaily: r.repeatDaily as boolean,
    snoozedUntil: (r.snoozedUntil as Date) ?? null,
    tags: (r.tags as string[]) ?? [],
    scheduleVersion: r.scheduleVersion as number,
    createdAt: r.createdAt as Date,
    updatedAt: r.updatedAt as Date,
    completedAt: (r.completedAt as Date) ?? null,
    cancelledAt: (r.cancelledAt as Date) ?? null,
    lastFollowedUpAt: (r.lastFollowedUpAt as Date) ?? null,
    deletedAt: (r.deletedAt as Date) ?? null,
  };
}

export function toSchedule(t: TaskView): TaskSchedule {
  return {
    id: t.id,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    dueTime: t.dueTime,
    dueAt: t.dueAt,
    followUpAt: t.followUpAt,
    followUpReminder: t.followUpReminder,
    deadlineReminderMinutes: t.deadlineReminderMinutes,
    repeatDaily: t.repeatDaily,
    snoozedUntil: t.snoozedUntil,
    scheduleVersion: t.scheduleVersion,
    deletedAt: t.deletedAt,
  };
}

export function toProfileView(r: Row): ProfileView {
  return {
    id: r.id as string,
    displayName: (r.displayName as string) ?? null,
    isDemo: !!r.isDemo,
    timezone: (r.timezone as string) ?? DEFAULT_PREFS.timezone,
    dateStyle: r.dateStyle as Prefs["dateStyle"],
    timeStyle: r.timeStyle as Prefs["timeStyle"],
    workingDays: (r.workingDays as number[]).map(Number),
    workStart: trimTime(r.workStart)!,
    workEnd: trimTime(r.workEnd)!,
    quietHoursEnabled: r.quietHoursEnabled as boolean,
    quietStart: trimTime(r.quietStart)!,
    quietEnd: trimTime(r.quietEnd)!,
    urgentBypassesQuiet: r.urgentBypassesQuiet as boolean,
    dateOnlyReminderTime: trimTime(r.dateOnlyReminderTime)!,
    defaultFollowUpTime: trimTime(r.defaultFollowUpTime)!,
    defaultFollowUpReminder: r.defaultFollowUpReminder as boolean,
    defaultDeadlineReminderMinutes: (r.defaultDeadlineReminderMinutes as number) ?? null,
    repeatMaxPerTask: r.repeatMaxPerTask as number,
    briefingEnabled: r.briefingEnabled as boolean,
    briefingTime: trimTime(r.briefingTime)!,
    briefingWorkingDaysOnly: r.briefingWorkingDaysOnly as boolean,
    notificationDetail: r.notificationDetail as Prefs["notificationDetail"],
  };
}

export function toReminderView(r: Row): ReminderView {
  return {
    id: r.id as string,
    taskId: (r.taskId as string) ?? null,
    taskTitle: (r.taskTitle as string) ?? null,
    kind: r.kind as ReminderKind,
    status: r.status as ReminderStatus,
    statusReason: (r.statusReason as string) ?? null,
    scheduledFor: r.scheduledFor as Date,
    availableAt: r.availableAt as Date,
    deferredReason: (r.deferredReason as string) ?? null,
    attempts: Number(r.attempts),
    firstAcceptedAt: (r.firstAcceptedAt as Date) ?? null,
    finishedAt: (r.finishedAt as Date) ?? null,
    lastError: (r.lastError as string) ?? null,
    createdAt: r.createdAt as Date,
  };
}

/** A user-facing error with a safe message (and optional field errors). */
export class UserError extends Error {
  constructor(
    message: string,
    public fields?: Record<string, string>,
    public code: "invalid" | "not_found" | "conflict" | "rate_limited" | "forbidden" = "invalid",
  ) {
    super(message);
    this.name = "UserError";
  }
}
