-- Processing consent for every portal role (decision 2026-10-17, option 1).
--
-- accept_portal_invitation required processing consent only from adult dependants, and
-- the client and sponsor screens sent processing_consent=true without showing a box, so
-- consent was recorded that nobody gave. The client and sponsor accept screens now show
-- the Designer's consent box (the one on the adult-dependant screen), and this function
-- refuses any acceptance without it and records the processing consent for every role.
--
-- Body copied from 20261017140800_portal_invitations.sql (the only definition); the two
-- adult_dependant conditions on processing consent are the only changes. Privileges are
-- kept by create or replace.

create or replace function public.accept_portal_invitation(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_email text;
  confirmed timestamptz;
  inv public.portal_invitations;
  person public.persons;
  status text;
  terms public.portal_policy_documents;
  privacy public.portal_policy_documents;
  locale text;
  email_notices boolean;
  sms_notices boolean;
  deadline_reminders boolean;
  processing boolean;
  ai_flag boolean;
  mem_id uuid;
  mem_status public.membership_status;
  share_key text;
  applicant_id uuid;
  subject uuid;
  statement_text text;
  consent_id uuid;
  denial text;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  inv := app.present_portal_invitation(p_token);
  if current_setting('app.portal_rate_limited', true) = '1' then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if inv.id is null then
    return jsonb_build_object('ok', false, 'error', 'invitation_cannot_be_accepted');
  end if;

  select users.email, users.email_confirmed_at into actor_email, confirmed
  from auth.users users
  where users.id = actor;
  status := app.portal_invitation_status(inv);
  denial := case
    when confirmed is null then 'confirmed_email_required'
    when lower(btrim(actor_email)) is distinct from inv.email then 'invitation_cannot_be_accepted'
    when status <> 'open' then 'invitation_cannot_be_accepted'
    else null
  end;
  if denial is not null then
    perform app.record_portal_audit(
      inv.organization_id,
      'portal_invitation.accept_denied',
      'public.portal_invitations',
      inv.id,
      'denied',
      jsonb_build_object('reason', denial, 'status', status)
    );
    return jsonb_build_object('ok', false, 'error', denial);
  end if;

  select * into person
  from public.persons
  where id = inv.person_id and organization_id = inv.organization_id
  for update;
  if person.date_of_birth is null or app.person_is_minor(person.id) then
    perform app.record_portal_audit(
      inv.organization_id, 'portal_invitation.minor_refused', 'public.persons', person.id, 'denied',
      jsonb_build_object('at', 'accept')
    );
    return jsonb_build_object(
      'ok', false,
      'error', case when person.date_of_birth is null then 'date_of_birth_required' else 'minor_cannot_hold_login' end
    );
  end if;
  if person.user_id is not null and person.user_id is distinct from actor then
    perform app.record_portal_audit(
      inv.organization_id, 'portal_invitation.accept_denied', 'public.persons', person.id, 'denied',
      jsonb_build_object('reason', 'person_already_linked')
    );
    return jsonb_build_object('ok', false, 'error', 'invitation_cannot_be_accepted');
  end if;

  terms := app.current_portal_policy(inv.organization_id, 'portal_terms');
  privacy := app.current_portal_policy(inv.organization_id, 'privacy_notice');
  if terms.id is null
     or p_payload is null
     or (p_payload ->> 'portal_terms_id') is distinct from terms.id::text then
    return jsonb_build_object('ok', false, 'error', 'portal_terms_required');
  end if;
  if privacy.id is null
     or (p_payload ->> 'privacy_notice_id') is distinct from privacy.id::text then
    return jsonb_build_object('ok', false, 'error', 'privacy_notice_required');
  end if;

  locale := coalesce(p_payload ->> 'locale', 'en-CA');
  if locale not in ('en-CA', 'fr-CA') then
    return jsonb_build_object('ok', false, 'error', 'invalid_locale');
  end if;
  email_notices := app.jsonb_bool(p_payload, 'email_notices');
  sms_notices := app.jsonb_bool(p_payload, 'sms_notices');
  deadline_reminders := app.jsonb_bool(p_payload, 'deadline_reminders');
  processing := app.jsonb_bool(p_payload, 'processing_consent');
  if email_notices is null or sms_notices is null or deadline_reminders is null or processing is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_draft');
  end if;
  if processing is not true then
    return jsonb_build_object('ok', false, 'error', 'processing_consent_required');
  end if;
  if sms_notices and person.contact_phone is null then
    return jsonb_build_object('ok', false, 'error', 'contact_phone_required');
  end if;
  if p_payload ? 'ai_drafting' and app.jsonb_bool(p_payload, 'ai_drafting') is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_draft');
  end if;

  if inv.role = 'guardian' then
    foreach subject in array inv.guardian_subject_ids loop
      if app.person_is_minor(subject) is distinct from true then
        return jsonb_build_object('ok', false, 'error', 'guardian_subject_not_minor');
      end if;
    end loop;
  end if;

  if inv.role = 'adult_dependant' and p_payload ? 'shares' then
    if jsonb_typeof(p_payload -> 'shares') is distinct from 'array' then
      return jsonb_build_object('ok', false, 'error', 'invalid_share');
    end if;
    select party.person_id into applicant_id
    from public.matter_participants party
    where party.matter_id = inv.matter_id
      and party.organization_id = inv.organization_id
      and party.role = 'applicant'
      and party.person_id is not null
      and party.person_id is distinct from inv.person_id
    order by party.created_at
    limit 1;
    for share_key in select jsonb_array_elements_text(p_payload -> 'shares') loop
      if share_key not in ('passport_bio', 'school_transcript', 'police_certificate', 'private_record') then
        return jsonb_build_object('ok', false, 'error', 'invalid_share');
      end if;
      if applicant_id is null then
        return jsonb_build_object('ok', false, 'error', 'applicant_required');
      end if;
    end loop;
  elsif p_payload ? 'shares' and jsonb_array_length(coalesce(p_payload -> 'shares', '[]'::jsonb)) > 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_share');
  end if;

  select mem.id, mem.status into mem_id, mem_status
  from public.memberships mem
  where mem.organization_id = inv.organization_id
    and mem.user_id = actor
    and mem.role = inv.role
  for update;
  if mem_id is null then
    insert into public.memberships (
      organization_id, user_id, role, status, invited_by, invited_at, created_by
    ) values (
      inv.organization_id, actor, inv.role, 'invited', inv.created_by, inv.created_at, inv.created_by
    )
    returning id into mem_id;
    mem_status := 'invited';
  end if;
  if mem_status = 'invited' then
    update public.memberships
       set status = 'active', accepted_at = statement_timestamp()
     where memberships.id = mem_id
       and memberships.status = 'invited';
  elsif mem_status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'error', 'invitation_cannot_be_accepted');
  end if;

  update public.persons
     set user_id = actor,
         email = coalesce(email, inv.email)
   where id = person.id
     and organization_id = inv.organization_id
     and (user_id is null or user_id = actor);
  if not found then
    raise exception 'invitation cannot be accepted' using errcode = '42501';
  end if;

  insert into public.person_contact_preferences (
    person_id, organization_id, email_notices, sms_notices, deadline_reminders, locale
  ) values (
    person.id, inv.organization_id, email_notices, sms_notices, deadline_reminders, locale
  )
  on conflict (person_id) do update
    set email_notices = excluded.email_notices,
        sms_notices = excluded.sms_notices,
        deadline_reminders = excluded.deadline_reminders,
        locale = excluded.locale;

  statement_text := 'I accept the firm portal terms.';
  insert into public.consent_records (
    organization_id, person_id, matter_id, invitation_id, purpose, policy_document_id, policy_version,
    statement_text, statement_sha256, granted
  ) values (
    inv.organization_id, person.id, inv.matter_id, inv.id, 'portal_terms', terms.id, terms.version_label,
    statement_text, app.portal_statement_hash(statement_text), true
  );
  statement_text := 'I have been shown the privacy information.';
  insert into public.consent_records (
    organization_id, person_id, matter_id, invitation_id, purpose, policy_document_id, policy_version,
    statement_text, statement_sha256, granted
  ) values (
    inv.organization_id, person.id, inv.matter_id, inv.id, 'privacy_notice', privacy.id, privacy.version_label,
    statement_text, app.portal_statement_hash(statement_text), true
  );
  statement_text := 'I agree that the firm can use my information to prepare this application.';
  insert into public.consent_records (
    organization_id, person_id, matter_id, invitation_id, purpose,
    statement_text, statement_sha256, granted
  ) values (
    inv.organization_id, person.id, inv.matter_id, inv.id, 'processing',
    statement_text, app.portal_statement_hash(statement_text), true
  );
  statement_text := 'Email me when something needs my attention.';
  insert into public.consent_records (
    organization_id, person_id, matter_id, invitation_id, purpose, scope,
    statement_text, statement_sha256, granted
  ) values (
    inv.organization_id, person.id, inv.matter_id, inv.id, 'contact_email', 'email',
    statement_text, app.portal_statement_hash(statement_text), email_notices
  );
  statement_text := 'Text me reminders.';
  insert into public.consent_records (
    organization_id, person_id, matter_id, invitation_id, purpose, scope,
    statement_text, statement_sha256, granted
  ) values (
    inv.organization_id, person.id, inv.matter_id, inv.id, 'contact_sms', 'sms',
    statement_text, app.portal_statement_hash(statement_text), sms_notices
  );
  statement_text := 'Remind me before a deadline.';
  insert into public.consent_records (
    organization_id, person_id, matter_id, invitation_id, purpose,
    statement_text, statement_sha256, granted
  ) values (
    inv.organization_id, person.id, inv.matter_id, inv.id, 'deadline_reminder',
    statement_text, app.portal_statement_hash(statement_text), deadline_reminders
  );
  if p_payload ? 'ai_drafting' then
    ai_flag := app.jsonb_bool(p_payload, 'ai_drafting');
    statement_text := 'The firm may use drafting help that a person at the firm reviews before it is used.';
    insert into public.consent_records (
      organization_id, person_id, matter_id, invitation_id, purpose,
      statement_text, statement_sha256, granted
    ) values (
      inv.organization_id, person.id, inv.matter_id, inv.id, 'ai_drafting',
      statement_text, app.portal_statement_hash(statement_text), ai_flag
    );
  end if;

  if inv.role = 'adult_dependant' and p_payload ? 'shares' then
    for share_key in select distinct jsonb_array_elements_text(p_payload -> 'shares') loop
      statement_text := 'Share the selected section with the applicant.';
      insert into public.consent_records (
        organization_id, person_id, matter_id, invitation_id, purpose, scope,
        statement_text, statement_sha256, granted
      ) values (
        inv.organization_id, person.id, inv.matter_id, inv.id, 'share_section', share_key,
        statement_text, app.portal_statement_hash(statement_text), true
      )
      returning id into consent_id;
      insert into public.section_shares (
        organization_id, subject_person_id, grantee_person_id, matter_id, section_key, consent_record_id
      )
      select inv.organization_id, person.id, applicant_id, inv.matter_id, share_key::public.person_section_key, consent_id
      where not exists (
        select 1
        from public.section_shares existing
        where existing.matter_id = inv.matter_id
          and existing.subject_person_id = person.id
          and existing.grantee_person_id = applicant_id
          and existing.section_key = share_key::public.person_section_key
          and existing.revoked_at is null
      );
    end loop;
  end if;

  if inv.role = 'guardian' then
    foreach subject in array inv.guardian_subject_ids loop
      insert into public.access_grants (
        organization_id, grantee_person_id, subject_person_id, matter_id, kind, purpose
      )
      select
        inv.organization_id, person.id, subject, inv.matter_id, 'guardian',
        'Guardian authority recorded when the guardian accepted the portal invitation.'
      where not exists (
        select 1
        from public.access_grants existing
        where existing.organization_id = inv.organization_id
          and existing.grantee_person_id = person.id
          and existing.subject_person_id = subject
          and existing.matter_id = inv.matter_id
          and existing.kind = 'guardian'
          and existing.revoked_at is null
      );
    end loop;
  end if;

  update public.profiles
     set preferred_locale = locale
   where id = actor;

  update public.portal_invitations
     set consumed_at = statement_timestamp(),
         consumed_by = actor,
         membership_id = mem_id
   where id = inv.id
     and consumed_at is null
     and revoked_at is null
     and declined_at is null
     and expires_at > statement_timestamp();
  if not found then
    raise exception 'invitation cannot be accepted' using errcode = '42501';
  end if;

  perform app.record_portal_audit(
    inv.organization_id,
    'portal_invitation.accepted',
    'public.memberships',
    mem_id,
    'success',
    jsonb_build_object('role', inv.role, 'invitation_id', inv.id, 'person_id', person.id)
  );
  perform app.enqueue_portal_notice(
    inv.organization_id,
    inv.id,
    'portal_invitation.accepted',
    jsonb_build_object('invitation_id', inv.id, 'role', inv.role, 'membership_id', mem_id),
    'portal-invite-accepted:' || inv.id::text
  );

  return jsonb_build_object(
    'ok', true,
    'membership_id', mem_id,
    'person_id', person.id,
    'matter_id', inv.matter_id,
    'organization_id', inv.organization_id,
    'role', inv.role
  );
end;
$$;
