-- The firm's public enquiry page, its website embed and practice enquiries in sample mode
-- (CRM-01; branch `enquiry-share-embed`; docs/DECISIONS.md 2026-10-19).
--
-- 1. public.enquiry_public_firm(slug): what the hosted page (/enquiry/<firm>) and the embedded
--    form (/embed/enquiry/<firm>) may show about a firm before anyone types: its display name,
--    its slug, whether the page is a practice page, and whether the viewer is the firm's own staff
--    (the hosted page then shows them the "put this form on your website" card). It answers only when submit_enquiry would
--    take an enquiry: the firm exists, has a published privacy notice and an open lead stage, and
--    is either live or (sample mode) the viewer is the firm's own staff with staff MFA
--    (app.booking_practice_viewer, the rule practice booking pages already use). Everyone else
--    gets null, the same as an unknown firm, and the page answers 404. No ids, no branding, no
--    contact details: the page needs only the name.
--
-- 2. public.submit_enquiry (copied from its latest definition, 20261019201200_lead_functions.sql,
--    changed only as noted): a firm in sample mode no longer refuses every enquiry. Its own staff
--    (app.booking_practice_viewer) may send one from the practice page, and the lead is a sample
--    row (leads.is_sample = organizations.sample_mode). Anonymous visitors, other firms' staff and
--    the firm's portal clients still get form_unavailable, as before. Nothing else changes: the
--    privacy notice requirement, the abuse limits, idempotency, consent rows and audit.
--
-- Additive only: one new function, one function body replaced. No table, column or data change.

-- ---------------------------------------------------------------------------
-- What the public page may show
-- ---------------------------------------------------------------------------

create function public.enquiry_public_firm(p_firm_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'firm_name', org.display_name,
    'firm_slug', org.slug,
    'practice', org.sample_mode,
    'staff', app.booking_practice_viewer(org.id)
  )
  from public.organizations org
  where org.slug = lower(btrim(coalesce(p_firm_slug, '')))
    and exists (
      select 1 from public.portal_policy_documents doc
      where doc.organization_id = org.id and doc.kind = 'privacy_notice'
    )
    and app.lead_stage_of_kind(org.id, 'open') is not null
    and (org.sample_mode is not true or app.booking_practice_viewer(org.id));
$$;

comment on function public.enquiry_public_firm(text) is
  'The firm''s public enquiry page (CRM-01): name, slug and practice flag, or null when submit_enquiry would refuse (unknown firm, no privacy notice, sample mode for anyone but the firm''s staff).';

revoke all on function public.enquiry_public_firm(text) from public;
grant execute on function public.enquiry_public_firm(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public enquiry: practice enquiries in sample mode
-- ---------------------------------------------------------------------------

-- Minimal enquiry from the firm's hosted page or embedded form. Returns {"ok": true} or
-- {"error": code} for a refusal the visitor can act on (enquiry_rate_limited, name_required,
-- contact_required, email_invalid, phone_invalid, consent_required). Unknown firm, a firm without a
-- published privacy notice, or a firm in sample mode for anyone but its own staff:
-- {"error": "form_unavailable"}.
-- enquiry-share-embed: a sample-mode firm's staff (app.booking_practice_viewer) may send a practice
-- enquiry; the lead is a sample row (is_sample = the firm's sample_mode).
create or replace function public.submit_enquiry(
  p_firm_slug text,
  p_name text,
  p_contact text,
  p_preferred_contact text,
  p_service_interest text,
  p_country_now text,
  p_language text,
  p_reply_consent boolean,
  p_reply_statement text,
  p_marketing_consent boolean,
  p_marketing_statement text,
  p_consent_version text,
  p_source public.lead_source,
  p_idempotency_key text,
  p_client_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org public.organizations%rowtype;
  key text := btrim(coalesce(p_idempotency_key, ''));
  hash text := nullif(lower(btrim(coalesce(p_client_hash, ''))), '');
  v_name text := app.lead_text(p_name, 400);
  v_contact text := app.lead_text(p_contact, 400);
  v_email text;
  v_phone text;
  v_problem text;
  v_stage uuid;
  v_id uuid := gen_random_uuid();
  v_via text;
  v_version text := app.lead_text(p_consent_version, 40);
  v_sample boolean;
begin
  select * into org from public.organizations o where o.slug = lower(btrim(coalesce(p_firm_slug, '')));
  if org.id is null
     or (org.sample_mode is true and not app.booking_practice_viewer(org.id))
     or not exists (
       select 1 from public.portal_policy_documents doc where doc.organization_id = org.id and doc.kind = 'privacy_notice'
     ) then
    return jsonb_build_object('error', 'form_unavailable');
  end if;
  v_sample := coalesce(org.sample_mode, false);
  if p_source is null or p_source not in ('web_form', 'hosted_page') then
    raise exception 'choose the form' using errcode = '22023';
  end if;
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if hash is not null and hash !~ '^[0-9a-f]{64}$' then
    hash := null;
  end if;
  if v_version is not null and v_version !~ '^[A-Za-z0-9._-]{1,40}$' then
    v_version := null;
  end if;
  if exists (select 1 from public.leads l where l.organization_id = org.id and l.submission_key = key) then
    return jsonb_build_object('ok', true);
  end if;

  -- Abuse limits: 5 enquiries per client address and 100 per firm in 10 minutes.
  insert into public.lead_enquiry_attempts (organization_id, client_hash) values (org.id, hash);
  if (hash is not null and (
        select count(*) from public.lead_enquiry_attempts a
        where a.client_hash = hash and a.created_at > now() - interval '10 minutes') > 5)
     or (select count(*) from public.lead_enquiry_attempts a
         where a.organization_id = org.id and a.created_at > now() - interval '10 minutes') > 100 then
    return jsonb_build_object('error', 'enquiry_rate_limited');
  end if;

  if v_name is null or length(v_name) > 200 then
    return jsonb_build_object('error', 'name_required');
  end if;
  if v_contact is null then
    return jsonb_build_object('error', 'contact_required');
  end if;
  if position('@' in v_contact) > 0 then
    v_email := lower(v_contact);
  else
    v_phone := v_contact;
  end if;
  v_problem := app.lead_contact_problem(v_name, v_email, v_phone);
  if v_problem is not null then
    return jsonb_build_object('error', case when v_email is not null then 'email_invalid' else 'phone_invalid' end);
  end if;
  if p_reply_consent is distinct from true or app.lead_text(p_reply_statement, 600) is null then
    return jsonb_build_object('error', 'consent_required');
  end if;
  if length(p_reply_statement) > 500 or (p_marketing_consent is true and (p_marketing_statement is null or length(p_marketing_statement) not between 1 and 500)) then
    raise exception 'consent statement is invalid' using errcode = '22023';
  end if;
  v_stage := app.lead_stage_of_kind(org.id, 'open');
  if v_stage is null then
    return jsonb_build_object('error', 'form_unavailable');
  end if;
  v_via := p_source::text;

  insert into public.leads (id, organization_id, display_name, email, phone, preferred_contact, service_interest, country_now, language,
                            source, stage_id, submission_key, is_sample)
  values (v_id, org.id, v_name, v_email, v_phone,
          case when p_preferred_contact in ('email', 'phone') then p_preferred_contact end,
          app.lead_text(p_service_interest, 120), app.lead_text(p_country_now, 100), app.lead_text(p_language, 100),
          p_source, v_stage, key, v_sample);
  insert into public.lead_consents (organization_id, lead_id, purpose, granted, statement_text, statement_sha256, policy_version, captured_via)
  values (org.id, v_id, 'enquiry_reply', true, p_reply_statement, app.lead_sha256(p_reply_statement), v_version, v_via);
  if p_marketing_consent is true then
    insert into public.lead_consents (organization_id, lead_id, purpose, granted, statement_text, statement_sha256, policy_version, captured_via)
    values (org.id, v_id, 'marketing', true, p_marketing_statement, app.lead_sha256(p_marketing_statement), v_version, v_via);
  end if;
  perform app.lead_event(org.id, v_id, 'created', null, v_stage, null, jsonb_build_object('source', p_source));
  insert into public.audit_log (organization_id, actor_user_id, actor_type, action, object_table, object_id, result, request_id, context)
  values (org.id, (select auth.uid()), app.current_actor_type(), 'lead.enquiry_received', 'public.leads', v_id, 'success',
          app.current_request_id(), jsonb_build_object('source', p_source, 'marketing', coalesce(p_marketing_consent, false), 'sample', v_sample));
  return jsonb_build_object('ok', true);
end;
$$;
