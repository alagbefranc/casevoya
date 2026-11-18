-- Security review 2026-11-18: a person's portal login is linked only by the database.
--
-- persons.user_id says which sign-in is this person's client portal login. 20261019030000
-- stopped the API roles from changing it on UPDATE, but INSERT still accepted any value: a staff
-- member could add a person carrying another user's id (someone at another firm) and then use
-- public.reset_client_two_step on that row, which removes that user's two-step factors and
-- signs them out everywhere.
--
-- The only legitimate writer of user_id is public.accept_portal_invitation (SECURITY DEFINER:
-- it links the login after the invited email is confirmed). No function inserts a person with a
-- user_id. This trigger refuses an insert that carries one when the statement runs as an API
-- role. Inside a SECURITY DEFINER function current_user is the function's owner, so those paths
-- (and maintenance) are unchanged. Additive: one function, one trigger, no data change.

create function app.guard_person_login_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is not null and current_user in ('authenticated', 'anon') then
    raise exception 'a portal login is linked when the person accepts their invitation'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_person_login_link() from public, anon, authenticated;

comment on function app.guard_person_login_link() is
  'Refuses a persons insert that carries user_id when run as an API role: only accept_portal_invitation links a login.';

create trigger persons_a_login_link_guard
  before insert on public.persons
  for each row execute function app.guard_person_login_link();
