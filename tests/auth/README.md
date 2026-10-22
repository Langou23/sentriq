# Authentication plumbing tests

Run from the repository root with Node.js 22 after `npm ci`:

```sh
node --test tests/auth/auth.test.mjs
```

The suite uses the built-in Node.js test runner and the TypeScript compiler already
installed in the workspace. It evaluates the real authentication sources with
request-scoped Supabase and Next.js action dependencies replaced by local mocks.
Proxy tests use the actual `NextRequest`, `NextResponse`, and Next.js route matcher.
No server, network request, Supabase account, credentials, or database writes are needed.

Covered behavior:

- Badge normalization and runtime validation of action inputs.
- Password preservation, bilingual errors, and safe handling of upstream failures.
- Successful sign-in/sign-out redirects and invalidation of cached layouts.
- Session verification, public route boundaries, and denied access on Auth outages.
- Public login session refresh and cookie cleanup without authentication redirects.
- Authentication-independent access to the health route.
- Refreshed request/response cookies, deletion cookies, and cache header preservation.
- Public asset matching without bypassing private routes that have file extensions.
- Required cookie writes in actions and read-only cookie stores in Server Components.

These isolated tests verify the application's decisions against controlled Auth
responses. They do not prove that Supabase accepts real credentials or that the
hosted database migration has been applied. Live authentication flows and browser
tests will be added when the login interface and test accounts are available.

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
prints no credentials or cookie values. A 404 at `/login` is accepted while the
login page is intentionally absent. Stop the server afterward; never leave it
running during the next production build.
