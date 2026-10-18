-- The API role could update every column of public.persons, including user_id (the person's
-- portal login), organization_id, is_minor and created_by. Row-level security limits WHICH rows
-- staff may edit (app.can_write_person), not which columns. A staff member who may edit a
-- person could otherwise attach a different sign-in to that person.
--
-- Column privileges now allow only the details staff edit from the Sheet: name, email, phone
-- and date of birth (with its precision; birth_date is the legacy mirror kept in sync by
-- app.sync_person_birth). Linking a login, sample flags, minor status and tenant keys change
-- only through SECURITY DEFINER functions (accept_portal_invitation and the triggers), which
-- run with their owner's rights and are unaffected. Nothing is dropped.

revoke update on table public.persons from authenticated, anon;
grant update (display_name, email, contact_phone, date_of_birth, birth_date, birth_date_precision)
  on table public.persons to authenticated;
