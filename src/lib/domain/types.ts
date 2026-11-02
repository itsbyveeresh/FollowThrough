export const TASK_STATUSES = ["inbox", "next_action", "in_progress", "waiting_on", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ACTIVE_STATUSES: readonly TaskStatus[] = ["inbox", "next_action", "in_progress", "waiting_on"];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: "Inbox",
  next_action: "Next Action",
  in_progress: "In Progress",
  waiting_on: "Waiting On",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export const FOLLOW_UP_METHODS = ["phone", "email", "message", "meeting", "other"] as const;
export type FollowUpMethod = (typeof FOLLOW_UP_METHODS)[number];
export const METHOD_LABELS: Record<FollowUpMethod, string> = {
  phone: "Phone",
  email: "Email",
  message: "Message",
  meeting: "Meeting",
  other: "Other",
};

export type ReminderKind = "follow_up" | "deadline" | "snooze" | "repeat" | "briefing" | "catch_up" | "test";
export type ReminderStatus =
  | "pending"
  | "processing"
  | "sent"
  | "partial"
  | "failed"
  | "cancelled"
  | "missed"
  | "no_devices"
  | "skipped";

export const REMINDER_KIND_LABELS: Record<ReminderKind, string> = {
  follow_up: "Follow-up",
  deadline: "Deadline",
  snooze: "Snoozed reminder",
  repeat: "Daily repeat",
  briefing: "Daily briefing",
  catch_up: "Missed-reminder summary",
  test: "Test notification",
};

export const REMINDER_STATUS_LABELS: Record<ReminderStatus, string> = {
  pending: "Scheduled",
  processing: "Sending",
  sent: "Accepted by push service",
  partial: "Accepted by some devices",
  failed: "Failed",
  cancelled: "Cancelled",
  missed: "Missed (not sent in time)",
  no_devices: "No device to notify",
  skipped: "Skipped",
};

/** Preferences that affect scheduling and display. Times are "HH:mm" local. */
export interface Prefs {
  timezone: string;
  dateStyle: "d MMM" | "MMM d" | "yyyy-MM-dd" | "dd/MM" | "MM/dd";
  timeStyle: "12h" | "24h";
  workingDays: number[];
  workStart: string;
  workEnd: string;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  urgentBypassesQuiet: boolean;
  dateOnlyReminderTime: string;
  defaultFollowUpTime: string;
  defaultFollowUpReminder: boolean;
  defaultDeadlineReminderMinutes: number | null;
  repeatMaxPerTask: number;
  briefingEnabled: boolean;
  briefingTime: string;
  briefingWorkingDaysOnly: boolean;
  notificationDetail: "discreet" | "detailed";
}

export const DEFAULT_PREFS: Prefs = {
  timezone: "UTC",
  dateStyle: "d MMM",
  timeStyle: "12h",
  workingDays: [1, 2, 3, 4, 5],
  workStart: "09:00",
  workEnd: "18:00",
  quietHoursEnabled: true,
  quietStart: "21:00",
  quietEnd: "07:30",
  urgentBypassesQuiet: false,
  dateOnlyReminderTime: "09:00",
  defaultFollowUpTime: "10:00",
  defaultFollowUpReminder: true,
  defaultDeadlineReminderMinutes: 60,
  repeatMaxPerTask: 3,
  briefingEnabled: false,
  briefingTime: "08:30",
  briefingWorkingDaysOnly: true,
  notificationDetail: "discreet",
};

/** The scheduling-relevant view of a task. */
export interface TaskSchedule {
  id: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  dueTime: string | null;
  dueAt: Date | null;
  followUpAt: Date | null;
  followUpReminder: boolean;
  deadlineReminderMinutes: number | null;
  repeatDaily: boolean;
  snoozedUntil: Date | null;
  scheduleVersion: number;
  deletedAt: Date | null;
}

export function isActiveStatus(status: TaskStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}
