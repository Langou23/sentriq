-- Optional demo data: run manually as postgres after all migrations.
-- These fictional locations are illustrative coordinates within Montreal.
begin;

do $$
declare
  demo_agent_id uuid;
begin
  select id into demo_agent_id
  from public.profiles
  where badge_number = '100001' and role = 'agent' and is_active;

  if demo_agent_id is null then
    raise exception 'Profil agent actif 100001 introuvable. / Active agent profile 100001 not found.';
  end if;

  -- Never overwrite unrelated records that happen to use the reserved IDs.
  if exists (
    select 1 from public.sites
    where (id = 'de000000-0000-4000-8000-000000000001'
        and name <> 'DEMO SENTRIQ 01 — SITE FICTIF / FICTIONAL SITE')
      or (id = 'de000000-0000-4000-8000-000000000002'
        and name <> 'DEMO SENTRIQ 02 — SITE FICTIF / FICTIONAL SITE')
  ) then
    raise exception 'Identifiant de site démo déjà utilisé par un autre site. / Demo site ID already used by another site.';
  end if;

  insert into public.sites (
    id, name, address, latitude, longitude, radius_m, is_active
  ) values
    ('de000000-0000-4000-8000-000000000001',
      'DEMO SENTRIQ 01 — SITE FICTIF / FICTIONAL SITE',
      'Montréal — zone fictive de démonstration / fictional demo area',
      45.5200, -73.5800, 150, true),
    ('de000000-0000-4000-8000-000000000002',
      'DEMO SENTRIQ 02 — SITE FICTIF / FICTIONAL SITE',
      'Montréal — zone fictive de démonstration / fictional demo area',
      45.5400, -73.6200, 150, true)
  on conflict (id) do update set
    name = excluded.name,
    address = excluded.address,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    radius_m = excluded.radius_m,
    is_active = excluded.is_active;

  -- Reuse existing assignments instead of creating duplicates on a rerun.
  update public.assignments set is_active = true
  where agent_id = demo_agent_id and not is_active
    and site_id in ('de000000-0000-4000-8000-000000000001',
      'de000000-0000-4000-8000-000000000002');

  insert into public.assignments (agent_id, site_id, is_active)
  select demo_agent_id, site.id, true
  from public.sites as site
  where site.id in ('de000000-0000-4000-8000-000000000001',
      'de000000-0000-4000-8000-000000000002')
    and not exists (
      select 1 from public.assignments as assignment
      where assignment.agent_id = demo_agent_id and assignment.site_id = site.id
    );
end;
$$;

select profile.badge_number, site.name, site.latitude, site.longitude,
  site.radius_m, site.is_active as site_active,
  exists (
    select 1 from public.assignments as assignment
    where assignment.agent_id = profile.id
      and assignment.site_id = site.id and assignment.is_active
  ) as assignment_active
from public.profiles as profile
cross join public.sites as site
where profile.badge_number = '100001'
  and site.id in ('de000000-0000-4000-8000-000000000001',
    'de000000-0000-4000-8000-000000000002')
order by site.id;

commit;
