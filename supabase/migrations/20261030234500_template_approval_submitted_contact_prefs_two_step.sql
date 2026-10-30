-- Security review follow-ups.
--
-- 1. ADM-03: a shared template version is approved only after it was submitted for review, and
--    only with the review hash the reviewer saw. The one-argument
--    public.approve_shared_template_version(uuid) now always refuses; the two-argument form
--    refuses a draft that has not been submitted. app.shared_template_approve is unchanged.
--    Both functions are copied from 20261030140000_shared_template_review_binding.sql.
-- 2. SEC-01: public.save_my_contact_preferences (client's own settings) needs
--    app.session_assurance_ok() (20261030200000). Copied from
--    20261019231000_fix_save_my_contact_preferences.sql.
--
-- create or replace keeps the existing grants.

-- ---------------------------------------------------------------------------
-- 1. Shared template approval
-- ---------------------------------------------------------------------------
create or replace function public.approve_shared_template_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'submit the draft for review, then approve it with its review hash' using errcode = '42501';
end;
$$;
comment on function public.approve_shared_template_version(uuid) is
  'ADM-03: retired. Submit the draft (public.submit_shared_template_version) and approve it with approve_shared_template_version(uuid, text).';

create or replace function public.approve_shared_template_version(p_version_id uuid, p_expected_review_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.shared_template_versions%rowtype;
begin
  if p_expected_review_hash is null or lower(btrim(p_expected_review_hash)) !~ '^[0-9a-f]{64}$' then
    raise exception 'the review hash is required' using errcode = '22023';
  end if;
  -- Reviewer checks first, then the row is locked for the rest of the transaction.
  perform app.platform_template_reviewer();
  select * into v from public.shared_template_versions where id = p_version_id for update;
  if v.id is not null and v.status = 'draft' and v.submitted_at is null then
    raise exception 'the draft has not been submitted for review' using errcode = '22023';
  end if;
  return app.shared_template_approve(p_version_id, p_expected_review_hash);
end;
$$;
comment on function public.approve_shared_template_version(uuid, text) is
  'ADM-03: a licensed platform admin with a fresh step-up publishes a draft that was submitted for review, only while it still has the review hash the reviewer saw (public.shared_template_review_hash). The service role cannot call this. Firms are notified. Existing matter pins are not moved.';

-- ---------------------------------------------------------------------------
-- 2. Client contact preferences: client two-step
-- ---------------------------------------------------------------------------
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
  if not app.session_assurance_ok() then
    raise exception 'two-step sign-in is required' using errcode = '42501';
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
