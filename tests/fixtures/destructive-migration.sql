-- Fixture for the additive checker. Not a real migration.
alter table public.example drop constraint example_key;

create or replace function public.hidden_delete()
returns void
language plpgsql
as $sql$
begin
  delete from public.only_inside_function;
end;
$sql$;

drop table public.example;
create or replace view public.bad as select 1;
delete from public.example;
