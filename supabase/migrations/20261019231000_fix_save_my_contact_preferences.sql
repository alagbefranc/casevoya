-- save_my_contact_preferences: the local variable person_id clashed with the column of the same
-- name in "on conflict (person_id)" (42702 ambiguous), so no client could ever save their
-- contact choices. Same body with the variable renamed v_person_id.

CREATE OR REPLACE FUNCTION public.save_my_contact_preferences(p_email_notices boolean, p_sms_notices boolean, p_deadline_reminders boolean, p_locale text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  org uuid := app.current_organization_id();
  v_person_id uuid;
  phone text;
  statement_text text;
begin
  if actor is null or org is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_locale not in ('en-CA', 'fr-CA') then
    raise exception 'locale is not usable' using errcode = '22023';
  end if;
  select person.id, person.contact_phone into v_person_id, phone
  from public.persons person
  where person.organization_id = org
    and person.user_id = actor;
  if v_person_id is null then
    raise exception 'contact preferences denied' using errcode = '42501';
  end if;
  if p_sms_notices is true and phone is null then
    raise exception 'contact phone is required for text reminders' using errcode = '22023';
  end if;
  insert into public.person_contact_preferences (
    person_id, organization_id, email_notices, sms_notices, deadline_reminders, locale
  ) values (
    v_person_id, org, coalesce(p_email_notices, false), coalesce(p_sms_notices, false),
    coalesce(p_deadline_reminders, false), p_locale
  )
  on conflict (person_id) do update
    set email_notices = excluded.email_notices,
        sms_notices = excluded.sms_notices,
        deadline_reminders = excluded.deadline_reminders,
        locale = excluded.locale;
  statement_text := 'Email me when something needs my attention.';
  insert into public.consent_records (
    organization_id, person_id, purpose, scope, statement_text, statement_sha256, granted
  ) values (
    org, v_person_id, 'contact_email', 'email', statement_text, app.portal_statement_hash(statement_text),
    coalesce(p_email_notices, false)
  );
  statement_text := 'Text me reminders.';
  insert into public.consent_records (
    organization_id, person_id, purpose, scope, statement_text, statement_sha256, granted
  ) values (
    org, v_person_id, 'contact_sms', 'sms', statement_text, app.portal_statement_hash(statement_text),
    coalesce(p_sms_notices, false)
  );
  statement_text := 'Remind me before a deadline.';
  insert into public.consent_records (
    organization_id, person_id, purpose, statement_text, statement_sha256, granted
  ) values (
    org, v_person_id, 'deadline_reminder', statement_text, app.portal_statement_hash(statement_text),
    coalesce(p_deadline_reminders, false)
  );
  update public.profiles set preferred_locale = p_locale where id = actor;
  perform app.record_portal_audit(
    org, 'contact_preferences.saved', 'public.persons', v_person_id, 'success',
    jsonb_build_object('locale', p_locale)
  );
end;
$function$
;
