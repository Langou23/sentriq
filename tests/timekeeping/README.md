# Timekeeping browser fixture

This isolated fixture exercises the real production Next.js application, its
Server Actions, Supabase clients and browser interface. Supabase Auth and database
requests are replaced in memory. No hosted account, database row, real GPS
position, privileged key or environment-file change is involved.

The fixture approximates the policies needed by these flows. It does not prove
that the hosted migrations are applied or replace PostgreSQL/RLS integration tests.

## Start and stop

Build the final application first from the repository root. No development or
production server using this checkout may run during a build. Afterward, start:

```sh
node --import ./tests/timekeeping/supabase-fixture.mjs node_modules/next/dist/bin/next start apps/web --hostname 127.0.0.1 --port 3101
```

Open `http://127.0.0.1:3101/login`. Use the fake agent badge `000001` and the public
fixture password `fixture-password`. Supervisor `000002` and admin `000003` still
use the existing role guards and have no agent workspace access.

Both `X-Sentriq-Test-Fixture: supabase` and
`X-Sentriq-Timekeeping-Fixture: memory` identify fixture responses. The injected
document sets the read-only browser marker `window.__sentriqTimekeepingFixture`
to `true` and replaces all geolocation methods before Next.js hydration. Browser
verification should confirm that marker before clicking a timekeeping button.
The replacement never delegates to the real geolocation API.

The preloader also supports the auth fixture's existing profile control endpoint.
Restarting the server clears all fake sessions and records. Stop it with Ctrl+C
before the next build. Never preload either fixture in a deployed application.

## Fixture controls

The control endpoint is `/__sentriq_fixture__/timekeeping`. Every request must
come from loopback and include `X-Sentriq-Test-Fixture: supabase`. CLI requests
also require `Origin: http://127.0.0.1:3101`. A same-origin browser GET may instead
use the browser-provided `Sec-Fetch-Site: same-origin` and matching `Referer`;
browsers cannot manually set an Origin header.

From PowerShell, after starting the fixture server:

```powershell
$fixtureHeaders = @{ Origin = 'http://127.0.0.1:3101'; 'X-Sentriq-Test-Fixture' = 'supabase' }
Invoke-RestMethod -Uri 'http://127.0.0.1:3101/__sentriq_fixture__/timekeeping' -Method Post -Headers $fixtureHeaders -ContentType 'application/json' -Body '{"reset":true,"scenario":"one","geoMode":"inside"}'
```

Read-only snapshot:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3101/__sentriq_fixture__/timekeeping' -Headers $fixtureHeaders
```

The snapshot contains fake sites, assignments, work sessions, fake identity IDs
and badges, request counters, successful inserts/closes, simulated race counters,
GPS mode and requested GPS options. It contains no cookies, passwords, tokens or
environment values. An ordinary GET never changes those records or counters.

POST accepts these optional JSON fields; unknown fields are rejected:

| Field        | Values                                                                 | Effect                                                                                                                               |
| ------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `reset`      | `true` / `false`                                                       | Restore defaults (`two`, inside site A, 300 ms GPS delay), clear rows and counters, then apply other fields.                         |
| `scenario`   | `none`, `one`, `two`, `load_error`                                     | Reset records and counters. Give active fake agents zero, one or two active assignments; `load_error` returns a database read error. |
| `geoMode`    | `inside`, `outside`, `denied`, `unavailable`, `timeout`, `unsupported` | Select simulated GPS success or error. No real position is requested.                                                                |
| `geoSite`    | `0`, `1`                                                               | Inside position for site A or B. Outside is always a distant fake point.                                                             |
| `geoDelayMs` | Integer `0`–`5000`                                                     | Callback delay for pending-state and repeated-click checks.                                                                          |
| `seedOpen`   | `true` / `false`                                                       | Seed one open shift for known/new fake agents, without an application write.                                                         |
| `race`       | `insert`, `close`, `null`                                              | On the next corresponding write, simulate a competing insert (`23505`) or close (no rows updated).                                   |
| `deactivate` | `site`, `assignment`, `both`                                           | Deactivate the open shift's site/assignment, or site A if none is open.                                                              |
| `siteId`     | A site UUID from the snapshot                                          | Optional target for `deactivate`.                                                                                                    |

Changing `scenario` replaces existing work sessions. To change GPS during a shift,
send only `geoMode`/`geoSite`, without `scenario` or `reset`. `unsupported` requires
a full document reload because it installs `navigator.geolocation = undefined`.
Other modes are read again when the user clicks, so a reload is unnecessary.

Site A is `(45.52, -73.58)` and site B is `(45.54, -73.62)`, both with a 150 m
radius. Their names are `Demo site A` and `Demo site B`. All UUIDs and timestamps
are generated by the fixture process. All badge numbers remain strings.

The browser mock explicitly calls GET with `geoRequest=1` and the requested
`enableHighAccuracy`, `timeout`, and `maximumAge` query parameters. Only this
instrumented GET appends an options record. It never receives real coordinates.

## Suggested browser scenarios

- `none`: the bilingual no-assignment state has no start button.
- `one`: the sole site is selected automatically; start/end records one shift.
- `two`: a site must be selected before starting; only one shift can remain open.
- `inside` then `outside`: outside checkout remains allowed with a visible warning.
- `denied`, `unavailable`, `timeout`, `unsupported`: localized errors and no writes.
- Pending double clicks: GPS/Server Action lock prevents duplicate requests.
- `race: insert`: application reports an already-open shift without a duplicate row.
- `race: close`: application reports an already-completed shift without rewriting it.
- Open shift plus `deactivate: both`: the existing shift can still be read/closed.
- `load_error`: a genuine load failure is displayed instead of “no assignment”.

The fixture supports the repository's equality, membership, null/not-null,
ordering, limiting, projection, single and maybe-single queries. It enforces
ownership, active assignments/sites for check-in, a single open shift, conditional
checkout and immutable closed rows. Only work-session inserts and checkout
updates are accepted; other fixture-table mutations fail closed.
