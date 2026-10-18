-- Firm logos (firm setup, Branding step).
--
-- The logo file is stored in a private bucket written only by the server (service role, from
-- /api/firm/logo) after it has checked the bytes are PNG or JPEG. SVG is not accepted. There are
-- no storage.objects policies for it; storage tables are not altered. Logos are shown through
-- short-lived signed links made by the server.
--
-- organizations.branding.logo_locator already exists (save_firm_setup, branding step). It may now
-- only name this firm's own file in the bucket: "firm-logos/<organization id>/<uuid>.png|jpg".
-- The check is NOT VALID so existing rows are not rescanned; the app never stored a logo before
-- this change, so no row is expected to hold one.

alter table public.organizations
  add constraint organizations_branding_logo_ck check (
    branding ->> 'logo_locator' is null
    or (branding ->> 'logo_locator') ~ (
      '^firm-logos/' || id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$'
    )
  ) not valid;

do $firm_logos$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public)
  values ('firm-logos', 'firm-logos', false)
  on conflict (id) do nothing;
  -- Supabase's buckets table has these; a bare test schema may not.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    execute $limits$
      update storage.buckets
         set file_size_limit = 2097152,
             allowed_mime_types = array['image/png', 'image/jpeg']
       where id = 'firm-logos'
    $limits$;
  end if;
end
$firm_logos$;
