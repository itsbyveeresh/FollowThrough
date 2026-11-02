-- FollowThrough: server-side reminder scheduler (Supabase Cron + pg_net + Vault)
--
-- Run this ONCE in the Supabase dashboard → SQL Editor, AFTER the app is deployed
-- and CRON_SECRET is set in your hosting provider. It makes Postgres call the
-- protected dispatcher endpoint every minute, so reminders are sent even when
-- your laptop is off and the app is closed.
--
-- Replace the two placeholders below before running:
--   <APP_URL>      e.g. https://followthrough-yourname.vercel.app   (no trailing slash)
--   <CRON_SECRET>  exactly the same value as the CRON_SECRET environment variable
--
-- The URL and secret are stored in Supabase Vault (encrypted at rest), not in the
-- job definition. Never commit the real values.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store (or replace) the secrets.
do $$
declare
  existing uuid;
begin
  select id into existing from vault.secrets where name = 'followthrough_dispatch_url';
  if existing is null then
    perform vault.create_secret('<APP_URL>/api/dispatch', 'followthrough_dispatch_url', 'FollowThrough dispatcher endpoint');
  else
    perform vault.update_secret(existing, '<APP_URL>/api/dispatch');
  end if;
  select id into existing from vault.secrets where name = 'followthrough_cron_secret';
  if existing is null then
    perform vault.create_secret('<CRON_SECRET>', 'followthrough_cron_secret', 'Bearer token for the FollowThrough dispatcher');
  else
    perform vault.update_secret(existing, '<CRON_SECRET>');
  end if;
end;
$$;

-- Every minute. Scheduling again with the same name replaces the job.
select cron.schedule(
  'followthrough-dispatch',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'followthrough_dispatch_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'followthrough_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) as request_id;
  $job$
);

-- ---------------------------------------------------------------------------
-- Checking it (run these separately):
--
--   select jobid, jobname, schedule, active from cron.job;
--   select status, return_message, start_time from cron.job_run_details
--     order by start_time desc limit 10;
--   select status_code, left(content::text, 200) as body, error_msg, created
--     from net._http_response order by created desc limit 10;
--   select started_at, ok, claimed, sent, failed, error from ft.scheduler_runs
--     order by started_at desc limit 10;
--
-- Pausing / removing:
--   select cron.unschedule('followthrough-dispatch');
-- ---------------------------------------------------------------------------
