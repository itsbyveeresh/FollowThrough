-- Row Level Security, privileges, and reminder-queue functions.

-- ---------------------------------------------------------------------------
-- Privileges. Nothing is granted to anon. The Data API does not expose "ft".
-- ---------------------------------------------------------------------------
revoke all on all tables in schema ft from public, anon, authenticated;
revoke all on all functions in schema ft from public, anon;
alter default privileges in schema ft revoke execute on functions from public;

grant select, update (
  display_name, timezone, date_style, time_style, working_days, work_start, work_end,
  quiet_hours_enabled, quiet_start, quiet_end, urgent_bypasses_quiet, date_only_reminder_time,
  default_follow_up_time, default_follow_up_reminder, default_deadline_reminder_minutes,
  repeat_max_per_task, briefing_enabled, briefing_time, briefing_working_days_only, notification_detail
) on ft.profiles to authenticated;

grant select, insert, update, delete on ft.clients, ft.projects, ft.contacts, ft.tasks to authenticated;
grant select, insert on ft.task_activities to authenticated;
grant select, insert, update on ft.reminders to authenticated;
grant select on ft.delivery_attempts to authenticated;
-- Subscription key material (endpoint, p256dh, auth_secret) is never readable by
-- the user role; only the dispatcher (service_role) reads it.
grant select (
  id, user_id, endpoint_hash, device_label, user_agent, enabled, disabled_reason, confirmed_at,
  last_success_at, last_failure_at, consecutive_failures, created_at, updated_at
) on ft.push_subscriptions to authenticated;
grant update (enabled, device_label, confirmed_at, disabled_reason) on ft.push_subscriptions to authenticated;
grant delete on ft.push_subscriptions to authenticated;

grant all on all tables in schema ft to service_role;
grant usage on all sequences in schema ft to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table ft.profiles enable row level security;
alter table ft.clients enable row level security;
alter table ft.projects enable row level security;
alter table ft.contacts enable row level security;
alter table ft.tasks enable row level security;
alter table ft.task_activities enable row level security;
alter table ft.reminders enable row level security;
alter table ft.push_subscriptions enable row level security;
alter table ft.delivery_attempts enable row level security;
alter table ft.scheduler_runs enable row level security;
alter table ft.rate_limits enable row level security;

create policy profiles_own_select on ft.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_own_update on ft.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array['clients', 'projects', 'contacts', 'tasks'] loop
    execute format('create policy %1$s_own_select on ft.%1$s for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy %1$s_own_insert on ft.%1$s for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy %1$s_own_update on ft.%1$s for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy %1$s_own_delete on ft.%1$s for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

create policy task_activities_own_select on ft.task_activities for select to authenticated using (user_id = (select auth.uid()));
create policy task_activities_own_insert on ft.task_activities for insert to authenticated with check (user_id = (select auth.uid()));

create policy reminders_own_select on ft.reminders for select to authenticated using (user_id = (select auth.uid()));
create policy reminders_own_insert on ft.reminders for insert to authenticated
  with check (user_id = (select auth.uid()) and kind not in ('test', 'catch_up') and status = 'pending');
create policy reminders_own_update on ft.reminders for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy push_subscriptions_own_select on ft.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy push_subscriptions_own_update on ft.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_subscriptions_own_delete on ft.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

create policy delivery_attempts_own_select on ft.delivery_attempts for select to authenticated using (user_id = (select auth.uid()));
-- scheduler_runs and rate_limits: no policies => no direct access for users.

-- ---------------------------------------------------------------------------
-- User-callable functions (SECURITY DEFINER, scoped to auth.uid())
-- ---------------------------------------------------------------------------

-- Register (or move) a push subscription for the current user. An endpoint is
-- unique to one browser installation; if another account previously used this
-- installation (e.g. it was not signed out cleanly) the row moves to the
-- current account so the previous account stops receiving pushes here.
create or replace function ft.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_device_label text, p_user_agent text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  sub_id uuid;
  existing_count integer;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select count(*) into existing_count from ft.push_subscriptions
    where user_id = uid and endpoint <> p_endpoint;
  if existing_count >= 20 then
    raise exception 'too_many_devices' using errcode = '54000';
  end if;
  insert into ft.push_subscriptions as s (user_id, endpoint, endpoint_hash, p256dh, auth_secret, device_label, user_agent)
  values (uid, p_endpoint, encode(sha256(convert_to(p_endpoint, 'UTF8')), 'hex'), p_p256dh, p_auth,
          nullif(btrim(p_device_label), ''), left(p_user_agent, 300))
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth_secret = excluded.auth_secret,
    device_label = coalesce(excluded.device_label, s.device_label),
    user_agent = excluded.user_agent,
    enabled = true,
    disabled_reason = null,
    consecutive_failures = 0,
    confirmed_at = case when s.user_id = excluded.user_id then s.confirmed_at else null end,
    last_success_at = case when s.user_id = excluded.user_id then s.last_success_at else null end,
    last_failure_at = case when s.user_id = excluded.user_id then s.last_failure_at else null end
  returning id into sub_id;
  return sub_id;
end;
$$;

-- Fixed-window rate limiter. Buckets are always namespaced by the caller's id.
create or replace function ft.hit_rate_limit(p_bucket text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  win timestamptz;
  n integer;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  win := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into ft.rate_limits as r (bucket, window_start, hits)
  values (uid::text || ':' || p_bucket, win, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning hits into n;
  return n <= p_max;
end;
$$;

-- Scheduler health without exposing other users' data.
create or replace function ft.scheduler_health()
returns table (
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_ok boolean,
  last_error_at timestamptz,
  runs_last_hour integer
)
language sql security definer set search_path = '' stable as $$
  select
    (select max(started_at) from ft.scheduler_runs),
    (select max(finished_at) from ft.scheduler_runs),
    (select ok from ft.scheduler_runs order by started_at desc limit 1),
    (select max(started_at) from ft.scheduler_runs where ok = false),
    (select count(*)::integer from ft.scheduler_runs where started_at > now() - interval '1 hour');
$$;

grant execute on function ft.register_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function ft.hit_rate_limit(text, integer, integer) to authenticated;
grant execute on function ft.scheduler_health() to authenticated;
grant execute on function ft.is_valid_timezone(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Dispatcher functions (service_role only)
-- ---------------------------------------------------------------------------

-- Atomically claim due reminders. Rows are locked with SKIP LOCKED so
-- overlapping dispatcher runs never claim the same row. Expired leases
-- (a worker crashed mid-run) are reclaimable. At most p_per_user rows per user
-- are claimed per run so a backlog cannot flood one person's phone.
create or replace function ft.claim_due_reminders(
  p_worker uuid, p_now timestamptz, p_limit integer, p_per_user integer, p_lease_seconds integer
) returns setof ft.reminders
language sql as $$
  with locked as (
    select r.id, r.user_id, r.available_at
      from ft.reminders r
     where (r.status = 'pending' and r.available_at <= p_now)
        or (r.status = 'processing' and r.claim_expires_at <= p_now)
     order by r.available_at, r.id
     limit p_limit * 4
       for update skip locked
  ), ranked as (
    select id, available_at, row_number() over (partition by user_id order by available_at, id) as rn
      from locked
  ), chosen as (
    select id from ranked where rn <= p_per_user order by available_at, id limit p_limit
  )
  update ft.reminders r
     set status = 'processing',
         claim_token = p_worker,
         claimed_at = p_now,
         claim_expires_at = p_now + make_interval(secs => p_lease_seconds),
         claim_count = r.claim_count + 1
    from chosen
   where r.id = chosen.id
  returning r.*;
$$;

-- Mark pending reminders that are past their stale window as missed.
-- Returns the number of newly missed task reminders per user so the dispatcher
-- can send one catch-up summary instead of a flood of stale alerts.
create or replace function ft.mark_stale_reminders(p_now timestamptz)
returns table (user_id uuid, missed_count integer)
language sql as $$
  with stale as (
    update ft.reminders r
       -- A reminder some device already accepted (and that was only waiting to
       -- retry other devices) is "partial", not missed.
       set status = case when exists (select 1 from ft.delivery_attempts a
                                       where a.reminder_id = r.id and a.outcome = 'accepted')
                         then 'partial'::ft.reminder_status else 'missed'::ft.reminder_status end,
           status_reason = case when exists (select 1 from ft.delivery_attempts a
                                              where a.reminder_id = r.id and a.outcome = 'accepted')
                                then 'retries_timed_out' else 'not_sent_in_time' end,
           finished_at = p_now
     where r.id in (
       select s.id from ft.reminders s
        where s.status = 'pending' and s.stale_after < p_now
          for update skip locked
     )
    returning r.user_id, r.kind, r.status
  )
  select s.user_id, count(*)::integer
    from stale s
   where s.kind not in ('catch_up', 'test', 'briefing') and s.status = 'missed'
   group by s.user_id;
$$;

grant execute on function ft.claim_due_reminders(uuid, timestamptz, integer, integer, integer) to service_role;
grant execute on function ft.mark_stale_reminders(timestamptz) to service_role;

-- The Next.js server connects as the database owner and switches to
-- "authenticated" (user requests, RLS enforced) or "service_role" (dispatcher)
-- per transaction. Supabase normally grants these roles to postgres already;
-- this makes it explicit and is harmless if it is already in place.
do $$
begin
  execute format('grant authenticated, service_role to %I', current_user);
exception when others then
  raise notice 'Could not grant roles to %: % (usually already granted)', current_user, sqlerrm;
end;
$$;

-- Create the caller's profile if the auth trigger did not (e.g. users created
-- before this migration was applied).
create or replace function ft.ensure_profile() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  insert into ft.profiles (id) values (auth.uid()) on conflict (id) do nothing;
end;
$$;
grant execute on function ft.ensure_profile() to authenticated;
