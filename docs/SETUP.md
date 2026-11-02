# Setting up FollowThrough

This guide assumes no programming experience. It takes about an hour. You will create accounts with **Supabase**
(database + sign-in) and a host such as **Vercel** (runs the website), then connect your phone.

> Keep a private note (e.g. in a password manager) of every secret you create below. Never paste secrets into email,
> chat or the code.

## Costs and limits — read first

Prices and plan rules change; check the providers' pricing pages before relying on any of this. (These notes were
written in October 2026 from public information; the provider websites could not be opened directly while this was
written, so verify them.)

- **Supabase Free plan** has limited database size, bandwidth and email sending. Free projects **can be paused after a
  period of inactivity** (reported as about a week). A paused project stops the reminder scheduler, so **no reminders
  are sent until you un-pause it** in the dashboard. For something you depend on, the paid **Pro** plan avoids pausing.
  Supabase's built-in email sender is rate-limited (only a few emails per hour); for reliable sign-up and password-reset
  emails, configure your own SMTP provider (Authentication → Emails → SMTP).
- **Vercel Hobby** (free) is for **personal, non-commercial** use under Vercel's terms. Using FollowThrough for paid
  consultancy work may require **Vercel Pro**. The scheduler calls the app 1,440 times a day (~43,000 a month), which
  counts toward function usage.
- **Push services** (Apple, Google, Mozilla) are free to use with VAPID keys; no developer accounts are needed.
- Nothing here is guaranteed to stay free forever.

---

## 1. Create and configure Supabase

1. Go to supabase.com, sign up, and click **New project**.
2. Choose a name (e.g. `followthrough`), a **strong database password** (save it!), and the region nearest to you.
3. Wait until the project is ready.
4. Open **Project Settings → API keys** (or the **Connect** button) and note:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **Publishable key** (`sb_publishable_…`) — or the legacy **anon** key.
5. Open **Connect** → **Transaction pooler** and copy the connection string (port **6543**). Replace `[YOUR-PASSWORD]`
   with your database password. This is your `DATABASE_URL` — a secret.

## 2. Apply the database migrations

Pick one method.

**A. SQL Editor (no tools needed)**
1. In Supabase, open **SQL Editor → New query**.
2. Open `supabase/migrations/20261026000001_schema.sql` from this project, copy everything, paste, click **Run**.
3. Do the same for `20261026000002_security_and_queue.sql`. Always run files in name order, each exactly once.

**B. From a computer with Node.js**: `DATABASE_URL="…" npm run db:migrate` (safe to re-run; it skips applied files).
For migrations, the **Session pooler** or direct connection string (port 5432) is the most compatible.

**C. Supabase CLI**: `supabase link --project-ref <ref>` then `supabase db push`.

Requires PostgreSQL 15 or newer (all current Supabase projects).

## 3. Set authentication redirect URLs

In Supabase → **Authentication → URL Configuration**:

- **Site URL**: your app's address, e.g. `https://followthrough-yourname.vercel.app` (you can come back after step 6).
- **Redirect URLs** — add:
  - `https://YOUR-APP/auth/confirm`
  - `https://YOUR-APP/auth/callback`
  - `http://localhost:3000/auth/confirm` (only if you run it locally)

**Email templates (recommended — makes links work if you open the email on a different device):**
Authentication → **Emails** → Templates:

- **Confirm signup**: set the link to
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/today`
- **Reset password**: set the link to
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`

If you leave **Confirm email** switched on (Authentication → Sign In / Providers → Email), new accounts must click the
email link before signing in. If you switch it off, sign-up signs you in immediately.

## 4. Generate VAPID keys (for push notifications)

On any computer with Node.js, inside this project folder: `npm run keys:vapid`
(or `npx web-push generate-vapid-keys`). You get a **Public Key** and a **Private Key**. The private key is a secret.

Also create the scheduler secret: `npm run keys:cron` → a long random string. This is `CRON_SECRET`.

> Changing the VAPID keys later disconnects every device; you would need to enable reminders again on each one.

## 5. Configure environment variables

| Variable | Value | Secret? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL from step 1 | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable (or anon) key | no |
| `DATABASE_URL` | Transaction pooler string from step 1 | **yes** |
| `VAPID_PUBLIC_KEY` | Public key from step 4 | no |
| `VAPID_PRIVATE_KEY` | Private key from step 4 | **yes** |
| `VAPID_SUBJECT` | `mailto:you@yourdomain.com` | no |
| `CRON_SECRET` | From `npm run keys:cron` | **yes** |
| `NEXT_PUBLIC_SITE_URL` | `https://YOUR-APP` | no |

`.env.example` lists them with explanations. The Supabase **service_role** key is **not** needed by the app.

## 6. Deploy over HTTPS (Vercel example)

1. Put this project in a GitHub repository (private is fine).
2. On vercel.com: **Add New → Project → Import** the repository. Framework: Next.js (detected automatically).
3. Before deploying, open **Environment Variables** and add every variable from step 5 (Production environment).
4. Click **Deploy**. Vercel gives you an `https://…vercel.app` address (HTTPS is automatic).
5. Go back to step 3 and set the Site URL / Redirect URLs to this address. If you changed `NEXT_PUBLIC_SITE_URL`,
   redeploy.
6. Open the address. If something is missing you'll see a **“FollowThrough needs setup”** page listing exactly which
   variables are missing.

Any host that runs Next.js 16 on Node.js 20.9+ over HTTPS works (e.g. Render, Fly.io, a VPS behind Caddy).

## 7. Configure the protected scheduler

This is what makes reminders work while your laptop is off.

1. In Supabase → **Integrations → Cron**, enable it if asked (the SQL below also enables `pg_cron` and `pg_net`).
2. Open **SQL Editor → New query**, paste `supabase/scheduler/setup-cron.sql`.
3. Replace `<APP_URL>` with your app address (e.g. `https://followthrough-yourname.vercel.app`, no trailing slash) and
   `<CRON_SECRET>` with **exactly** the same `CRON_SECRET` you set in Vercel. Click **Run**.
4. The URL and secret are stored encrypted in **Supabase Vault**; the job itself contains no secrets.
5. Within two minutes, the app's **Settings → Notifications & devices** should show **“Scheduler healthy”**.

To check it from SQL, the file includes ready-made queries (`cron.job_run_details`, `net._http_response`,
`ft.scheduler_runs`). To pause: `select cron.unschedule('followthrough-dispatch');`.

## 8. Install on your phone

**iPhone / iPad** (iOS/iPadOS 16.4 or later is required for web notifications):
1. Open your app address in **Safari** and sign in.
2. Tap **Share** (square with an arrow) → **Add to Home Screen** → **Add**.
3. Close Safari. From now on, **open FollowThrough from the Home Screen icon**. Notifications only work there.

**Android** (Chrome recommended):
1. Open your app address in Chrome and sign in.
2. Tap the **⋮** menu → **Install app** (or **Add to Home screen**). Optional but recommended.

## 9. Enable notifications

1. In the app (on iPhone: the Home Screen app) go to **More → Notifications & devices**.
2. Follow the steps. Press **Enable reminders on this device**; your phone asks for permission — choose **Allow**.
3. Press **Send test now**. When the notification appears, press **Yes, I saw it**.

Repeat on each device that should get reminders (e.g. your laptop too). Each device is listed and can be renamed,
turned off or removed.

## 10. Test a real scheduled reminder with the app closed

1. On the Notifications page, press **Schedule a test in 2 minutes**.
2. Immediately **close the app** (swipe it away) and lock the phone.
3. Within about 2–3 minutes a “Test notification from FollowThrough” should arrive.
4. For a full check: create a task with **Next follow-up** set 3–4 minutes ahead (outside quiet hours), close the app,
   wait. Tap the notification: it should open the task (asking you to sign in first if needed).

Timing is typically within about a minute when everything is healthy, but phones, networks, battery savers and Focus
modes can delay delivery; it is not guaranteed to the minute.

## 11. Check scheduler health and delivery attempts

- **Settings → Notifications & devices → Status** shows: scheduler not configured / not running / recent failure /
  healthy, no subscribed device, notifications blocked in this browser, and when the push service last accepted a
  message.
- **Reminder history** lists every reminder: when it was scheduled, if it was held for quiet hours, each device's
  result (accepted / temporary failure / rejected / subscription expired) and why anything was cancelled or missed.
- “Accepted by push service” means Apple/Google/Mozilla took the message. It does **not** prove the phone displayed it —
  only you can confirm that.

## Optional: a demo account

See README → “Demo data”. Demo accounts are labelled in the app and never receive reminders.
