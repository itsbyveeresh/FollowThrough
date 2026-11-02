# Troubleshooting mobile reminders

Start with **Settings → Notifications & devices → Status** in the app. Each status line maps to a section below.

## “Scheduler not configured”
No dispatcher run has ever been recorded.
- Run `supabase/scheduler/setup-cron.sql` (SETUP §7) with your real app URL and `CRON_SECRET`.
- Check the job exists: `select jobname, schedule, active from cron.job;`

## “Scheduler not running” (stale)
Runs were recorded but none in the last few minutes.
- Supabase project **paused** (free plan inactivity)? Un-pause it in the dashboard. Reminders that became more than
  about an hour old while paused are marked **missed** (not sent late); you get one summary notification and the
  tasks remain on Today.
- `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;`
- `select status_code, error_msg, created from net._http_response order by created desc limit 10;`
  - `401` → the `CRON_SECRET` in Vault differs from the one in your hosting provider. Re-run the setup SQL with the
    right value.
  - `503` with “CRON_SECRET is not configured” → set `CRON_SECRET` (32+ characters) in your host and redeploy.
  - `404` → wrong URL; it must end in `/api/dispatch`.
  - Timeouts/`null` status → the app is down or the URL is wrong.

## “Recent dispatch failure”
The latest run reported an error. Common causes:
- “Push is not configured on the server” → set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and redeploy.
- Database errors → check `DATABASE_URL` (transaction pooler, correct password).
- “permission denied to set role” → the database user in `DATABASE_URL` must be able to switch to the `authenticated`
  and `service_role` roles. In the SQL Editor run: `grant authenticated, service_role to postgres;`
The dispatcher retries every minute.

## “No subscribed device”
Enable reminders on your phone (SETUP §8–9). Devices disabled because their subscription expired show
“Subscription expired or was removed by the browser” — enable reminders on that device again.

## “Notifications blocked”
The browser/OS denied permission. The app won't ask again automatically.
- **iPhone/iPad**: Settings → Notifications → FollowThrough → Allow Notifications. If FollowThrough isn't listed, delete
  the Home Screen icon, add it again from Safari, open it from the icon, and enable reminders.
- **Android**: long-press the app icon → App info → Notifications → Allow; or Chrome ⋮ → Settings → Site settings →
  Notifications → allow your app's address.
- **Desktop**: click the icon left of the address bar → Site settings → Notifications → Allow. Reload.

## The test says “accepted” but nothing appeared
The push service took the message, but the device didn't show it. Check, in order:
1. **iPhone**: are you using the **Home Screen app**, not a Safari tab? iOS 16.4+?
2. **Focus / Do Not Disturb / Sleep** modes silence notifications. Allow FollowThrough in the Focus settings.
3. Notification settings for the app/browser: banners and lock screen enabled? Notification summary scheduled?
4. **Android battery optimisation**: allow Chrome (or the installed app) to run in the background; disable “Put app to
   sleep” for it.
5. Network: the phone must be online. Messages wait at the push service for up to ~12 hours (6 hours for briefings).
6. Remove the device in the app and enable reminders again (refreshes the subscription).

## Notifications arrive late
- Quiet hours hold reminders until quiet hours end (shown as “held for quiet hours” in history). The task's dates don't
  change.
- Snoozed tasks only remind at the snooze time.
- Delivery depends on the push service, network, OS power saving and Focus modes; the app targets minute-level dispatch
  but can't control the phone.

## Duplicate notification
Rare by design (see ARCHITECTURE.md “Duplicate window”). Duplicates of the same reminder carry the same notification tag,
so most systems replace rather than stack them.

## Tapping a notification asks me to sign in
Expected if your session expired. After signing in you land on the task you tapped.

## Signed out but still getting reminders on this device
Signing out removes this device from the account. If sign-out happened while offline, the next account that signs in
on this device detaches it automatically; or remove the device from Settings → Notifications & devices on another
device.
