-- FollowThrough schema: profiles, clients, projects, contacts, tasks, activity,
-- reminder occurrences, push subscriptions, delivery attempts, scheduler health.
--
-- All tables live in the private "ft" schema, which is NOT exposed through the
-- Supabase Data API (PostgREST). The Next.js server connects with DATABASE_URL and,
-- for user requests, switches to the "authenticated" role with the user's id in
-- request.jwt.claims so Row Level Security applies to every query.
--
-- Conventions
--   * Every user-owned table has user_id and UNIQUE (id, user_id).
--   * Cross-table references use composite foreign keys (other_id, user_id) so a
--     row can only point at a record owned by the same user, even if a request
--     smuggles in someone else's identifier.
--   * Instants are timestamptz (stored in UTC). Wall-clock values the user typed
--     (due date / due time, preference times) are date / time columns that are
--     interpreted in the profile's IANA timezone.

create schema if not exists ft;
revoke all on schema ft from public;
grant usage on schema ft to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type ft.task_status as enum ('inbox', 'next_action', 'in_progress', 'waiting_on', 'completed', 'cancelled');
create type ft.task_priority as enum ('low', 'normal', 'high', 'urgent');
create type ft.activity_kind as enum (
  'created', 'updated', 'status_changed', 'follow_up_logged', 'note', 'rescheduled',
  'completed', 'reopened', 'cancelled', 'snoozed', 'deleted', 'restored'
);
create type ft.follow_up_method as enum ('phone', 'email', 'message', 'meeting', 'other');
create type ft.reminder_kind as enum ('follow_up', 'deadline', 'snooze', 'repeat', 'briefing', 'catch_up', 'test');
create type ft.reminder_status as enum (
  'pending',     -- waiting for available_at
  'processing',  -- claimed by a dispatcher run (lease in claim_expires_at)
  'sent',        -- every target device's push service accepted the message
  'partial',     -- at least one device accepted, others failed permanently / retries exhausted
  'failed',      -- no device accepted after bounded retries
  'cancelled',   -- invalidated (task completed / rescheduled / snoozed / settings changed)
  'missed',      -- became stale before it could be sent (e.g. scheduler outage)
  'no_devices',  -- nothing to send to (no enabled subscription)
  'skipped'      -- intentionally not sent (demo account, task no longer actionable)
);
create type ft.delivery_outcome as enum ('accepted', 'transient_failure', 'permanent_failure', 'subscription_gone');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function ft.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function ft.is_valid_timezone(tz text) returns boolean
language sql stable as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz);
$$;

-- ---------------------------------------------------------------------------
-- Profiles and preferences (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table ft.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 100),
  timezone text not null default 'UTC',
  date_style text not null default 'd MMM' check (date_style in ('d MMM', 'MMM d', 'yyyy-MM-dd', 'dd/MM', 'MM/dd')),
  time_style text not null default '12h' check (time_style in ('12h', '24h')),
  working_days smallint[] not null default '{1,2,3,4,5}'
    check (cardinality(working_days) between 1 and 7 and working_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  work_start time not null default '09:00',
  work_end time not null default '18:00',
  quiet_hours_enabled boolean not null default true,
  quiet_start time not null default '21:00',
  quiet_end time not null default '07:30',
  urgent_bypasses_quiet boolean not null default false,
  date_only_reminder_time time not null default '09:00',
  default_follow_up_time time not null default '10:00',
  default_follow_up_reminder boolean not null default true,
  default_deadline_reminder_minutes integer default 60
    check (default_deadline_reminder_minutes is null or default_deadline_reminder_minutes between 0 and 10080),
  repeat_max_per_task smallint not null default 3 check (repeat_max_per_task between 1 and 14),
  briefing_enabled boolean not null default false,
  briefing_time time not null default '08:30',
  briefing_working_days_only boolean not null default true,
  notification_detail text not null default 'discreet' check (notification_detail in ('discreet', 'detailed')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (work_start < work_end),
  check (quiet_start <> quiet_end)
);

create or replace function ft.profiles_validate() returns trigger
language plpgsql as $$
begin
  if not ft.is_valid_timezone(new.timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger profiles_validate before insert or update of timezone on ft.profiles
  for each row execute function ft.profiles_validate();
create trigger profiles_touch before update on ft.profiles
  for each row execute function ft.touch_updated_at();

-- Create a profile row for each new auth user.
create or replace function ft.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into ft.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger ft_on_auth_user_created after insert on auth.users
  for each row execute function ft.handle_new_user();

-- ---------------------------------------------------------------------------
-- Clients, projects, contacts
-- ---------------------------------------------------------------------------
create table ft.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  notes text check (notes is null or char_length(notes) <= 10000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index clients_user_name_active on ft.clients (user_id, lower(btrim(name))) where archived_at is null;
create trigger clients_touch before update on ft.clients for each row execute function ft.touch_updated_at();

create table ft.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  notes text check (notes is null or char_length(notes) <= 10000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (client_id, user_id) references ft.clients (id, user_id) on delete set null (client_id)
);
create index projects_user_client on ft.projects (user_id, client_id);
create trigger projects_touch before update on ft.projects for each row execute function ft.touch_updated_at();

create table ft.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  email text check (email is null or (char_length(email) <= 320 and email ~ '^[^@\s]+@[^@\s]+$')),
  phone text check (phone is null or char_length(phone) <= 50),
  notes text check (notes is null or char_length(notes) <= 5000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (client_id, user_id) references ft.clients (id, user_id) on delete set null (client_id)
);
create index contacts_user_client on ft.contacts (user_id, client_id);
create trigger contacts_touch before update on ft.contacts for each row execute function ft.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table ft.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  notes text check (notes is null or char_length(notes) <= 20000),
  client_id uuid,
  project_id uuid,
  contact_id uuid,
  status ft.task_status not null default 'inbox',
  priority ft.task_priority not null default 'normal',
  -- Deadline: when the work must be finished. Wall-clock date (+ optional time)
  -- in the profile timezone. due_at is the derived instant the deadline passes:
  -- the timed instant, or the start of the following local day for date-only.
  due_date date,
  due_time time,
  due_at timestamptz,
  -- Next follow-up: when the user should act / contact someone again (instant).
  follow_up_at timestamptz,
  -- Reminder settings (when the system should notify).
  follow_up_reminder boolean not null default true,
  deadline_reminder_minutes integer check (deadline_reminder_minutes is null or deadline_reminder_minutes between 0 and 10080),
  repeat_daily boolean not null default false,
  snoozed_until timestamptz,
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  -- Incremented whenever anything that affects reminders changes. Reminder
  -- occurrences remember the version they were planned for; a mismatch at send
  -- time means the reminder is obsolete.
  schedule_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  last_followed_up_at timestamptz,
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (client_id, user_id) references ft.clients (id, user_id) on delete set null (client_id),
  foreign key (project_id, user_id) references ft.projects (id, user_id) on delete set null (project_id),
  foreign key (contact_id, user_id) references ft.contacts (id, user_id) on delete set null (contact_id),
  check (due_time is null or due_date is not null),
  check ((due_date is null) = (due_at is null)),
  check (status <> 'completed' or completed_at is not null),
  check (status <> 'cancelled' or cancelled_at is not null)
);

create index tasks_user_active on ft.tasks (user_id, status) where deleted_at is null;
create index tasks_user_follow_up on ft.tasks (user_id, follow_up_at) where deleted_at is null and follow_up_at is not null;
create index tasks_user_due on ft.tasks (user_id, due_at) where deleted_at is null and due_at is not null;
create index tasks_user_client on ft.tasks (user_id, client_id) where deleted_at is null;
create index tasks_user_project on ft.tasks (user_id, project_id) where deleted_at is null;
create index tasks_user_contact on ft.tasks (user_id, contact_id) where deleted_at is null;
create index tasks_user_deleted on ft.tasks (user_id, deleted_at) where deleted_at is not null;

-- A task's project must belong to the task's client (when the project has one).
-- If the task has no client yet, it inherits the project's client.
create or replace function ft.tasks_check_relations() returns trigger
language plpgsql as $$
declare
  project_client uuid;
begin
  if new.project_id is not null then
    select p.client_id into project_client
      from ft.projects p where p.id = new.project_id and p.user_id = new.user_id;
    if project_client is not null then
      if new.client_id is null then
        new.client_id := project_client;
      elsif new.client_id <> project_client then
        raise exception 'project_client_mismatch' using errcode = '23514',
          detail = 'The selected project belongs to a different client.';
      end if;
    end if;
  end if;
  new.tags := coalesce(array(select distinct lower(btrim(t)) from unnest(new.tags) t where btrim(t) <> '' order by 1), '{}');
  return new;
end;
$$;

create trigger tasks_check_relations before insert or update of project_id, client_id, tags on ft.tasks
  for each row execute function ft.tasks_check_relations();
create trigger tasks_touch before update on ft.tasks for each row execute function ft.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Activity history (append-only)
-- ---------------------------------------------------------------------------
create table ft.task_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid not null,
  kind ft.activity_kind not null,
  method ft.follow_up_method,
  note text check (note is null or char_length(note) <= 5000),
  outcome text check (outcome is null or char_length(outcome) <= 2000),
  changes jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (task_id, user_id) references ft.tasks (id, user_id) on delete cascade
);
create index task_activities_task on ft.task_activities (task_id, occurred_at desc);
create index task_activities_user on ft.task_activities (user_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Reminder occurrences (the durable queue)
-- ---------------------------------------------------------------------------
create table ft.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid,
  kind ft.reminder_kind not null,
  -- Unique per user among non-cancelled rows, e.g. "follow_up:<task>:v3".
  occurrence_key text not null check (char_length(occurrence_key) <= 200),
  task_version integer,
  repeat_index smallint not null default 0,
  scheduled_for timestamptz not null,   -- the moment the reminder is about (never changed)
  available_at timestamptz not null,    -- next time it may be sent (quiet hours, retries)
  stale_after timestamptz not null,     -- after this it is "missed" instead of sent
  deferred_reason text check (deferred_reason is null or deferred_reason in ('quiet_hours', 'snooze', 'retry')),
  status ft.reminder_status not null default 'pending',
  status_reason text check (status_reason is null or char_length(status_reason) <= 200),
  attempts smallint not null default 0,
  max_attempts smallint not null default 5,
  claim_count smallint not null default 0,
  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  first_accepted_at timestamptz,
  finished_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (task_id, user_id) references ft.tasks (id, user_id) on delete cascade,
  check (kind in ('briefing', 'catch_up', 'test') or task_id is not null),
  check (stale_after >= available_at or status <> 'pending')
);
create unique index reminders_user_occurrence on ft.reminders (user_id, occurrence_key) where status <> 'cancelled';
create index reminders_pending_due on ft.reminders (available_at) where status = 'pending';
create index reminders_processing_lease on ft.reminders (claim_expires_at) where status = 'processing';
create index reminders_task on ft.reminders (task_id, status);
create index reminders_user_recent on ft.reminders (user_id, scheduled_for desc);
create trigger reminders_touch before update on ft.reminders for each row execute function ft.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Push subscriptions (one per browser installation)
-- ---------------------------------------------------------------------------
create table ft.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  endpoint_hash text not null unique,
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth_secret text not null check (char_length(auth_secret) between 8 and 100),
  device_label text check (device_label is null or char_length(device_label) <= 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  enabled boolean not null default true,
  disabled_reason text check (disabled_reason is null or char_length(disabled_reason) <= 200),
  confirmed_at timestamptz,          -- user confirmed they saw a test notification
  last_success_at timestamptz,       -- push service accepted a message
  last_failure_at timestamptz,
  consecutive_failures integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index push_subscriptions_user on ft.push_subscriptions (user_id) where enabled;
create trigger push_subscriptions_touch before update on ft.push_subscriptions for each row execute function ft.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Per-device delivery attempts
-- ---------------------------------------------------------------------------
create table ft.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reminder_id uuid not null,
  subscription_id uuid,
  attempt_no smallint not null,
  outcome ft.delivery_outcome not null,
  http_status integer,
  error text check (error is null or char_length(error) <= 300),
  created_at timestamptz not null default now(),
  foreign key (reminder_id, user_id) references ft.reminders (id, user_id) on delete cascade,
  foreign key (subscription_id) references ft.push_subscriptions (id) on delete set null
);
-- A device accepts a given reminder at most once: retries skip accepted devices.
create unique index delivery_attempts_one_accept on ft.delivery_attempts (reminder_id, subscription_id) where outcome = 'accepted';
create index delivery_attempts_reminder on ft.delivery_attempts (reminder_id);
create index delivery_attempts_user_recent on ft.delivery_attempts (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Scheduler heartbeat / run log (not user-owned)
-- ---------------------------------------------------------------------------
create table ft.scheduler_runs (
  id bigint generated always as identity primary key,
  worker_id uuid not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  claimed integer not null default 0,
  sent integer not null default 0,
  partial integer not null default 0,
  retried integer not null default 0,
  failed integer not null default 0,
  deferred integer not null default 0,
  cancelled integer not null default 0,
  missed integer not null default 0,
  no_devices integer not null default 0,
  error text check (error is null or char_length(error) <= 500)
);
create index scheduler_runs_started on ft.scheduler_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed windows)
-- ---------------------------------------------------------------------------
create table ft.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
