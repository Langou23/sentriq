# Agent timekeeping verification

The story is an authenticated agent choosing an assigned site, obtaining a single
browser position, invoking a guarded Server Action, persisting a work session
through the user-scoped Supabase client, and rendering its state and perimeter flag.

| Boundary                       | Evidence                                                                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and role guards | Existing HTTP auth suite passed against the built application: sign-in/out, inactive/missing profiles, and cross-role redirects.                                                                           |
| Unit decisions and SDK queries | 163 Vitest cases and 214 existing Node auth cases passed. Timekeeping tests exercise real Zod schemas, Haversine calculations, repository logic, owner filters and mutation payloads.                      |
| PostgreSQL access              | All four migrations applied in isolated PostgreSQL. The 75 profile, 153 timekeeping and 47 open-site access checks passed; all fixtures rolled back.                                                       |
| Browser location               | Injected GPS replacement was verified by a DOM marker set after installation. Requests used `enableHighAccuracy: true`, `timeout: 15000`, and `maximumAge: 0`; no real GPS was requested.                  |
| Browser to Server Action       | A single assigned site required no radio selection. Two sites required a selection. Double-clicking produced one location request and one insert for the selected site.                                    |
| Server Action to data          | Inside check-in stored distance zero and a true perimeter flag. Outside check-in/checkout remained accepted and stored false flags. Server-generated times and conditional checkout writes were exercised. |
| Data to interface              | The running shift showed the site, Quebec start time, ticking duration and checkout action. The outside badge persisted for the latest completed shift after a full reload.                                |
| Error states                   | Denied, unavailable, timed-out and unsupported GPS produced bilingual errors and no writes. No assignment rendered its dedicated message; query failure rendered a service error instead.                  |
| Concurrent changes             | Simulated competing check-in/checkout produced localized already-open/already-closed errors without duplicate inserts or rewritten history. Refresh exposed the committed state.                           |
| Revoked assignment/site        | An open shift remained readable and could be closed after both the site and assignment were deactivated.                                                                                                   |
| Mobile and runtime             | The configured 390 px mobile viewport had no horizontal overflow (375 px document client and scroll widths). No browser console errors or warnings occurred.                                               |

The browser checks use the isolated fixture described in [README.md](README.md).
They verify the built Next.js application and real Supabase SDK against controlled
upstream responses, not hosted deployment state or real-device GPS accuracy.
The PostgreSQL checks independently verify the actual access policies.

The new `20261024020330_allow_open_session_site_read.sql` migration must be
applied manually to the hosted Supabase project before acceptance testing there.
No hosted Auth account, profile, work session or device location was changed or
collected during these checks. See the module README for the direct-table access
and client-reported GPS boundaries.
