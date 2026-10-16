# SentriQ — Permanent conventions

These conventions apply throughout this repository.

## Stack and repository

- Use Next.js App Router, strict TypeScript, Tailwind CSS, shadcn/ui, and Supabase.
- Follow the versions and Node.js engine declared in the existing package manifests.
- Use npm workspaces and the single root `package-lock.json`.
- Run repository commands from the SentriQ root. The web application is in `apps/web/`.
- Keep reusable packages in `packages/`, persistence migrations in `supabase/migrations/`,
  architecture notes in `docs/architecture/`, and decisions in `docs/decisions/` as they are introduced.

## Language and TypeScript

- Write code, identifiers, and comments in English.
- Every user-facing interface must support both French and English, including labels,
  actions, validation messages, errors, loading states, and empty states.
- Keep TypeScript `strict` enabled.
- Avoid `any`. If it is unavoidable, keep its scope narrow and add a nearby English
  comment explaining why a safer type cannot be used.
- Prefer `unknown` with validation or narrowing, explicit domain types, and generics.

## Modular monolith

- SentriQ is a modular monolith. Domain modules such as `auth`, `incidents`, and
  `dispatch` have explicit responsibilities and clear boundaries.
- Each module exposes a deliberate public interface. Other modules must use that
  interface instead of importing internal files, reaching into private implementation
  details, or bypassing the owning module to manipulate its data.
- Keep domain logic separate from framework adapters and infrastructure integrations.
  Make dependencies and data ownership explicit; avoid circular dependencies.
- The monorepo must allow a module to be extracted into an independent service later.
  Preserve clear contracts and isolate infrastructure concerns accordingly.
- Implement the simplest design that meets the current need. Do not introduce
  speculative services, distributed infrastructure, or generic abstraction frameworks.

## Asynchronous work

- Use Supabase Realtime for live updates where the product needs them.
- Run background work through Supabase Edge Functions or scheduled jobs, as appropriate.
- Never run long processing synchronously in a user-facing HTTP request. Accept the
  work, hand it off, and expose its status through an explicit contract when needed.
- Keep jobs bounded, retryable, and idempotent where retries can occur. Respect the
  execution constraints of the chosen worker or job mechanism.

## Persistence and RLS

- Every persisted data model must be introduced through a versioned Supabase migration
  committed under `supabase/migrations/`.
- Version changes to tables, columns, constraints, indexes, functions, triggers,
  required seed/reference data, and access policies. Do not rely on unversioned
  dashboard changes as the source of truth.
- Enable Row Level Security (RLS) on every new table in the migration that creates it.
  Define explicit, least-privilege policies for the roles and operations that need access.
  Verify both allowed and denied access; enabling RLS alone does not grant access.
- Normal application reads and writes use the migrated models and their access rules;
  individual runtime records do not require their own migration.
- Keep privileged Supabase credentials server-side. Browser code uses only the public
  anon/publishable key and must rely on RLS for data access.

## Secrets and commits

- Never commit a secret, private token, privileged key, credential-bearing URL, or an
  environment file containing local values. Never print credentials in logs or reports.
- Keep `.env*` ignored, including `apps/web/.env.local` and temporary credential files.
  Refer to environment variable names in source code rather than hardcoded values.
- Before **every commit**, inspect `git status`, verify `.env.local` is ignored with
  `git check-ignore -v apps/web/.env.local`, and confirm `git ls-files -- apps/web/.env.local`
  returns nothing. Inspect staged filenames and content for secrets, including newly added files.
- If an environment file is already tracked, stop and fix the tracked state before committing.
  An ignore rule does not remove a previously tracked file.
- Use Conventional Commits: `feat:`, `fix:`, `chore:`, and `docs:`.

## Definition of done

No step is finished until **all** of the following are true:

1. The requested implementation and relevant verification are complete.
2. These commands all succeed from the repository root against the final changes:

   ```sh
   npm run build
   npm run lint
   npm run typecheck
   ```

   On Windows, use `npm.cmd` if PowerShell blocks the `npm.ps1` wrapper.

3. The staged changes have passed the secret and environment-file checks above.
4. The work is committed and pushed to `main` on `origin`.
5. The remote `main` commit is verified to match the delivered local commit, with
   no remaining local changes belonging to the step.

If a check, authentication, or push fails, report the exact blocker and what remains.
Do not describe the step as finished while any required check or delivery action is outstanding.

## Build discipline and Turbopack recovery

- Never leave a development server running during a production build. Before starting
  `npm run build`, stop local Next.js development or production server processes that
  use this checkout's `apps/web/.next` directory.
- Run Next.js build and type-generation commands sequentially to avoid concurrent
  writes to generated output. Restart the development server only after the build finishes.
- If Turbopack panics without a clear cause, stop processes using this application's
  generated output, delete `apps/web/.next`, and rebuild.
- Before a recursive deletion, resolve and verify the absolute target is exactly this
  repository's `apps/web/.next`. Delete only that generated cache, then rerun the build.
  Preserve source files, local environment values, migrations, dependencies, and lockfiles.
