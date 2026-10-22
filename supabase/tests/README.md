# Database access checks

Apply all versioned migrations first, including the numeric badge constraint,
then run `profiles_rls.sql` as `postgres`
against a disposable Supabase database. The test runner must be able to insert
test `auth.users` and switch to `anon`, `authenticated`, and `service_role`.
The script uses PostgreSQL and PL/pgSQL only; it does not require pgTAP or a new
project dependency.

With an existing PostgreSQL client and an already configured local connection:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/profiles_rls.sql
```

Keep the connection value local and never commit or print credentials. For a
disposable hosted test project, the entire file can also be run in its SQL Editor.

The 75 assertions cover schema constraints, defaults, the role helper, timestamp
updates, allowed profile access, denied access and privilege escalation, column
permissions, and trusted provisioning. Numeric badge checks verify that text and
leading zeros are preserved, distinct digit strings remain distinct, and empty,
signed, spaced, decimal, alphabetic, or non-ASCII values are rejected on writes.
The script sets transaction-local JWT
claims and database roles to exercise the same RLS rules as API callers. It does
not create login sessions or call the Auth API.

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
