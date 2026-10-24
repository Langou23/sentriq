# Database access checks

Apply all versioned migrations first, including the numeric badge constraint,
the timekeeping migration, and the open-session site access migration. Then run
all three SQL scripts as `postgres` against a
disposable Supabase database. The test runner must be able to insert
test `auth.users` and switch to `anon`, `authenticated`, and `service_role`.
The script uses PostgreSQL and PL/pgSQL only; it does not require pgTAP or a new
project dependency.

With an existing PostgreSQL client and an already configured local connection:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/profiles_rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/timekeeping_rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/open_session_site_rls.sql
```

Keep the connection value local and never commit or print credentials. For a
disposable hosted test project, the entire file can also be run in its SQL Editor.
Run the three files separately; each creates its own temporary helpers and ends
with a rollback. These scripts test an already applied schema and do not apply
the migrations themselves.

The 75 assertions in `profiles_rls.sql` cover schema constraints, defaults, the role helper, timestamp
updates, allowed profile access, denied access and privilege escalation, column
permissions, and trusted provisioning. Numeric badge checks verify that text and
leading zeros are preserved, distinct digit strings remain distinct, and empty,
signed, spaced, decimal, alphabetic, or non-ASCII values are rejected on writes.
The script sets transaction-local JWT
claims and database roles to exercise the same RLS rules as API callers. It does
not create login sessions or call the Auth API.

The 153 assertions in `timekeeping_rls.sql` verify `sites`, `assignments`, and
`work_sessions`:

- RLS, foreign keys, generated identities, timestamp defaults and update triggers,
  coordinate/radius/distance constraints, and the one-open-session index.
- Active-site reads by authenticated users, including profileless or inactive
  users, plus inactive-site access and site/assignment management by active admins.
  The separate open-session suite covers the narrow inactive-site exception for
  an active agent's own ongoing session.
- Own assignment/session history for active agents, all operational history for
  active supervisors/admins, and denied access for missing or inactive profiles.
- Check-in only for the active agent's own active assignment at an active site,
  rejection of foreign-agent/site spoofing, and duplicate open sessions across sites.
- Checkout only by the owning active agent while the session is open, including
  successful checkout after the site and assignment are deactivated.
- Protected database-owned columns, immutable check-in observations and closed
  sessions, and denial of deletion or truncation by all API roles, including
  `service_role`. Trusted backend access does not bypass closed-history protection.

The timekeeping fixtures use the separate UUID namespace
`10000000-0000-4000-8000-000000000001` through
`10000000-0000-4000-8000-000000000999`, plus generated IDs for default-value checks.
They do not reuse the profile suite's fixture identities. The open-session check
exercises the database's unique constraint across sites; it does not create
parallel clients or test real-time application behavior.

The 47 assertions in `open_session_site_rls.sql` cover the hardened,
authentication-scoped open-site helper and its restricted execution grants.
They verify that an active agent can read only their own open session's inactive
site, retain checkout access after site/assignment deactivation, and lose that
exception after checkout, profile deactivation, or a role change. Other agents'
inactive sites, historical closed-session sites, and unrelated inactive sites
stay hidden. New check-in and checkout statements are exercised to detect RLS
recursion, and inactive-site check-in remains denied. Existing active-site and
administrator access is also checked.

This suite uses UUIDs starting with `20000000-0000-4000-8000-` so it does not
overlap the other suites. Its fixtures and profile/site status changes are
rolled back together.

All valid badge fixtures use ASCII digit strings. User fixtures use reserved UUIDs
and `example.invalid` addresses. Existing matching
UUIDs fail the test instead of being replaced. Every change is wrapped in one
transaction, and a successful run ends with `ROLLBACK` and a success marker. A
failure raises an exception; roll back the failed transaction before continuing
if the client keeps that database session open. Never run these fixtures against
production.

For an embedded PostgreSQL verification harness, the same script works when the
harness supplies Supabase's `auth.users`, `auth.uid()`, and API roles before applying
all migrations in order. Such a harness checks PostgreSQL access behavior; it does not verify
the hosted Supabase project's deployment state.
