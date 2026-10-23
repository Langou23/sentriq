begin;

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  latitude double precision not null,
  longitude double precision not null,
  radius_m integer not null default 150,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sites_latitude_range check (latitude between -90 and 90),
  constraint sites_longitude_range check (longitude between -180 and 180),
  constraint sites_radius_positive check (radius_m > 0)
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles (id),
  site_id uuid not null references public.sites (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles (id),
  site_id uuid not null references public.sites (id),
  check_in_at timestamptz not null default now(),
  check_in_lat double precision,
  check_in_lng double precision,
  check_in_distance_m integer,
  check_in_within_radius boolean,
  check_out_at timestamptz,
  check_out_lat double precision,
  check_out_lng double precision,
  check_out_distance_m integer,
  check_out_within_radius boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_sessions_check_in_latitude_range
    check (check_in_lat between -90 and 90),
  constraint work_sessions_check_in_longitude_range
    check (check_in_lng between -180 and 180),
  constraint work_sessions_check_out_latitude_range
    check (check_out_lat between -90 and 90),
  constraint work_sessions_check_out_longitude_range
    check (check_out_lng between -180 and 180),
  constraint work_sessions_check_in_distance_nonnegative
    check (check_in_distance_m >= 0),
  constraint work_sessions_check_out_distance_nonnegative
    check (check_out_distance_m >= 0),
  constraint work_sessions_checkout_after_checkin
    check (check_out_at >= check_in_at),
  constraint work_sessions_open_has_no_checkout_details check (
    check_out_at is not null
    or (check_out_lat is null and check_out_lng is null
      and check_out_distance_m is null and check_out_within_radius is null)
  )
);

-- Keep historical records when a referenced profile or site is removed:
-- foreign keys intentionally use NO ACTION instead of cascading deletes.
create index assignments_agent_site_active_idx
  on public.assignments (agent_id, site_id) where is_active;
create index assignments_site_id_idx on public.assignments (site_id);

-- PostgreSQL enforces this across sites and concurrent check-in transactions.
create unique index work_sessions_one_open_per_agent
  on public.work_sessions (agent_id) where check_out_at is null;
create index work_sessions_agent_history_idx
  on public.work_sessions (agent_id, check_in_at desc);
create index work_sessions_site_id_idx on public.work_sessions (site_id);

alter table public.sites enable row level security;
alter table public.assignments enable row level security;
alter table public.work_sessions enable row level security;

create function public.set_timekeeping_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- RLS controls rows; column grants and this trigger protect historical values.
-- Closed sessions are immutable even for API callers that bypass RLS.
create function public.protect_work_session_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.check_out_at is not null then
    raise exception using
      errcode = '42501',
      message = 'Closed work sessions cannot be modified.';
  end if;

  if new.id is distinct from old.id
      or new.agent_id is distinct from old.agent_id
      or new.site_id is distinct from old.site_id
      or new.check_in_at is distinct from old.check_in_at
      or new.check_in_lat is distinct from old.check_in_lat
      or new.check_in_lng is distinct from old.check_in_lng
      or new.check_in_distance_m is distinct from old.check_in_distance_m
      or new.check_in_within_radius is distinct from old.check_in_within_radius
      or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '42501',
      message = 'Work session identity and check-in values cannot be modified.';
  end if;

  return new;
end;
$$;

create trigger sites_set_updated_at
before update on public.sites
for each row execute function public.set_timekeeping_updated_at();

create trigger assignments_set_updated_at
before update on public.assignments
for each row execute function public.set_timekeeping_updated_at();

create trigger work_sessions_protect_history
before update on public.work_sessions
for each row execute function public.protect_work_session_history();

create trigger work_sessions_set_updated_at
before update on public.work_sessions
for each row execute function public.set_timekeeping_updated_at();

revoke all on function public.set_timekeeping_updated_at()
  from public, anon, authenticated, service_role;
revoke all on function public.protect_work_session_history()
  from public, anon, authenticated, service_role;

-- Remove possible Supabase default grants, including DELETE and TRUNCATE.
revoke all on table public.sites, public.assignments, public.work_sessions
  from public, anon, authenticated, service_role;

grant select on table public.sites, public.assignments, public.work_sessions
  to authenticated, service_role;

grant insert (name, address, latitude, longitude, radius_m, is_active),
  update (name, address, latitude, longitude, radius_m, is_active)
  on table public.sites to authenticated;
grant insert (agent_id, site_id, is_active),
  update (agent_id, site_id, is_active)
  on table public.assignments to authenticated;

-- The database owns identifiers, check-in time and audit timestamps.
-- A client can only insert an open session and only update checkout fields.
grant insert (
  agent_id, site_id, check_in_lat, check_in_lng,
  check_in_distance_m, check_in_within_radius
), update (
  check_out_at, check_out_lat, check_out_lng,
  check_out_distance_m, check_out_within_radius
) on table public.work_sessions to authenticated;

-- Trusted backend provisioning may import history, but cannot edit closed rows.
grant insert, update on table public.sites, public.assignments to service_role;
grant insert on table public.work_sessions to service_role;
grant update (
  check_out_at, check_out_lat, check_out_lng,
  check_out_distance_m, check_out_within_radius
) on table public.work_sessions to service_role;

create policy sites_select_active
on public.sites for select to authenticated
using ((select auth.uid()) is not null and is_active);

create policy sites_select_admin
on public.sites for select to authenticated
using (
  (select public.current_user_role()) = 'admin'
  and exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.is_active
  )
);

create policy sites_insert_admin
on public.sites for insert to authenticated
with check (
  (select public.current_user_role()) = 'admin'
  and exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.is_active
  )
);

create policy sites_update_admin
on public.sites for update to authenticated
using (
  (select public.current_user_role()) = 'admin'
  and exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.is_active
  )
)
with check (
  (select public.current_user_role()) = 'admin'
  and exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.is_active
  )
);

create policy assignments_select_own
on public.assignments for select to authenticated
using (
  agent_id = (select auth.uid())
  and (select public.current_user_role()) = 'agent'
  and exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.is_active
  )
);

create policy assignments_select_supervisor_or_admin
on public.assignments for select to authenticated
using (
  (select public.current_user_role()) in ('supervisor', 'admin')
  and exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.is_active
  )
);

create policy assignments_insert_admin
on public.assignments for insert to authenticated
with check (
  (select public.current_user_role()) = 'admin'
  and exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.is_active
  )
);

create policy assignments_update_admin
on public.assignments for update to authenticated
using (
  (select public.current_user_role()) = 'admin'
  and exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.is_active
  )
)
with check (
  (select public.current_user_role()) = 'admin'
  and exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.is_active
  )
);

create policy work_sessions_select_own
on public.work_sessions for select to authenticated
using (
  agent_id = (select auth.uid())
  and (select public.current_user_role()) = 'agent'
  and exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.is_active
  )
);

create policy work_sessions_select_supervisor_or_admin
on public.work_sessions for select to authenticated
using (
  (select public.current_user_role()) in ('supervisor', 'admin')
  and exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.is_active
  )
);

create policy work_sessions_insert_own_assigned
on public.work_sessions for insert to authenticated
with check (
  agent_id = (select auth.uid())
  and (select public.current_user_role()) = 'agent'
  and exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.is_active
  )
  and check_out_at is null
  and exists (
    select 1 from public.assignments as assignment
    join public.sites as site on site.id = assignment.site_id
    where assignment.agent_id = (select auth.uid())
      and assignment.site_id = work_sessions.site_id
      and assignment.is_active and site.is_active
  )
);

create policy work_sessions_update_own_open
on public.work_sessions for update to authenticated
using (
  agent_id = (select auth.uid()) and check_out_at is null
  and (select public.current_user_role()) = 'agent'
  and exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.is_active
  )
)
with check (
  agent_id = (select auth.uid()) and check_out_at is not null
  and (select public.current_user_role()) = 'agent'
  and exists (
    select 1 from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.is_active
  )
);

-- No client DELETE policy. Checkout deliberately does not recheck an assignment
-- or site: deactivation must not strand a session that was already opened.
commit;
