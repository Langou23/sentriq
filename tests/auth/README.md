# Authentication tests

Run from the repository root with Node.js 22 after `npm ci`:

```sh
node --test tests/auth/auth.test.mjs
node --test tests/auth/role-pages.test.mjs
```

The suites use the built-in Node.js test runner and the TypeScript compiler already
installed in the workspace. They evaluate the real authentication sources with
request-scoped Supabase and Next.js action dependencies replaced by local mocks.
Proxy tests use the actual `NextRequest`, `NextResponse`, and Next.js route matcher.
No server, network request, Supabase account, credentials, or database writes are needed.

Covered behavior:

- Digits-only badge validation, leading-zero preservation, and bilingual field errors.
- Password preservation and safe handling of malformed values, files, and FormData.
- Generic credential errors without disclosing account existence or submitted secrets.
- Active profile validation and role redirects to `/agent`, `/dispatch`, and `/admin`.
- Immediate local sign-out for missing/inactive profiles and safe profile lookup failures.
- Deferred session cookies until profile approval, rejected-session cookie cleanup,
  and cleanup even when Supabase sign-out fails.
- Successful sign-out redirects and invalidation of cached layouts.
- Session verification, public route boundaries, and denied access on Auth outages.
- Public login session refresh and cookie cleanup without authentication redirects.
- Authentication-independent access to the health route.
- Refreshed request/response cookies, deletion cookies, and cache header preservation.
- Public asset matching without bypassing private routes that have file extensions.
- Required cookie writes in actions and read-only cookie stores in Server Components.
- Server-side profile authorization with fresh Auth verification and own-profile RLS reads.
- Exact role matching, including redirects of admins away from agent and dispatch pages.
- Role-home routing and authorization isolation across successive and overlapping requests.

These isolated tests verify the application's decisions against controlled Auth
and profile responses. They do not prove that Supabase accepts real credentials,
that RLS is correctly deployed, or that the hosted database migration has been
applied. Real account and hosted database acceptance checks require provisioned
test users and profiles. Role pages are temporary authenticated placeholders;
these tests do not assert any incident, dispatch, or administration feature.

Next.js 16.4.0 currently exports its route matcher test helper under the older
`unstable_doesMiddlewareMatch` name. The suite also accepts
`unstable_doesProxyMatch` when that name is available.

## HTTP smoke check

After a successful build, start a local production server, then run in another
terminal from the repository root:

```sh
npm run start --workspace apps/web -- --hostname 127.0.0.1 --port 3100
```

```sh
node tests/auth/http-smoke.mjs http://127.0.0.1:3100
```

The check expects the existing local Supabase configuration and a healthy hosted
project. It verifies unauthenticated and forged-cookie redirects, public login
access, health, and actual static assets. It makes no account/profile writes and
prints no credentials or cookie values. The login page must return 200 and expose
the French and English form labels. Stop the server afterward; never leave it
running during the next production build.

## Login HTTP flow with isolated Supabase responses

After a successful build, use a separate local production server with the test
preloader. Its Auth sessions and profiles exist only in memory; Supabase requests
are intercepted and unexpected endpoints are blocked. This does not change the
application sources, local environment file, hosted users, or database rows.

```sh
node --import ./tests/auth/supabase-fixture.mjs node_modules/next/dist/bin/next start apps/web --hostname 127.0.0.1 --port 3101
```

In another terminal:

```sh
node tests/auth/login-http.mjs http://127.0.0.1:3101
```

The runner requires a fixture response marker before submitting synthetic
credentials. It reads the rendered form's real Server Action metadata and checks
progressive HTML submission, Zod field messages and accessibility associations,
identical credential errors, missing/inactive profile rejection, and all three role
redirects. Own-role pages must return HTTP 200 with bilingual name, role, and
sign-out content. Cross-role access and the `/` home route must redirect to the
user's own page, either with HTTP 307 or with HTTP 200 and Next.js's streamed
redirect marker when Cache Components has already sent the shell. Rejected pages
must not contain the user's profile name. Unauthenticated requests are rejected
by the proxy with HTTP 307 to `/login`. The existing sign-out action must redirect
with HTTP 303 to `/login` and remove the session's cookies. The runner also verifies
session cleanup when profile lookup or remote logout fails. It prints no passwords,
tokens, or cookie values.
These checks exercise the production Next.js and Supabase SDK integration against
controlled upstream responses; they do not replace hosted-account or RLS checks.
Stop the fixture server afterward and before any further build or type generation.

## Manual demo accounts

Start the isolated fixture server above, then open `http://localhost:3101/login`.
The demo password is `fixture-password` for every account below. These are public
test fixtures, not hosted Supabase accounts or production credentials.

| Badge number | Expected result                            |
| ------------ | ------------------------------------------ |
| `000001`     | Agent workspace (`/agent`)                 |
| `000002`     | Supervisor workspace (`/dispatch`)         |
| `000003`     | Administrator workspace (`/admin`)         |
| `000004`     | Missing profile: account disabled message  |
| `000005`     | Inactive profile: account disabled message |

Enter the complete digit identifier, including leading zeros. Alphabetic badge
numbers are rejected before any authentication request. Use the hosted Supabase
server on a separate hostname when testing real accounts to keep demo cookies separate.
