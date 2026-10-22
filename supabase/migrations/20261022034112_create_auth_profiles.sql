begin;

create type public.user_role as enum ('agent', 'supervisor', 'admin');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  badge_number text unique not null,
  first_name text,
  last_name text,
  role public.user_role not null default 'agent',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Read only the caller's stored role without recursively evaluating profiles RLS.
-- The trusted owner must retain RLS bypass; do not FORCE RLS on this table.
create function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles as profile
  where profile.id = (select auth.uid());
$$;

alter function public.current_user_role() owner to postgres;
revoke all on function public.current_user_role()
  from public, anon, authenticated, service_role;
grant execute on function public.current_user_role() to authenticated;

-- RLS restricts rows, so a trigger also protects privileged column changes.
-- Keep SECURITY INVOKER: current_user must be the actual database caller.
create function public.protect_profile_access_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Database administration and trusted backend provisioning remain privileged.
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if (new.role is distinct from old.role
      or new.is_active is distinct from old.is_active)
      and (select public.current_user_role())
        is distinct from 'admin'::public.user_role then
    raise exception using
      errcode = '42501',
      message = 'Only administrators can change profile roles or active status.';
  end if;

  -- Admins manage other profiles' access, not their personal fields.
  if old.id is distinct from (select auth.uid())
      and (new.badge_number is distinct from old.badge_number
        or new.first_name is distinct from old.first_name
        or new.last_name is distinct from old.last_name) then
    raise exception using
      errcode = '42501',
      message = 'Users can only change their own personal profile fields.';
  end if;

  return new;
end;
$$;

create function public.set_profile_updated_at()
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

create trigger profiles_protect_access_fields
before update on public.profiles
for each row execute function public.protect_profile_access_fields();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_profile_updated_at();

revoke all on function public.protect_profile_access_fields()
  from public, anon, authenticated, service_role;
revoke all on function public.set_profile_updated_at()
  from public, anon, authenticated, service_role;

-- Remove Supabase's possible default grants before exposing only needed operations.
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (badge_number, first_name, last_name, role, is_active)
  on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy profiles_select_supervisor_or_admin
on public.profiles
for select
to authenticated
using ((select public.current_user_role()) in ('supervisor', 'admin'));

create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy profiles_update_admin
on public.profiles
for update
to authenticated
using ((select public.current_user_role()) = 'admin')
with check ((select public.current_user_role()) = 'admin');

-- No client INSERT or DELETE policy: profile provisioning requires a trusted path.
commit;
