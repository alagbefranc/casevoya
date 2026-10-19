-- A correction must change the answer (found testing on production, 2026-10-19).
--
-- The portal's correction step starts from the answer already sent, so a client who pressed
-- Continue without editing it (or a direct call) created a "correction" identical to the original:
-- a new version and a CR number for nothing. public.request_intake_correction (copied from its only
-- definition, 20261020180000_intake_delivery.sql) now refuses a field correction whose presence and
-- value equal the latest version. Nothing else changes. Additive: one function body replaced.

create or replace function public.request_intake_correction(
  p_response_id uuid,
  p_field_key text,
  p_presence public.answer_presence,
  p_value jsonb,
  p_reason text,
  p_description text,
  p_proof_document_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  response public.intake_responses%rowtype;
  matter_sample boolean;
  previous uuid;
  new_answer uuid;
  next_number integer;
  new_id uuid;
  why text := nullif(btrim(coalesce(p_reason, '')), '');
  what text := nullif(btrim(coalesce(p_description, '')), '');
begin
  select * into response from public.intake_responses where id = p_response_id for update;
  if response.id is null
     or app.in_active_org(response.organization_id) is distinct from true
     or not exists (
       select 1
       from public.persons subject
       where subject.id = response.person_id
         and subject.organization_id = response.organization_id
         and subject.user_id = (select auth.uid())
     ) then
    raise exception 'intake correction denied' using errcode = '42501';
  end if;
  if response.status is distinct from 'submitted' then
    raise exception 'a correction is for answers you already sent; change this one in the form' using errcode = '42501';
  end if;
  select matter.is_sample into matter_sample from public.matters matter where matter.id = response.matter_id;
  if app.sample_mode_blocks_real(response.organization_id, matter_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if why is not null and length(why) > 1000 then
    raise exception 'keep the reason under 1000 characters' using errcode = '22023';
  end if;
  if what is not null and length(what) > 2000 then
    raise exception 'keep the description under 2000 characters' using errcode = '22023';
  end if;
  -- Proof is the person's own upload (the portal's ordinary upload flow) on this firm.
  if p_proof_document_id is not null and not exists (
    select 1
    from public.documents doc
    where doc.id = p_proof_document_id
      and doc.organization_id = response.organization_id
      and doc.person_id = response.person_id
  ) then
    raise exception 'that proof is not one of your documents' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_field_key, '')), '') is null then
    if what is null then
      raise exception 'describe what needs fixing' using errcode = '22023';
    end if;
  else
    select answer.id into previous
    from public.intake_answer_versions answer
    where answer.response_id = response.id
      and answer.field_key = p_field_key
    order by answer.created_at desc, answer.id desc
    limit 1;
    if previous is null then
      raise exception 'that question has no answer to correct' using errcode = '22023';
    end if;
    -- A correction must change the answer: the same presence and value as the latest version is
    -- not a correction (jsonb equality ignores key order).
    if exists (
      select 1
      from public.intake_answer_versions answer
      where answer.id = previous
        and answer.presence = p_presence
        and answer.raw_value is not distinct from coalesce(p_value, '{}'::jsonb)
    ) then
      raise exception 'that is the same as the answer you sent; change it, or describe the problem instead' using errcode = '22023';
    end if;
    new_answer := app.save_intake_answer_core(response.id, response.version, p_field_key, p_presence, p_value, true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('intake_corrections:' || response.organization_id::text, 0));
  select coalesce(max(correction_number), 0) + 1 into next_number
  from public.intake_corrections
  where organization_id = response.organization_id;

  insert into public.intake_corrections (
    organization_id, response_id, correction_number, field_key, previous_answer_id, answer_id, reason, description, proof_document_id
  ) values (
    response.organization_id,
    response.id,
    next_number,
    case when new_answer is null then null else p_field_key end,
    previous,
    new_answer,
    why,
    what,
    p_proof_document_id
  )
  returning id into new_id;

  perform app.record_audit_event(
    response.organization_id,
    'intake.correction_requested',
    'public.intake_corrections',
    new_id,
    'success',
    jsonb_build_object(
      'response_id', response.id,
      'matter_id', response.matter_id,
      'field_key', case when new_answer is null then null else p_field_key end,
      'answer_id', new_answer,
      'proof_document_id', p_proof_document_id,
      'is_sample', matter_sample
    )
  );
  return jsonb_build_object(
    'correction_id', new_id,
    'reference', 'CR-' || lpad(next_number::text, 4, '0'),
    'answer_id', new_answer
  );
end;
$$;
comment on function public.request_intake_correction(uuid, text, public.answer_presence, jsonb, text, text, uuid) is
  'The response''s own person corrects a submitted answer (a new version; the snapshot is unchanged) or describes a problem. Staff are alerted in Notifications.';
revoke all on function public.request_intake_correction(uuid, text, public.answer_presence, jsonb, text, text, uuid) from public, anon;
grant execute on function public.request_intake_correction(uuid, text, public.answer_presence, jsonb, text, text, uuid) to authenticated;
