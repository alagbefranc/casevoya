-- SEC-01 client two-step, second part. app.session_assurance_ok() (20261030200000) is added to
-- the client / self branches of the e-sign, portal booking and document-request gates:
--   e-sign:     app.can_read_agreement (agreements, versions, envelopes, signers, events and the
--               executed / certificate PDFs), app.accept_quote, a check on person signers moving
--               to signed / declined in public.envelope_signers (covers the client branches of
--               app.sign_agreement and app.decline_agreement), representation_authorities_select.
--   booking:    app.booking_person_is_me (bookings_select, app.portal_booking_caller_ok and so the
--               portal cancel / reschedule / availability / rules functions, the client role of
--               video calls, portal_consultation_summaries). public.booking_public_hold links a
--               signed-in client's person only when the session passes the check; otherwise the
--               booking is made as for a visitor. Visitors without a session are unaffected.
--   documents:  app.can_read_document, app.can_read_storage_object, app.actor_can_upload_for (so
--               create_upload_intent and attach_upload_to_request), document_requests_select.
--               Co-applicant uploads and portal_request_person_names go through
--               app.can_read_matter, already covered.
-- app.my_person_id is not changed: it is used only by the two-step and consent settings in
-- 20261025270100, which must keep working before the second step.
-- Staff branches are unchanged. Each function is copied from its latest definition (named above
-- it) with only the client condition changed; create or replace keeps grants.


-- From 20261019180100_scheduling_core.sql (its only definition). Used only for the client side.
create or replace function app.booking_person_is_me(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_person_id is not null
     and (select auth.uid()) is not null
     and exists (
       select 1 from public.persons person
       where person.id = p_person_id and person.user_id = (select auth.uid())
     )
     and (select app.session_assurance_ok());
$$;


-- From 20261028120000_firm_privacy_notice.sql. Only the person link condition changes.
create or replace function public.booking_public_hold(
  p_firm_slug text,
  p_event_slug text,
  p_start timestamptz,
  p_name text,
  p_email text,
  p_phone text,
  p_time_zone text,
  p_idempotency_key text,
  p_client_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  et public.booking_event_types%rowtype;
  key text := btrim(coalesce(p_idempotency_key, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  zone text := btrim(coalesce(p_time_zone, ''));
  hash text := nullif(lower(btrim(coalesce(p_client_hash, ''))), '');
  existing public.bookings%rowtype;
  me uuid;
  bid uuid;
begin
  select et2.* into et
  from public.booking_event_types et2
  join public.organizations org on org.id = et2.organization_id
  where org.slug = lower(btrim(coalesce(p_firm_slug, '')))
    and et2.slug = lower(btrim(coalesce(p_event_slug, '')))
    and et2.is_published and et2.archived_at is null
    and (not et2.is_sample or app.booking_practice_viewer(et2.organization_id))
    and (et2.is_sample or app.firm_booking_pages_open(et2.organization_id));
  if et.id is null then
    raise exception 'booking type not found' using errcode = 'P0002';
  end if;
  if et.price_cents > 0 then
    raise exception 'paid consultations are not available yet' using errcode = '22023';
  end if;
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if hash is not null and hash !~ '^[0-9a-f]{64}$' then
    hash := null;
  end if;

  select * into existing from public.bookings b where b.organization_id = et.organization_id and b.idempotency_key = key;
  if existing.id is not null then
    if existing.starts_at <> p_start or not exists (
      select 1 from public.booking_attendees a where a.booking_id = existing.id and a.role = 'primary' and a.email = v_email
    ) then
      raise exception 'idempotency key reused for a different booking' using errcode = '22023';
    end if;
    return app.booking_summary(existing.id);
  end if;

  -- Basic abuse limits: 8 requests per client address and 60 per firm in 10 minutes. From here on
  -- a refusal is returned, not raised, so the attempt row (and the audit row) are kept and count.
  insert into public.booking_hold_attempts (organization_id, client_hash) values (et.organization_id, hash);
  if (hash is not null and (
        select count(*) from public.booking_hold_attempts a
        where a.client_hash = hash and a.created_at > now() - interval '10 minutes') > 8)
     or (select count(*) from public.booking_hold_attempts a
         where a.organization_id = et.organization_id and a.created_at > now() - interval '10 minutes') > 60 then
    return jsonb_build_object('error', 'booking_rate_limited');
  end if;

  if p_name is null or length(btrim(p_name)) not between 1 and 200 then
    return jsonb_build_object('error', 'name_required');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 320 then
    return jsonb_build_object('error', 'email_invalid');
  end if;
  if p_phone is not null and btrim(p_phone) <> '' and btrim(p_phone) !~ '^[0-9+() .-]{3,40}$' then
    return jsonb_build_object('error', 'phone_invalid');
  end if;
  if not app.is_time_zone(zone) then
    return jsonb_build_object('error', 'time_zone_invalid');
  end if;

  -- A signed-in portal client of this firm booking for themselves is linked to their own person,
  -- when the session has their second step (if they have one).
  if (select auth.uid()) is not null and app.session_assurance_ok() then
    select person.id into me
    from public.persons person
    where person.organization_id = et.organization_id and person.user_id = (select auth.uid());
  end if;

  -- practice booking pages: a booking on a practice page is a sample booking.
  bid := app.place_booking(et.id, p_start, p_name, v_email, p_phone, zone, me, 'public', 'client', key, et.is_sample, true);
  if bid is null then
    perform app.booking_audit(et.organization_id, 'booking.slot_unavailable', null, 'denied',
      jsonb_build_object('event_type_id', et.id, 'starts_at', p_start));
    return jsonb_build_object('error', 'slot_unavailable');
  end if;
  perform app.confirm_booking(bid, 'client');
  -- booking type agreement: the type's approved consultation agreement is sent with the booking,
  -- for the booker to sign from the confirmation page or the email.
  if et.agreement_template_id is not null then
    perform app.issue_booking_agreement(bid, et.agreement_template_id, null, false);
  end if;
  return app.booking_summary(bid);
end;
$$;


-- From 20261017190100_inhouse_esign.sql (its only definition).
create or replace function app.can_read_agreement(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agreements agreement
    where agreement.id = p_id
      and agreement.organization_id = (select app.current_organization_id())
      and (
        (
          (select app.staff_mfa_satisfied())
          and (select app.has_org_role(
            agreement.organization_id,
            array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
          ))
          and (select app.can_read_matter(agreement.matter_id))
        )
        or (select app.can_read_matter_billing(agreement.matter_id))
        or (
          agreement.kind = 'quote'
          and exists (
            select 1
            from public.matter_participants party
            join public.persons person
              on person.id = party.person_id
             and person.organization_id = party.organization_id
            where party.matter_id = agreement.matter_id
              and party.organization_id = agreement.organization_id
              and person.user_id = (select auth.uid())
          )
          and (select app.session_assurance_ok())
        )
        or exists (
          select 1
          from public.signature_envelopes envelope
          join public.envelope_signers signer
            on signer.envelope_id = envelope.id
           and signer.organization_id = envelope.organization_id
          left join public.persons person
            on person.id = signer.person_id
           and person.organization_id = signer.organization_id
          left join public.memberships mem
            on mem.id = signer.membership_id
           and mem.organization_id = signer.organization_id
          where envelope.agreement_id = agreement.id
            and (
              (
                person.user_id = (select auth.uid())
                and (select app.session_assurance_ok())
              )
              or (mem.user_id = (select auth.uid()) and mem.status = 'active')
            )
        )
      )
  );
$$;


-- From 20261020140100_quote_builder_editor_compare.sql.
create or replace function app.accept_quote(p_agreement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.agreements%rowtype;
begin
  select * into agreement from public.agreements where id = p_agreement_id for update;
  if agreement.id is null or agreement.kind <> 'quote' or agreement.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'quote denied' using errcode = '42501';
  end if;
  if agreement.quote_expires_on is not null and agreement.quote_expires_on < app.firm_today(agreement.organization_id) then
    raise exception 'quote expired' using errcode = '42501';
  end if;
  if agreement.status = 'accepted' then
    return;
  end if;
  if agreement.status <> 'sent' then
    raise exception 'quote denied' using errcode = '42501';
  end if;
  if app.can_read_agreement(agreement.id) is distinct from true
     and not (
       exists (
         select 1
         from public.matter_participants party
         join public.persons person on person.id = party.person_id
         where party.matter_id = agreement.matter_id
           and person.user_id = (select auth.uid())
       )
       and app.session_assurance_ok()
     ) then
    raise exception 'quote denied' using errcode = '42501';
  end if;
  perform app.open_esign_write(agreement.id);
  update public.agreements
  set status = 'accepted',
      accepted_at = statement_timestamp(),
      accepted_by = (select auth.uid())
  where id = agreement.id;
  perform app.close_esign_write(agreement.id);
  perform app.record_audit_event(
    agreement.organization_id, 'agreement.quote_accepted', 'public.agreements', agreement.id, 'success',
    jsonb_build_object('matter_id', agreement.matter_id, 'accepted_by', (select auth.uid()))
  );
end;
$$;


-- A person signer (a portal client) signs or declines only from a session that passes the
-- two-step check (the client branches of app.sign_agreement and app.decline_agreement).
create or replace function app.require_client_signer_assurance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.person_id is not null
     and new.status in ('signed', 'declined')
     and old.status is distinct from new.status
     and not app.session_assurance_ok() then
    raise exception 'two-step sign-in is required' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.require_client_signer_assurance() from public, anon;
grant execute on function app.require_client_signer_assurance() to authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'envelope_signers_client_assurance'
      and tgrelid = 'public.envelope_signers'::regclass
  ) then
    create trigger envelope_signers_client_assurance
      before update on public.envelope_signers
      for each row execute function app.require_client_signer_assurance();
  end if;
end;
$$;


-- From 20261017190100_inhouse_esign.sql (its only definition).
alter policy representation_authorities_select on public.representation_authorities
  using (
    organization_id = (select app.current_organization_id())
    and (
      (
        (select app.staff_mfa_satisfied())
        and (select app.can_read_matter(matter_id))
      )
      or (
        exists (
          select 1 from public.persons person
          where person.id = representation_authorities.person_id
            and person.user_id = (select auth.uid())
        )
        and (select app.session_assurance_ok())
      )
    )
  );


-- From 20261017180000_document_storage.sql (its only definition).
create or replace function app.can_read_document(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.documents doc
    where doc.id = p_id
      and doc.organization_id = (select app.current_organization_id())
      and (
        (
          (select app.staff_mfa_satisfied())
          and (select app.has_org_role(
            doc.organization_id,
            array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
          ))
          and (
            (select app.actor_is_firm_owner(doc.organization_id))
            or exists (
              select 1
              from public.document_matter_refs ref
              where ref.document_id = doc.id
                and ref.removed_at is null
                and (select app.can_read_matter(ref.matter_id))
            )
            or (
              doc.created_by = (select auth.uid())
              and not exists (
                select 1
                from public.document_matter_refs ref
                where ref.document_id = doc.id
                  and ref.removed_at is null
              )
            )
          )
        )
        or (
          doc.audience <> 'staff'
          and exists (
            select 1
            from public.persons person
            where person.id = doc.person_id
              and person.organization_id = doc.organization_id
              and person.user_id = (select auth.uid())
          )
          and (select app.session_assurance_ok())
        )
        or (
          doc.audience = 'matter'
          and doc.sensitivity = 'ordinary'
          and exists (
            select 1
            from public.document_matter_refs ref
            join public.matter_participants party
              on party.matter_id = ref.matter_id
             and party.organization_id = ref.organization_id
            join public.persons person
              on person.id = party.person_id
             and person.organization_id = party.organization_id
            where ref.document_id = doc.id
              and ref.removed_at is null
              and person.user_id = (select auth.uid())
          )
          and (select app.session_assurance_ok())
        )
        or (
          doc.sensitivity = 'ordinary'
          and doc.audience <> 'staff'
          and exists (
            select 1
            from public.document_matter_refs ref
            where ref.document_id = doc.id
              and ref.removed_at is null
              and (select app.grant_allows(doc.person_id, doc.organization_id, ref.matter_id))
          )
        )
      )
  );
$$;


-- From 20261018010400_document_download_grants.sql.
create or replace function app.can_read_storage_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_versions version
    join public.documents doc
      on doc.id = version.document_id
     and doc.organization_id = version.organization_id
    where version.storage_key = p_name
      and version.storage_bucket = 'documents'
      and (select app.is_org_member(version.organization_id))
      and (
        (
          -- The uploader reads back its own in-flight object (Storage upload returns the row).
          version.upload_state = 'uploading'
          and version.created_by = (select auth.uid())
          and version.intent_expires_at > statement_timestamp()
        )
        or (
          version.upload_state = 'clean'
          -- A fresh, audited authorization from authorize_document_download is required.
          and exists (
            select 1
            from app.document_download_grants grant_row
            where grant_row.storage_key = p_name
              and grant_row.version_id = version.id
              and grant_row.user_id = (select auth.uid())
              and grant_row.expires_at > statement_timestamp()
          )
          and (
            (
              doc.audience <> 'staff'
              and exists (
                select 1
                from public.persons person
                where person.id = doc.person_id
                  and person.user_id = (select auth.uid())
              )
              and (select app.session_assurance_ok())
            )
            or (
              doc.audience = 'matter'
              and doc.sensitivity = 'ordinary'
              and exists (
                select 1
                from public.document_matter_refs ref
                join public.matter_participants party
                  on party.matter_id = ref.matter_id
                 and party.organization_id = ref.organization_id
                join public.persons person
                  on person.id = party.person_id
                 and person.organization_id = party.organization_id
                where ref.document_id = doc.id
                  and ref.removed_at is null
                  and person.user_id = (select auth.uid())
              )
              and (select app.session_assurance_ok())
            )
            or (
              (select app.staff_mfa_satisfied())
              and (select app.has_org_role(
                doc.organization_id,
                array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
              ))
              and (
                (select app.actor_is_firm_owner(doc.organization_id))
                or exists (
                  select 1
                  from public.document_matter_refs ref
                  join public.matter_participants party
                    on party.matter_id = ref.matter_id
                   and party.organization_id = ref.organization_id
                  join public.memberships membership
                    on membership.id = party.membership_id
                   and membership.organization_id = party.organization_id
                  where ref.document_id = doc.id
                    and ref.removed_at is null
                    and membership.user_id = (select auth.uid())
                    and membership.status = 'active'
                    and membership.role = any (
                      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
                    )
                )
              )
            )
          )
        )
      )
  );
$$;


-- From 20261029100000_portal_co_applicant_uploads.sql. Only the person's own branch changes.
create or replace function app.actor_can_upload_for(p_matter_id uuid, p_person_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  ingest_org uuid;
begin
  select * into matter from public.matters where id = p_matter_id;
  ingest_org := app.email_ingest_org();
  if matter.id is null
     or matter.organization_id is distinct from coalesce((select app.current_organization_id()), ingest_org) then
    return false;
  end if;
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    return false;
  end if;
  if not exists (
    select 1
    from public.persons person
    join public.matter_participants party
      on party.person_id = person.id
     and party.matter_id = matter.id
     and party.organization_id = matter.organization_id
    where person.id = p_person_id
      and person.organization_id = matter.organization_id
      and person.is_sample is not distinct from matter.is_sample
  ) then
    return false;
  end if;
  if ingest_org is not null and matter.organization_id = ingest_org then
    return true;
  end if;
  if exists (
    select 1
    from public.persons person
    where person.id = p_person_id
      and person.user_id = (select auth.uid())
  ) and app.session_assurance_ok() then
    return true;
  end if;
  if app.staff_mfa_satisfied()
     and app.mfa_step_up_satisfied()
     and app.has_org_role(
       matter.organization_id,
       array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
     )
     and app.can_read_matter(matter.id) then
    return true;
  end if;
  -- #272: someone else on the matter fulfilling a request for this person that they can see.
  return app.actor_may_fulfil_request_for(matter.id, p_person_id);
end;
$$;


-- From 20261017180100_document_requests.sql (its only definition). The matter branch already
-- goes through app.can_read_matter.
alter policy document_requests_select on public.document_requests
  using (
    organization_id = (select app.current_organization_id())
    and (
      (
        (select app.staff_mfa_satisfied())
        and (select app.has_org_role(
          organization_id,
          array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
        ))
        and (select app.can_read_matter(matter_id))
      )
      or (
        audience <> 'staff'
        and exists (
          select 1
          from public.persons person
          where person.id = document_requests.person_id
            and person.user_id = (select auth.uid())
        )
        and (select app.session_assurance_ok())
      )
      or (
        audience = 'matter'
        and sensitivity = 'ordinary'
        and (select app.can_read_matter(matter_id))
        and exists (
          select 1
          from public.matter_participants party
          join public.persons person
            on person.id = party.person_id
           and person.organization_id = party.organization_id
          where party.matter_id = document_requests.matter_id
            and party.organization_id = document_requests.organization_id
            and person.user_id = (select auth.uid())
        )
      )
    )
  );
