# SmartStreet

SmartStreet tracks streetlight faults from a resident report through technician repair and administrator verification. It uses Next.js 15 App Router, Supabase Auth/Postgres with row-level security, and Leaflet with OpenStreetMap tiles.

## Project layout

- `artifacts/smartstreet/` — Next.js web application.
- `supabase/schema.sql` — tables, indexes, Auth profile trigger, priority engine, workflow functions, grants, and RLS policies.
- `supabase/seed.sql` — fictional Hyderabad streetlights and optional demo reports/tasks.
- `.env.example` — public Supabase client configuration template.

## Supabase setup

1. Create a Supabase project and copy its Project URL and public anon/publishable key. The browser app must use only the public key; **never put a service-role key in this app or a `NEXT_PUBLIC_` variable**.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as Replit Secrets. If the project uses the newer publishable-key name instead, set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` with that public key. Do not commit real values.
3. In Supabase **SQL Editor**, run `supabase/schema.sql`.
4. Configure Supabase Auth's site URL and allowed redirect URLs to include the app's development and published origins. Email/password sign-in is used. If email confirmation is enabled, residents must confirm their address before signing in.
5. Create accounts using the app's sign-up page. New sign-ups always receive the `citizen` role. Create at least one admin and one technician by changing profiles from the Supabase SQL Editor after their Auth users have been created and confirmed:

   ```sql
   UPDATE public.profiles
   SET role = CASE LOWER(email)
     WHEN 'admin@example.com' THEN 'admin'
     WHEN 'tech1@example.com' THEN 'technician'
     WHEN 'tech2@example.com' THEN 'technician'
     WHEN 'tech3@example.com' THEN 'technician'
     WHEN 'tech4@example.com' THEN 'technician'
     WHEN 'tech5@example.com' THEN 'technician'
     ELSE role
   END
   WHERE LOWER(email) IN (
     'admin@example.com',
     'tech1@example.com',
     'tech2@example.com',
     'tech3@example.com',
     'tech4@example.com',
     'tech5@example.com'
   );
   ```

   Replace those example addresses with the accounts you created. Run role changes in the trusted Supabase SQL Editor, not from a browser client. Users changed from citizen to staff should sign out and back in to refresh their client profile.

6. Optionally run `supabase/seed.sql` to add 25 fictional streetlights, 10 sample reports, and maintenance tasks assigned across available technicians. It requires at least one citizen and one technician profile; having an admin and five technicians makes the demo queue easier to explore. The seed script creates no Auth users and stores no passwords.

The Auth trigger copies a sign-up user's `full_name` and optional `phone` metadata into `profiles`. It ignores any role supplied in public sign-up metadata and always creates a citizen profile.

## Run locally

Use the workspace's pnpm install, then start the app from the repository root:

```sh
pnpm install
pnpm --filter @workspace/smartstreet run dev
```

For local development outside Replit, put the two public values from `.env.example` in `artifacts/smartstreet/.env.local`. Do not commit that file. Replit users should use Secrets instead.

## Report priority

The browser calculates a preview; `submit_report` recalculates and stores the authoritative score in Postgres. Priority is deterministic:

- Start with issue severity.
- Add location and traffic importance based on the streetlight's zone/location.
- Add 4 points per recent report, capped at 16.
- Add 4 points per 24 hours of failure, capped at 16.
- Cap the total at 100. Scores are `critical` at 80+, `high` at 60+, `medium` at 40+, and `low` below 40.

## Workflow and data access

The expected lifecycle is `open → assigned → in_progress → resolved → verified`.

- A citizen can read the streetlight directory and only their own reports and notifications.
- An administrator can review all reports, assign only open reports to technician profiles, and verify resolved tasks.
- A technician can read only assigned tasks and their related reports, then start and resolve those tasks.
- Workflow writes use database functions that check the signed-in identity and current profile role. Direct table writes for reports and tasks are not granted to browser users.
- RLS remains the data boundary even when someone changes a route or calls Supabase directly. The app uses the public Supabase key, cookie-backed `@supabase/ssr` sessions, and no database passwords or service-role key in the browser.

Notifications are added for administrators when a report arrives, technicians when work is assigned, administrators when work is resolved, and the reporting resident after verification.

## Verification

Run the production Next.js build and TypeScript check:

```sh
pnpm --filter @workspace/smartstreet run typecheck
pnpm --filter @workspace/smartstreet run build
```

For an end-to-end check with your Supabase project:

1. Sign in as a citizen, report a seeded streetlight, and confirm it appears in that citizen's report list.
2. Sign in as an administrator, assign the open report to a technician, and verify that another citizen cannot read the report.
3. Sign in as the assigned technician, start the task, add repair remarks, and resolve it.
4. Sign in as an administrator, verify the resolved task, then confirm the citizen sees the verified status and notification.
5. Confirm a technician cannot read another technician's task and a citizen cannot assign or verify work.

No Supabase project database or demo accounts are provisioned by this repository. SQL setup and role assignment must be run against the Supabase project you choose.

## Vercel

Connect the repository to Vercel, select Next.js, and configure the root build command as:

```sh
pnpm --filter @workspace/smartstreet run build
```

Add the Supabase public URL and key as Vercel environment variables for each deployment environment. Keep the monorepo root available so the pnpm workspace lockfile resolves, and add the Vercel origin to Supabase Auth's allowed redirect URLs.
