# FollowThrough

A personal follow-up assistant for consultants: what needs attention today, who you're waiting on, when to chase them
next, and what happened last time — with push reminders that arrive on your phone even when your laptop is off and
the app is closed.

- **Today**: overdue work, today's follow-ups, today's deadlines, items needing planning, what's coming up. Each task
  appears once, in its most urgent group.
- **Inbox**: capture with just a title; plan later as a next action or waiting item.
- **Waiting On**: grouped by follow-up date, person or client; overdue follow-ups in red.
- **All Tasks**: search (titles, notes, clients, projects, people, tags), filters, sorting, optional status board.
- **Clients & projects**: active, waiting and overdue work, recent activity, “no next action” warnings; lightweight
  contacts.
- **Log follow-up**: method, note, outcome, next follow-up and status change — saved together, with full history.
- **Reminders**: at the follow-up time, optionally before deadlines, snooze (15 min / 1 h / tomorrow morning / custom),
  optional daily repeats, optional daily briefing, quiet hours, discreet lock-screen text by default.
- Natural-language dates (“follow up with Raj tomorrow at 11 AM”) — deterministic, previewed, asks when ambiguous. No
  AI service.
- CSV and JSON export, trash with restore, keyboard shortcut (N), installable PWA, works at 360 px.

## Architecture (short)

| Piece | Choice |
| --- | --- |
| App | Next.js 16 (App Router, Server Actions), TypeScript, Tailwind CSS 4 |
| Auth | Supabase Auth (email + password, confirmation, reset) via `@supabase/ssr`, verified with `getClaims()` |
| Data | Supabase Postgres, private `ft` schema (not exposed through the Data API); server connects with `DATABASE_URL` and runs each request as `authenticated` with the user's id, so **Row Level Security applies to every query** |
| Ownership | Composite foreign keys `(related_id, user_id)` — a task can't reference another user's client/project/person even with a forged id |
| Reminders | Durable queue table `ft.reminders`; dispatcher `POST /api/dispatch` called **every minute by Supabase Cron** (pg_cron + pg_net, secrets in Vault) |
| Push | Standards Web Push with VAPID (`web-push`); service worker `public/sw.js` |
| Time | Luxon; UTC instants, IANA time zones, explicit DST policy |

Details, failure windows and reminder rules: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Setup

Follow **[`docs/SETUP.md`](docs/SETUP.md)** (written for non-developers). Short version:

1. Create a Supabase project; run `supabase/migrations/*.sql` (SQL editor, `npm run db:migrate`, or `supabase db push`).
2. Configure Auth URLs and email templates.
3. `npm run keys:vapid`, `npm run keys:cron`; fill in the variables from [`.env.example`](.env.example).
4. Deploy (e.g. Vercel) over HTTPS.
5. Run `supabase/scheduler/setup-cron.sql` (with your URL and `CRON_SECRET`).
6. On your phone: install to Home Screen → Settings → Notifications & devices → enable → test.

Mobile reminder problems: [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## Local development

```bash
npm install
cp .env.example .env.local   # fill in a Supabase project's values
npm run dev                  # http://localhost:3000
```

Push works on `http://localhost` in desktop Chrome/Firefox; phones need the HTTPS deployment. The scheduler can be
triggered by hand: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/dispatch`.

## Tests

| Command | What it covers |
| --- | --- |
| `npm run typecheck`, `npm run lint` | Types and lint |
| `npm test` | Unit tests (time zones, DST, quiet hours, reminder planning, snooze, repeats, briefing, NL dates, Today grouping, redirect safety, health states, notification privacy). Integration tests are skipped unless `TEST_DATABASE_URL` is set. |
| `TEST_DATABASE_URL=postgres://… npm test` | Plus integration tests on real Postgres with the migrations: RLS and cross-user denial (including forged related ids), task lifecycle, reminder invalidation, follow-up logging, snooze, trash/restore, time-zone change, export, and the dispatcher (concurrent runs, crash/lease recovery, per-device retries, expired subscriptions, quiet hours at send time, outage catch-up, per-user limits, repeats, demo accounts, missing VAPID) and real Web Push encryption/VAPID against a local TLS push endpoint. |
| `TEST_DATABASE_URL=postgres://… npm run test:e2e` | Playwright against the production build: sign-up → waiting task → log follow-up → next follow-up → snooze → complete; notification link → sign-in → back to task; another account can't open it; NL date suggestions with clarification; inbox; trash; dispatcher secret and heartbeat; 360 px layout; denied permission; missing configuration; manifest/service worker. |

`TEST_DATABASE_URL` must point at a **disposable** Postgres 15+ server where the user can create databases (tests
create and drop their own). The tests apply `tests/db/supabase-shim.sql`, a minimal stand-in for Supabase's roles and
`auth.uid()`. The E2E suite uses `tests/e2e/auth-emulator.ts`, a test-only stand-in for the few Supabase Auth endpoints
the app calls — the app itself always talks to real Supabase Auth.

What automated tests **cannot** prove: delivery to a real phone. See the checklist in `docs/SETUP.md` §10–11.

## Demo data

Never added to real accounts. To create a separate, clearly labelled demo account with fictional data (no reminders are
ever sent for it):

```bash
ALLOW_DEMO_SEED=yes SUPABASE_SERVICE_ROLE_KEY=… npm run seed:demo -- --email demo@yourdomain.com --password '…'
```

## Project layout

```
src/app/(app)/…        signed-in screens      src/server/services/   tasks, reminders, dispatcher, devices, export
src/app/(auth)/…       sign-in/up/reset       src/lib/domain/        pure logic: time, reminders, today, nlp, format
src/app/api/…          dispatch, push, export src/components/…       UI
supabase/migrations/   schema + RLS + queue   supabase/scheduler/    Supabase Cron setup SQL
public/sw.js           service worker         tests/{unit,integration,e2e}
```
