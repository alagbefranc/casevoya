-- CRM-01 (#176): the firm's enquiry page.
--   organizations.enquiry_page_enabled   Settings switch; off, the page shows a closed state and
--                                        submit_enquiry answers form_closed. Default on.
--   leads.attribution                    utm_* , the referrer's host and the embedding site's host,
--                                        cleaned (app.enquiry_attribution); utm_source also goes in
--                                        source_detail. Shown on the Lead page.
--   set_enquiry_page_enabled             firm owner + step-up, audited.
--   public_privacy_notice                the firm's current published privacy notice for a public
--                                        page (/privacy/<firm>), under the same rule as the enquiry
--                                        page (live firm, or its own staff in sample mode).
--   enquiry_public_firm                  redefined: + open, so a closed page can still name the firm.
--   submit_enquiry                       a 16-argument form with p_attribution; the 15-argument form
--                                        calls it with none.

alter table public.organizations add column enquiry_page_enabled boolean not null default true;
comment on column public.organizations.enquiry_page_enabled is
  'CRM-01: whether the hosted enquiry page and its embed take enquiries. Changed with set_enquiry_page_enabled.';

alter table public.leads add column attribution jsonb not null default '{}'::jsonb
  check (jsonb_typeof(attribution) = 'object' and pg_column_size(attribution) <= 2000);
comment on column public.leads.attribution is
  'CRM-01: where an enquiry came from: utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer_host, embed_host. Strings only, each at most 200 characters.';

-- Only the known keys, each a short single-line string; hosts lower-case without scheme or path.
create function app.enquiry_attribution(p_raw jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(item.key, item.value), '{}'::jsonb)
  from (
    select pair.key,
           case when pair.key in ('referrer_host', 'embed_host')
                then lower(substring(btrim(pair.value) from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/?#:@\s]{1,200})'))
                else left(regexp_replace(btrim(pair.value), '[[:cntrl:]]', ' ', 'g'), 200) end as value
    from jsonb_each_text(case when jsonb_typeof(p_raw) = 'object' then p_raw else '{}'::jsonb end) pair
    where pair.key in ('utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'referrer_host', 'embed_host')
      and length(btrim(coalesce(pair.value, ''))) between 1 and 400
  ) item
  where item.value is not null and item.value <> '';
$$;
revoke all on function app.enquiry_attribution(jsonb) from public;

create function public.set_enquiry_page_enabled(p_organization_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  if p_enabled is null then
    raise exception 'choose on or off' using errcode = '22023';
  end if;
  update public.organizations set enquiry_page_enabled = p_enabled where id = p_organization_id and enquiry_page_enabled is distinct from p_enabled;
  if found then
    perform app.record_audit_event(p_organization_id, 'firm.enquiry_page_changed', 'public.organizations', p_organization_id, 'success',
      jsonb_build_object('enabled', p_enabled));
  end if;
end;
$$;
comment on function public.set_enquiry_page_enabled(uuid, boolean) is
  'Firm owner + step-up (CRM-01): turns the hosted enquiry page and its embed on or off. Audited.';
revoke all on function public.set_enquiry_page_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_enquiry_page_enabled(uuid, boolean) to authenticated;

create function public.public_privacy_notice(p_firm_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'firm_name', org.display_name,
    'firm_slug', org.slug,
    'title', doc.title,
    'version_label', doc.version_label,
    'body', doc.body,
    'published_at', doc.published_at
  )
  from public.organizations org
  cross join lateral (select * from app.current_portal_policy(org.id, 'privacy_notice')) doc
  where org.slug = lower(btrim(coalesce(p_firm_slug, '')))
    and doc.id is not null
    and (org.sample_mode is not true or app.booking_practice_viewer(org.id));
$$;
comment on function public.public_privacy_notice(text) is
  'CRM-01: the firm''s current published privacy notice for its public page, or null (unknown firm, none published, or sample mode for anyone but its staff).';
revoke all on function public.public_privacy_notice(text) from public;
grant execute on function public.public_privacy_notice(text) to anon, authenticated;

-- public.enquiry_public_firm(text), last defined in 20261020190000_enquiry_public_page.sql
create or replace function public.enquiry_public_firm(p_firm_slug text)
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
    'staff', app.booking_practice_viewer(org.id),
    'open', org.enquiry_page_enabled
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

-- public.submit_enquiry with attribution (CRM-01), from the 15-argument form last defined in
-- 20261020190000_enquiry_public_page.sql: + the page switch (form_closed) and attribution.
create function public.submit_enquiry(
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
  p_client_hash text,
  p_attribution jsonb
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
  v_attribution jsonb := app.enquiry_attribution(p_attribution);
begin
  select * into org from public.organizations o where o.slug = lower(btrim(coalesce(p_firm_slug, '')));
  if org.id is null
     or (org.sample_mode is true and not app.booking_practice_viewer(org.id))
     or not exists (
       select 1 from public.portal_policy_documents doc where doc.organization_id = org.id and doc.kind = 'privacy_notice'
     ) then
    return jsonb_build_object('error', 'form_unavailable');
  end if;
  -- CRM-01: the firm turned its enquiry page off in Settings.
  if org.enquiry_page_enabled is not true then
    return jsonb_build_object('error', 'form_closed');
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
                            source, source_detail, attribution, stage_id, submission_key, is_sample)
  values (v_id, org.id, v_name, v_email, v_phone,
          case when p_preferred_contact in ('email', 'phone') then p_preferred_contact end,
          app.lead_text(p_service_interest, 120), app.lead_text(p_country_now, 100), app.lead_text(p_language, 100),
          p_source, left(nullif(v_attribution ->> 'utm_source', ''), 200), v_attribution, v_stage, key, v_sample);
  insert into public.lead_consents (organization_id, lead_id, purpose, granted, statement_text, statement_sha256, policy_version, captured_via)
  values (org.id, v_id, 'enquiry_reply', true, p_reply_statement, app.lead_sha256(p_reply_statement), v_version, v_via);
  if p_marketing_consent is true then
    insert into public.lead_consents (organization_id, lead_id, purpose, granted, statement_text, statement_sha256, policy_version, captured_via)
    values (org.id, v_id, 'marketing', true, p_marketing_statement, app.lead_sha256(p_marketing_statement), v_version, v_via);
  end if;
  perform app.lead_event(org.id, v_id, 'created', null, v_stage, null, jsonb_build_object('source', p_source));
  insert into public.audit_log (organization_id, actor_user_id, actor_type, action, object_table, object_id, result, request_id, context)
  values (org.id, (select auth.uid()), app.current_actor_type(), 'lead.enquiry_received', 'public.leads', v_id, 'success',
          app.current_request_id(), jsonb_build_object('source', p_source, 'marketing', coalesce(p_marketing_consent, false), 'sample', v_sample,
            'attributed', v_attribution <> '{}'::jsonb));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text, jsonb) from public;
grant execute on function public.submit_enquiry(text, text, text, text, text, text, text, boolean, text, boolean, text, text, public.lead_source, text, text, jsonb) to anon, authenticated;

-- The 15-argument form: no attribution.
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
language sql
security definer
set search_path = ''
as $$
  select public.submit_enquiry(p_firm_slug, p_name, p_contact, p_preferred_contact, p_service_interest, p_country_now, p_language,
    p_reply_consent, p_reply_statement, p_marketing_consent, p_marketing_statement, p_consent_version, p_source, p_idempotency_key,
    p_client_hash, '{}'::jsonb);
$$;
