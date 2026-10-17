-- Platform admins and verified provincial nominee domains (Francis, 2026-10-17).
-- Additive only. No user id is seeded. The first admin row is inserted by hand.
--
-- Retrieval date for every page below: 2026-10-17.
-- A host already seeded in 20261017110000 is not inserted again.
-- Newly confirmed government hosts:
--   welcomebc.ca
--     https://www.welcomebc.ca/immigrate-to-b-c/about-the-bc-provincial-nominee-program
--     Server identified itself as the Government of British Columbia.
--   immigratemanitoba.com
--     https://immigratemanitoba.com/
--     https://www.gov.mb.ca/contact/faq.html names www.immigratemanitoba.com as the immigration section.
--   welcomenb.ca
--     https://www.welcomenb.ca/ returns 302 to https://www.gnb.ca/bil/immigration.html
--     NBPNP page: https://www.gnb.ca/en/topic/family-home-community/immigration/provincial-nominee-program.html
--   novascotiaimmigration.com
--     301 to https://liveinnovascotia.com/nova-scotia-nominee-program
--     Nova Scotia Department of Labour, Skills and Immigration, immigration@novascotia.ca.
--   liveinnovascotia.com
--     same NSNP page. novascotia.ca already covers lampss.novascotia.ca.
--   princeedwardisland.ca
--     https://www.princeedwardisland.ca/en/topic/immigration
--     Government of Prince Edward Island. gov.pe.ca/immigration returned 404.
--   immigratenwt.ca
--     https://www.immigratenwt.ca/ (Northwest Territories Nominee Program, links to www.gov.nt.ca)
--     Linked from https://www.ece.gov.nt.ca/en/services/immigration-and-nominee-program
-- Not added: liveinnovascotia.ca (TLS handshake failed). gov.nu.ca was already seeded;
-- this session's fetch was stopped by a Cloudflare challenge, and IRCC says Nunavut has no nominee program.
-- college-ic.ca was already seeded and was re-fetched at https://www.college-ic.ca/.

-- ---------------------------------------------------------------------------
-- Platform admins. Keyed by auth user id. Not an organization role.
-- ---------------------------------------------------------------------------
create table public.platform_admins (
  user_id uuid primary key references auth.users (id),
  note text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1)
);
comment on table public.platform_admins is
  'Platform operators. Membership here does not grant access to a firm''s rows. First row is inserted by the database owner; no user id is seeded.';

create index platform_admins_created_by_idx on public.platform_admins (created_by);

create trigger platform_admins_touch before update on public.platform_admins
  for each row execute function app.touch_row();
create trigger platform_admins_stamp before insert on public.platform_admins
  for each row execute function app.stamp_created_by();
create trigger platform_admins_audit after insert or update or delete on public.platform_admins
  for each row execute function app.audit_row_change();
create trigger platform_admins_no_delete before delete on public.platform_admins
  for each row execute function app.reject_governed_delete();
create trigger platform_admins_no_truncate before truncate on public.platform_admins
  for each statement execute function app.reject_governed_delete();

-- aal2 is required. A session with no user, including service_role, is not a platform admin.
create function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.staff_mfa_satisfied()
     and exists (
       select 1
       from public.platform_admins p
       where p.user_id = (select auth.uid())
     );
$$;
comment on function app.is_platform_admin() is
  'True when the signed-in user is in platform_admins and the JWT aal is aal2. Does not read tenant tables.';
revoke all on function app.is_platform_admin() from public;
grant execute on function app.is_platform_admin() to authenticated, service_role;

revoke all on table public.platform_admins from public, anon, authenticated, service_role;
grant select on table public.platform_admins to authenticated, service_role;
grant insert, update on table public.platform_admins to service_role;

alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;

create policy platform_admins_select_self on public.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy platform_admins_select_admin on public.platform_admins
  for select to authenticated
  using ((select app.is_platform_admin()));

-- Authenticated platform admins may insert and update the global allowlist.
-- service_role already has the grant and bypasses RLS.
grant insert, update on table public.official_source_domains to authenticated;

create policy official_source_domains_platform_select on public.official_source_domains
  for select to authenticated
  using ((select app.is_platform_admin()));

create policy official_source_domains_platform_insert on public.official_source_domains
  for insert to authenticated
  with check ((select app.is_platform_admin()));

create policy official_source_domains_platform_update on public.official_source_domains
  for update to authenticated
  using ((select app.is_platform_admin()))
  with check ((select app.is_platform_admin()));

-- Global catalog only. organization_id null is the platform row.
-- These policies do not match a firm row, so a platform admin does not gain tenant access.
create policy official_sources_platform_select on public.official_sources
  for select to authenticated
  using (organization_id is null and (select app.is_platform_admin()));

create policy official_sources_platform_insert on public.official_sources
  for insert to authenticated
  with check (organization_id is null and (select app.is_platform_admin()));

create policy official_sources_platform_update on public.official_sources
  for update to authenticated
  using (organization_id is null and (select app.is_platform_admin()))
  with check (organization_id is null and (select app.is_platform_admin()));

create policy rule_definitions_platform_select on public.rule_definitions
  for select to authenticated
  using (organization_id is null and (select app.is_platform_admin()));

create policy rule_definitions_platform_insert on public.rule_definitions
  for insert to authenticated
  with check (organization_id is null and (select app.is_platform_admin()));

create policy rule_definitions_platform_update on public.rule_definitions
  for update to authenticated
  using (organization_id is null and (select app.is_platform_admin()))
  with check (organization_id is null and (select app.is_platform_admin()));

create policy rule_versions_platform_select on public.rule_versions
  for select to authenticated
  using (organization_id is null and (select app.is_platform_admin()));

create policy rule_versions_platform_insert on public.rule_versions
  for insert to authenticated
  with check (organization_id is null and (select app.is_platform_admin()));

create policy rule_versions_platform_update on public.rule_versions
  for update to authenticated
  using (organization_id is null and (select app.is_platform_admin()))
  with check (organization_id is null and (select app.is_platform_admin()));

create policy rule_pack_versions_platform_select on public.rule_pack_versions
  for select to authenticated
  using (organization_id is null and (select app.is_platform_admin()));

create policy rule_pack_versions_platform_insert on public.rule_pack_versions
  for insert to authenticated
  with check (organization_id is null and (select app.is_platform_admin()));

create policy rule_pack_versions_platform_update on public.rule_pack_versions
  for update to authenticated
  using (organization_id is null and (select app.is_platform_admin()))
  with check (organization_id is null and (select app.is_platform_admin()));

create policy rule_pack_items_platform_select on public.rule_pack_items
  for select to authenticated
  using (organization_id is null and (select app.is_platform_admin()));

create policy rule_pack_items_platform_insert on public.rule_pack_items
  for insert to authenticated
  with check (organization_id is null and (select app.is_platform_admin()));

-- ---------------------------------------------------------------------------
-- Provincial nominee hosts confirmed on 2026-10-17. Allowlist entries only.
-- ---------------------------------------------------------------------------
insert into public.official_source_domains (host, match_kind, authority, jurisdiction_code, notes)
values
  (
    'welcomebc.ca',
    'suffix',
    'Government of British Columbia',
    'CA-BC',
    'Verified 2026-10-17. https://www.welcomebc.ca/immigrate-to-b-c/about-the-bc-provincial-nominee-program'
  ),
  (
    'immigratemanitoba.com',
    'suffix',
    'Province of Manitoba',
    'CA-MB',
    'Verified 2026-10-17. https://immigratemanitoba.com/ linked from https://www.gov.mb.ca/contact/faq.html'
  ),
  (
    'welcomenb.ca',
    'suffix',
    'Government of New Brunswick',
    'CA-NB',
    'Verified 2026-10-17. https://www.welcomenb.ca/ redirects to https://www.gnb.ca/bil/immigration.html'
  ),
  (
    'novascotiaimmigration.com',
    'suffix',
    'Nova Scotia Department of Labour, Skills and Immigration',
    'CA-NS',
    'Verified 2026-10-17. Redirects to https://liveinnovascotia.com/nova-scotia-nominee-program'
  ),
  (
    'liveinnovascotia.com',
    'suffix',
    'Nova Scotia Department of Labour, Skills and Immigration',
    'CA-NS',
    'Verified 2026-10-17. https://liveinnovascotia.com/nova-scotia-nominee-program'
  ),
  (
    'princeedwardisland.ca',
    'suffix',
    'Government of Prince Edward Island',
    'CA-PE',
    'Verified 2026-10-17. https://www.princeedwardisland.ca/en/topic/immigration'
  ),
  (
    'immigratenwt.ca',
    'suffix',
    'Government of the Northwest Territories',
    'CA-NT',
    'Verified 2026-10-17. https://www.immigratenwt.ca/ linked from https://www.ece.gov.nt.ca/en/services/immigration-and-nominee-program'
  );
