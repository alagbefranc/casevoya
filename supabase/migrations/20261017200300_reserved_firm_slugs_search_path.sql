-- Pin search_path on app.reserved_firm_slugs. The original body is a constant list
-- with no schema-qualified types. storage.objects is not altered.

create or replace function app.reserved_firm_slugs()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'support'::pg_catalog.text,
    'billing'::pg_catalog.text,
    'admin'::pg_catalog.text,
    'hello'::pg_catalog.text,
    'noreply'::pg_catalog.text,
    'postmaster'::pg_catalog.text,
    'abuse'::pg_catalog.text,
    'security'::pg_catalog.text,
    'help'::pg_catalog.text,
    'info'::pg_catalog.text,
    'team'::pg_catalog.text
  ]::pg_catalog.text[];
$$;

revoke all on function app.reserved_firm_slugs() from public;
grant execute on function app.reserved_firm_slugs() to authenticated, service_role;
