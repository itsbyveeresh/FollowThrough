# Architecture and reminder reliability

## Concepts kept separate

| Concept | Stored as | Meaning |
| --- | --- | --- |
| Deadline | `due_date` (+ optional `due_time`) in the profile time zone; derived `due_at` instant | When the work must be finished. Date-only deadlines pass at the **end** of the local day. |
| Next follow-up | `follow_up_at` (UTC instant) | When to act or contact someone again. May be before the deadline. |
| Reminder | rows in `ft.reminders` | When the system should notify. Derived from the task + settings; never changes the task's dates. |

## Reminder rules

| Kind | When | Notes |
| --- | --- | --- |
| Follow-up | At `follow_up_at` | If the task's follow-up reminder is on. |
| Deadline | N minutes before a timed deadline; for date-only deadlines on the due date (or N days before) at the user's “all-day deadline reminder time” | Never midnight. Skipped if identical to the follow-up time. |
| Snooze | At the snooze time (15 min, 1 h, tomorrow at work start, custom) | Cancels this task's reminders due before it. Deadline/follow-up unchanged; “snoozed until …” shown. Rescheduling clears the snooze. |
| Daily repeat | Next day at the same local time after a follow-up reminder was sent | Off by default; max `repeat_max_per_task` (default 3). Stops on complete/cancel/reschedule/trash. Respects quiet hours. |
| Briefing | Daily at a chosen local time (working days by default) | Counts of overdue items, today's follow-ups, high/urgent deadlines within 3 days. Opens Today. |
| Catch-up | After reminders were missed | One per user per hour at most. |
| Test | Now, or in 2 minutes via the scheduler | Not held by quiet hours. |

**Quiet hours** (may cross midnight) defer every kind except tests to the next allowed time; checked when planning and
again right before sending (settings may have changed). Urgent tasks may bypass if the user opts in.

**Lock-screen content** is discreet by default (“You have a follow-up due.”); task/client/person names only with the
“Detailed” setting. Opening or dismissing a notification changes nothing.

## Time

- Instants are `timestamptz` (UTC); user settings hold an IANA zone.
- Nonexistent local times (spring-forward gap) move forward by the gap; ambiguous times (fall-back) use the earlier
  instant. Users are told when this happens.
- Changing time zone keeps deadlines' wall-clock date/time and follow-ups' exact instants; all pending reminders are
  re-planned in the same transaction.

## Queue and dispatcher

`ft.reminders` is the durable queue. Each row has a unique `occurrence_key` per user (among non-cancelled rows),
`scheduled_for` (the moment it is about), `available_at` (next send time, after quiet hours/backoff), `stale_after`,
and `task_version`.

Every task change that affects reminders increments `tasks.schedule_version` and, **in the same transaction**, cancels
pending reminders from older versions and inserts the new plan. Completing, cancelling or trashing cancels all pending
reminders.

`POST /api/dispatch` (Supabase Cron → pg_net every minute, `Authorization: Bearer CRON_SECRET`, constant-time compare):

1. Heartbeat row in `ft.scheduler_runs`.
2. Plan briefings; mark stale reminders **missed** and queue one catch-up summary per affected user.
3. `ft.claim_due_reminders()`: `FOR UPDATE SKIP LOCKED` + 120 s lease (`claim_token`, `claim_expires_at`), at most 3
   per user per run, 50 per run. Overlapping runs never claim the same row; expired leases are reclaimed (a crashed
   run's work is retried). Rows reclaimed more than 6 times fail permanently.
4. **Final state check** just before sending: task deleted/closed, schedule version changed, snoozed, reminder
   switched off → cancelled; quiet hours → deferred; demo account → skipped; too old → missed.
5. Sends Web Push to every enabled device that hasn't already accepted this reminder, and **records each device's
   attempt immediately** (`ft.delivery_attempts`, unique accepted row per reminder+device). 404/410 disable the
   subscription; 429/5xx/network errors retry with backoff (1, 2, 4, 8 min; max 5 attempts, never past the stale
   window); other 4xx are permanent for that device (5 consecutive → disabled).
6. Finalizes (`sent`, `partial`, `failed`, `no_devices`, retry `pending`) guarded by the claim token, then plans a daily
   repeat if enabled.

Push options: TTL 12 h (briefing 6 h, test 10 min), urgency high (briefing normal), `Topic` = reminder id, notification
`tag` = reminder id.

### Stale-reminder policy

A reminder not sent within **60 minutes** of when it became sendable (90 for briefings, 10 for tests) is marked
**missed** rather than sent late. After an outage the user gets **one** summary (“N reminders could not be sent on
time”), Today shows a banner, and the tasks remain in their Today sections. A reminder that some device already accepted
but another kept failing becomes **partial**, not missed.

### Duplicate window (honest limits)

Push delivery cannot be exactly-once. If the process stops **after** a push service accepted a message but **before**
the attempt row is written (milliseconds), the lease expires and a later run sends it again. The same `tag` and
`Topic` make most platforms replace rather than stack the duplicate. Conversely a push service may accept a message and
still never display it (device offline past TTL, OS settings); the app reports “accepted by push service”, never
“delivered”.

### Scheduling granularity

pg_cron runs at most once a minute here, so reminders go out within roughly a minute of their time when services are
healthy. Phone display time depends on push services and device state.

## Security

- **RLS on every table**; the server runs user requests as `authenticated` with `request.jwt.claims.sub` set from a
  verified Supabase session (`getClaims()`). Dispatcher work runs as `service_role`.
- Tables live in schema `ft`, not exposed via PostgREST; `anon` has no privileges.
- Composite FKs enforce same-owner relations; a trigger enforces project ↔ client consistency.
- Push key material (`endpoint`, `p256dh`, `auth_secret`) is not readable by the user role (column privileges);
  registration goes through a `SECURITY DEFINER` function that also moves an endpoint from a previous account.
- Server-side validation (zod) mirrors client validation; DB CHECK constraints back it up.
- Rate limits: push subscribe 10/hour, test notifications 6/10 min per user (DB-backed, works on serverless).
- Route handlers reject cross-site requests (Origin / Sec-Fetch-Site); Server Actions have Next.js's built-in origin
  checks.
- Logs contain error class, Postgres code and constraint name only — no notes, tokens, passwords or subscription data.
  Stored push errors are sanitized (no URLs/tokens).
- The service worker caches only hashed static assets and icons; pages and API responses are never cached. Offline
  shows an explicit offline page/banner; nothing is queued or pretended saved.
- Sign-out deletes this device's subscription for the account, unsubscribes the browser, ends the session and clears
  local state. On app open, a browser subscription still registered to a different account is detached from it.
