-- T022 in-house electronic signatures (PRD §10 AGR-01–AGR-05).
-- No third-party e-sign provider. The provider name on every envelope is in_house.
-- A sent version is locked by SHA-256 of its canonical text. Signed bytes are a PDF
-- in the private documents bucket, with the same hash on the document version.
-- The PDF bytes are also kept on the envelope so a party can retrieve the executed
-- copy without a storage service-role key. storage.objects is not altered.
-- Signing a service agreement advances a proposed (pending) engagement. It does not
-- record representation authority and it does not change matter stage.
-- Staff writes need aal2 and a recent step-up. Portal signers do not.
-- Additive only.

create type public.agreement_kind as enum (
  'quote',
  'consultation',
  'service',
  'amendment',
  'consent'
);

create type public.agreement_status as enum (
  'draft',
  'sent',
  'partially_signed',
  'completed',
  'declined',
  'expired',
  'voided',
  'superseded',
  'accepted'
);

create type public.agreement_signer_role as enum (
  'client',
  'consultant',
  'sponsor',
  'dependant',
  'guardian',
  'firm'
);

create type public.agreement_signer_status as enum (
  'waiting',
  'current',
  'signed',
  'declined'
);

create type public.signature_event_kind as enum (
  'sent',
  'signed',
  'declined',
  'voided',
  'expired',
  'completed',
  'superseded',
  'replayed'
);

insert into public.product_settings (key, value, description, pending_confirmation) values
  (
    'agreements.envelope_days',
    '{"days": 14}'::jsonb,
    'Proposed days until an unsigned in-house envelope expires. Not a legal limitation period. A send may set an earlier expiry.',
    true
  ),
  (
    'agreements.esign_consent',
    '{"version":"esign-consent-2026-10-17","text":"I agree to sign this document electronically. This electronic signature is my agreement to the locked text and its SHA-256 hash."}'::jsonb,
    'Consent recorded with an in-house electronic signature. The platform does not certify that this wording meets a professional code.',
    true
  );

create table public.agreement_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  kind public.agreement_kind not null,
  name text not null check (length(btrim(name)) between 1 and 200),
  body text not null check (length(body) between 1 and 20000),
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  approved_at timestamptz,
  approved_by uuid references public.memberships (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (status <> 'approved' or approved_at is not null)
);
comment on table public.agreement_templates is
  'Firm wording for an agreement. Approval records a reviewer; it does not certify legal sufficiency.';

create index agreement_templates_org_fk_idx on public.agreement_templates (organization_id);
create index agreement_templates_approved_by_idx on public.agreement_templates (approved_by);
create index agreement_templates_created_by_idx on public.agreement_templates (created_by);

create table public.agreements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  kind public.agreement_kind not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  status public.agreement_status not null default 'draft',
  template_id uuid,
  current_version_id uuid,
  supersedes_id uuid,
  quote_expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (kind <> 'amendment' or supersedes_id is not null),
  check (status <> 'accepted' or kind = 'quote'),
  check (kind <> 'quote' or status not in ('partially_signed', 'completed')),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (template_id, organization_id) references public.agreement_templates (id, organization_id),
  foreign key (supersedes_id, organization_id) references public.agreements (id, organization_id)
);
comment on table public.agreements is
  'Consultation, service, amendment, consent, and quote records. An accepted quote is not an executed service agreement.';

create index agreements_org_fk_idx on public.agreements (organization_id);
create index agreements_matter_org_fk_idx on public.agreements (matter_id, organization_id);
create index agreements_template_org_fk_idx on public.agreements (template_id, organization_id);
create index agreements_supersedes_org_fk_idx on public.agreements (supersedes_id, organization_id);
create index agreements_created_by_idx on public.agreements (created_by);
create index agreements_current_version_idx on public.agreements (current_version_id);

create table public.agreement_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  agreement_id uuid not null,
  version_number integer not null check (version_number >= 1),
  canonical_body text not null check (length(canonical_body) between 1 and 20000),
  scope_summary text not null check (length(btrim(scope_summary)) between 3 and 2000),
  exclusions text check (exclusions is null or length(exclusions) <= 2000),
  refund_policy text check (refund_policy is null or length(refund_policy) <= 2000),
  fee_cents bigint check (fee_cents is null or fee_cents >= 0),
  currency text not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  government_fee_note text check (government_fee_note is null or length(government_fee_note) <= 500),
  comparison_note text check (comparison_note is null or length(comparison_note) <= 2000),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (agreement_id, version_number),
  unique (id, organization_id),
  check (locked_at is null or content_sha256 is not null),
  foreign key (agreement_id, organization_id) references public.agreements (id, organization_id)
);
comment on table public.agreement_versions is
  'Once locked_at is set, the canonical text and its SHA-256 cannot change. A fee change after a signature is a new version.';
comment on column public.agreement_versions.government_fee_note is
  'A dated reference or a manual note. This column does not store a government fee schedule.';
comment on column public.agreement_versions.fee_cents is
  'Professional fee snapshot in integer minor units. Null when the document has no professional fee.';

create index agreement_versions_org_fk_idx on public.agreement_versions (organization_id);
create index agreement_versions_agreement_org_fk_idx on public.agreement_versions (agreement_id, organization_id);
create index agreement_versions_created_by_idx on public.agreement_versions (created_by);

alter table public.agreements
  add constraint agreements_current_version_fkey
  foreign key (current_version_id, organization_id)
  references public.agreement_versions (id, organization_id);

create table public.signature_envelopes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  agreement_id uuid not null,
  version_id uuid not null,
  status public.agreement_status not null default 'sent',
  provider text not null default 'in_house' check (provider = 'in_house'),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  expires_at timestamptz not null,
  sent_at timestamptz not null default now(),
  completed_at timestamptz,
  voided_at timestamptz,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  sealed_sha256 text check (sealed_sha256 is null or sealed_sha256 ~ '^[0-9a-f]{64}$'),
  certificate_sha256 text check (certificate_sha256 is null or certificate_sha256 ~ '^[0-9a-f]{64}$'),
  sealed_pdf bytea,
  certificate_pdf bytea,
  sealed_storage_key text,
  certificate_storage_key text,
  sealed_document_version_id uuid,
  certificate_document_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (organization_id, idempotency_key),
  unique (id, organization_id),
  check (status in ('sent', 'partially_signed', 'completed', 'declined', 'expired', 'voided', 'superseded')),
  check (sealed_pdf is null or substring(sealed_pdf from 1 for 4) = '\x25504446'::bytea),
  check (certificate_pdf is null or substring(certificate_pdf from 1 for 4) = '\x25504446'::bytea),
  check (status <> 'completed' or (sealed_pdf is not null and sealed_sha256 is not null and completed_at is not null)),
  foreign key (agreement_id, organization_id) references public.agreements (id, organization_id),
  foreign key (version_id, organization_id) references public.agreement_versions (id, organization_id)
);
comment on table public.signature_envelopes is
  'In-house signing envelope. provider is always in_house. Duplicate idempotency keys do not execute twice. The sealed PDF is immutable.';

create index signature_envelopes_org_fk_idx on public.signature_envelopes (organization_id);
create index signature_envelopes_agreement_org_fk_idx on public.signature_envelopes (agreement_id, organization_id);
create index signature_envelopes_version_org_fk_idx on public.signature_envelopes (version_id, organization_id);
create index signature_envelopes_sealed_version_idx on public.signature_envelopes (sealed_document_version_id);
create index signature_envelopes_certificate_version_idx on public.signature_envelopes (certificate_document_version_id);
create index signature_envelopes_created_by_idx on public.signature_envelopes (created_by);

create table public.envelope_signers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  envelope_id uuid not null,
  signing_order integer not null check (signing_order >= 1),
  role public.agreement_signer_role not null,
  person_id uuid,
  membership_id uuid,
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  status public.agreement_signer_status not null default 'waiting',
  consent_accepted boolean not null default false,
  consent_version text,
  consent_text text,
  signed_at timestamptz,
  declined_at timestamptz,
  signer_user_id uuid,
  ip inet,
  user_agent text check (user_agent is null or length(user_agent) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (envelope_id, signing_order),
  unique (id, organization_id),
  check (
    (person_id is not null and membership_id is null)
    or (person_id is null and membership_id is not null)
  ),
  check (role in ('consultant', 'firm') or person_id is not null),
  check (role not in ('consultant', 'firm') or membership_id is not null),
  check (status <> 'signed' or (consent_accepted is true and signed_at is not null and signer_user_id is not null)),
  foreign key (envelope_id, organization_id) references public.signature_envelopes (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.envelope_signers is
  'Signing order is strict. A signed row records consent, the authenticated user, time, IP, and user agent.';

create index envelope_signers_org_fk_idx on public.envelope_signers (organization_id);
create index envelope_signers_envelope_org_fk_idx on public.envelope_signers (envelope_id, organization_id);
create index envelope_signers_person_org_fk_idx on public.envelope_signers (person_id, organization_id);
create index envelope_signers_membership_org_fk_idx on public.envelope_signers (membership_id, organization_id);
create index envelope_signers_created_by_idx on public.envelope_signers (created_by);

create table public.signature_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  envelope_id uuid not null,
  signer_id uuid,
  kind public.signature_event_kind not null,
  provider text not null default 'in_house' check (provider = 'in_house'),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  actor_user_id uuid,
  occurred_at timestamptz not null default now(),
  ip inet,
  user_agent text check (user_agent is null or length(user_agent) <= 400),
  consent_accepted boolean,
  consent_version text,
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  summary jsonb not null default '{}'::jsonb check (pg_column_size(summary) <= 2000),
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  unique (id, organization_id),
  foreign key (envelope_id, organization_id) references public.signature_envelopes (id, organization_id),
  foreign key (signer_id, organization_id) references public.envelope_signers (id, organization_id)
);
comment on table public.signature_events is
  'Append-only in-house signature evidence. The same idempotency key returns the original effect and does not execute again.';

create index signature_events_org_fk_idx on public.signature_events (organization_id);
create index signature_events_envelope_org_fk_idx on public.signature_events (envelope_id, organization_id);
create index signature_events_signer_org_fk_idx on public.signature_events (signer_id, organization_id);

create table public.representation_authorities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  person_id uuid not null,
  scope text not null check (length(btrim(scope)) between 3 and 1000),
  evidence_locator text not null check (length(btrim(evidence_locator)) between 1 and 300),
  effective_on date not null,
  revoked_at timestamptz,
  revocation_reason text,
  agreement_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (revoked_at is null or (revocation_reason is not null and length(btrim(revocation_reason)) between 3 and 500)),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (agreement_id, organization_id) references public.agreements (id, organization_id)
);
comment on table public.representation_authorities is
  'Government representation authority. Signing a service agreement does not insert a row here.';

create index representation_authorities_org_fk_idx on public.representation_authorities (organization_id);
create index representation_authorities_matter_org_fk_idx on public.representation_authorities (matter_id, organization_id);
create index representation_authorities_person_org_fk_idx on public.representation_authorities (person_id, organization_id);
create index representation_authorities_agreement_org_fk_idx on public.representation_authorities (agreement_id, organization_id);
create index representation_authorities_created_by_idx on public.representation_authorities (created_by);

create table app.esign_write_nonce (
  object_id uuid primary key,
  txid bigint not null
);
revoke all on table app.esign_write_nonce from public, anon, authenticated, service_role;

create function app.open_esign_write(p_object_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.esign_write_nonce (object_id, txid)
  values (p_object_id, txid_current())
  on conflict (object_id) do update set txid = excluded.txid;
end;
$$;
revoke all on function app.open_esign_write(uuid) from public;

create function app.close_esign_write(p_object_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from app.esign_write_nonce where object_id = p_object_id;
end;
$$;
revoke all on function app.close_esign_write(uuid) from public;

create function app.guard_esign_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from app.esign_write_nonce nonce
    where nonce.object_id = new.id
      and nonce.txid = txid_current()
  ) then
    raise exception 'agreement changes go through an agreement function' using errcode = '42501';
  end if;
  if tg_table_name = 'agreement_versions' then
    if old.locked_at is not null then
      raise exception 'a locked agreement version cannot change' using errcode = '42501';
    end if;
  elsif tg_table_name = 'signature_envelopes' then
    if old.sealed_pdf is not null and new.sealed_pdf is distinct from old.sealed_pdf then
      raise exception 'a sealed agreement PDF cannot change' using errcode = '42501';
    end if;
    if old.certificate_pdf is not null and new.certificate_pdf is distinct from old.certificate_pdf then
      raise exception 'a completion certificate cannot change' using errcode = '42501';
    end if;
    if old.status = 'completed' and new.status is distinct from 'completed' then
      raise exception 'an executed envelope cannot change status' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_esign_write() from public;

create function app.reject_signature_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'signature evidence cannot be changed' using errcode = '42501';
end;
$$;
revoke all on function app.reject_signature_event_change() from public;

create trigger agreement_templates_touch before update on public.agreement_templates
  for each row execute function app.touch_row();
create trigger agreement_templates_stamp before insert on public.agreement_templates
  for each row execute function app.stamp_created_by();
create trigger agreement_templates_audit after insert or update or delete on public.agreement_templates
  for each row execute function app.audit_row_change('body');
create trigger agreement_templates_no_delete before delete on public.agreement_templates
  for each row execute function app.reject_governed_delete();

create trigger agreements_touch before update on public.agreements
  for each row execute function app.touch_row();
create trigger agreements_guard before update on public.agreements
  for each row execute function app.guard_esign_write();
create trigger agreements_stamp before insert on public.agreements
  for each row execute function app.stamp_created_by();
create trigger agreements_audit after insert or update or delete on public.agreements
  for each row execute function app.audit_row_change();
create trigger agreements_no_delete before delete on public.agreements
  for each row execute function app.reject_governed_delete();

create trigger agreement_versions_touch before update on public.agreement_versions
  for each row execute function app.touch_row();
create trigger agreement_versions_guard before update on public.agreement_versions
  for each row execute function app.guard_esign_write();
create trigger agreement_versions_stamp before insert on public.agreement_versions
  for each row execute function app.stamp_created_by();
create trigger agreement_versions_audit after insert or update or delete on public.agreement_versions
  for each row execute function app.audit_row_change('canonical_body');
create trigger agreement_versions_no_delete before delete on public.agreement_versions
  for each row execute function app.reject_governed_delete();

create trigger signature_envelopes_touch before update on public.signature_envelopes
  for each row execute function app.touch_row();
create trigger signature_envelopes_guard before update on public.signature_envelopes
  for each row execute function app.guard_esign_write();
create trigger signature_envelopes_stamp before insert on public.signature_envelopes
  for each row execute function app.stamp_created_by();
create trigger signature_envelopes_audit after insert or update or delete on public.signature_envelopes
  for each row execute function app.audit_row_change('sealed_pdf', 'certificate_pdf');
create trigger signature_envelopes_no_delete before delete on public.signature_envelopes
  for each row execute function app.reject_governed_delete();

create trigger envelope_signers_touch before update on public.envelope_signers
  for each row execute function app.touch_row();
create trigger envelope_signers_guard before update on public.envelope_signers
  for each row execute function app.guard_esign_write();
create trigger envelope_signers_stamp before insert on public.envelope_signers
  for each row execute function app.stamp_created_by();
create trigger envelope_signers_audit after insert or update or delete on public.envelope_signers
  for each row execute function app.audit_row_change('user_agent', 'consent_text');
create trigger envelope_signers_no_delete before delete on public.envelope_signers
  for each row execute function app.reject_governed_delete();

create trigger signature_events_no_change before update or delete on public.signature_events
  for each row execute function app.reject_signature_event_change();
create trigger signature_events_audit after insert on public.signature_events
  for each row execute function app.audit_row_change('user_agent');
create trigger signature_events_no_delete before delete on public.signature_events
  for each row execute function app.reject_governed_delete();

create trigger representation_authorities_touch before update on public.representation_authorities
  for each row execute function app.touch_row();
create trigger representation_authorities_guard before update on public.representation_authorities
  for each row execute function app.guard_esign_write();
create trigger representation_authorities_stamp before insert on public.representation_authorities
  for each row execute function app.stamp_created_by();
create trigger representation_authorities_audit after insert or update or delete on public.representation_authorities
  for each row execute function app.audit_row_change();
create trigger representation_authorities_no_delete before delete on public.representation_authorities
  for each row execute function app.reject_governed_delete();

create function app.esign_consent()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select value
  from public.product_settings
  where key = 'agreements.esign_consent';
$$;
revoke all on function app.esign_consent() from public;

create function app.envelope_default_expiry()
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  days integer;
begin
  select coalesce((value ->> 'days')::integer, 14) into days
  from public.product_settings
  where key = 'agreements.envelope_days';
  if days is null or days < 1 or days > 90 then
    days := 14;
  end if;
  return statement_timestamp() + make_interval(days => days);
end;
$$;
revoke all on function app.envelope_default_expiry() from public;

create function app.agreement_canonical(
  p_kind text,
  p_title text,
  p_scope text,
  p_exclusions text,
  p_refund text,
  p_fee_cents bigint,
  p_currency text,
  p_government_fee_note text,
  p_comparison text,
  p_body text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(
    E'\n',
    coalesce(p_kind, ''),
    coalesce(p_title, ''),
    coalesce(p_scope, ''),
    coalesce(p_exclusions, ''),
    coalesce(p_refund, ''),
    coalesce(p_fee_cents::text, ''),
    coalesce(p_currency, ''),
    coalesce(p_government_fee_note, ''),
    coalesce(p_comparison, ''),
    coalesce(p_body, '')
  );
$$;
revoke all on function app.agreement_canonical(text, text, text, text, text, bigint, text, text, text, text) from public;

create function app.build_text_pdf(p_lines text[])
returns bytea
language plpgsql
immutable
set search_path = ''
as $$
declare
  line text;
  content text := 'BT /F1 10 Tf 48 760 Td 13 TL ';
  stream bytea;
  header bytea;
  o1 bytea;
  o2 bytea;
  o3 bytea;
  o4 bytea;
  o5 bytea;
  file bytea;
  off1 integer;
  off2 integer;
  off3 integer;
  off4 integer;
  off5 integer;
  xref_pos integer;
  xref text;
begin
  foreach line in array coalesce(p_lines, array[]::text[]) loop
    line := left(regexp_replace(coalesce(line, ''), '[^\x20-\x7E]', '?', 'g'), 110);
    line := replace(replace(replace(line, '\', '\\'), '(', '\('), ')', '\)');
    content := content || '(' || line || ') Tj T* ';
  end loop;
  content := content || 'ET';
  stream := convert_to(content, 'UTF8');
  header := convert_to(E'%PDF-1.4\n', 'UTF8');
  o1 := convert_to(E'1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n', 'UTF8');
  o2 := convert_to(E'2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n', 'UTF8');
  o3 := convert_to(E'3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n', 'UTF8');
  o4 := convert_to('4 0 obj<</Length ' || octet_length(stream)::text || E'>>stream\n', 'UTF8')
    || stream
    || convert_to(E'\nendstream endobj\n', 'UTF8');
  o5 := convert_to(E'5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n', 'UTF8');
  off1 := octet_length(header);
  off2 := off1 + octet_length(o1);
  off3 := off2 + octet_length(o2);
  off4 := off3 + octet_length(o3);
  off5 := off4 + octet_length(o4);
  file := header || o1 || o2 || o3 || o4 || o5;
  xref_pos := octet_length(file);
  xref := 'xref' || E'\n' || '0 6' || E'\n'
    || '0000000000 65535 f ' || E'\n'
    || lpad(off1::text, 10, '0') || ' 00000 n ' || E'\n'
    || lpad(off2::text, 10, '0') || ' 00000 n ' || E'\n'
    || lpad(off3::text, 10, '0') || ' 00000 n ' || E'\n'
    || lpad(off4::text, 10, '0') || ' 00000 n ' || E'\n'
    || lpad(off5::text, 10, '0') || ' 00000 n ' || E'\n'
    || 'trailer<</Size 6/Root 1 0 R>>' || E'\n'
    || 'startxref' || E'\n'
    || xref_pos::text || E'\n'
    || '%%EOF';
  return file || convert_to(xref, 'UTF8');
end;
$$;
revoke all on function app.build_text_pdf(text[]) from public;

create function app.can_read_agreement(p_id uuid)
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
              person.user_id = (select auth.uid())
              or (mem.user_id = (select auth.uid()) and mem.status = 'active')
            )
        )
      )
  );
$$;
revoke all on function app.can_read_agreement(uuid) from public;
grant execute on function app.can_read_agreement(uuid) to authenticated, service_role;

create function app.responsible_licence_blocks_agreement(p_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matters matter
    join public.consultant_credentials credential
      on credential.membership_id = matter.responsible_consultant_membership_id
     and credential.organization_id = matter.organization_id
    where matter.id = p_matter_id
      and (
        app.licence_status_blocks(credential.status)
        or credential.discipline_revoked
        or credential.discipline_suspended
        or credential.register_status = 'inactive'
        or credential.entitlement_to_practise is false
      )
  );
$$;
revoke all on function app.responsible_licence_blocks_agreement(uuid) from public;

create function app.store_sealed_pdf(
  p_org uuid,
  p_matter_id uuid,
  p_person_id uuid,
  p_purpose text,
  p_filename text,
  p_pdf bytea,
  p_sha text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc_id uuid;
  version_id uuid := gen_random_uuid();
  storage_key text;
begin
  if p_pdf is null or substring(p_pdf from 1 for 4) <> '\x25504446'::bytea then
    raise exception 'sealed file is not a PDF' using errcode = '22023';
  end if;
  if p_sha is distinct from encode(extensions.digest(p_pdf, 'sha256'), 'hex') then
    raise exception 'sealed file hash does not match the bytes' using errcode = '22023';
  end if;
  storage_key := p_org::text || '/agreements/' || version_id::text || '/' || encode(extensions.gen_random_bytes(8), 'hex');
  insert into storage.objects (id, bucket_id, name, metadata)
  values (
    gen_random_uuid(),
    'documents',
    storage_key,
    jsonb_build_object('size', octet_length(p_pdf), 'mimetype', 'application/pdf', 'sha256', p_sha)
  );
  insert into public.documents (
    organization_id, person_id, purpose, sensitivity, audience, created_by
  ) values (
    p_org, p_person_id, left(btrim(p_purpose), 200), 'ordinary', 'matter', (select auth.uid())
  )
  returning id into doc_id;
  insert into public.document_versions (
    id, organization_id, document_id, version_number, storage_key, original_filename,
    declared_media_type, declared_byte_size, detected_media_type, byte_size, checksum_sha256,
    upload_state, scan_result, scan_engine, review_state, intent_expires_at, completed_at, created_by
  ) values (
    version_id,
    p_org,
    doc_id,
    1,
    storage_key,
    p_filename,
    'application/pdf',
    octet_length(p_pdf),
    'application/pdf',
    octet_length(p_pdf),
    p_sha,
    'clean',
    'in_house_seal',
    'structural_only',
    'accepted',
    statement_timestamp(),
    statement_timestamp(),
    (select auth.uid())
  );
  insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by)
  values (p_org, doc_id, p_matter_id, (select auth.uid()));
  perform app.open_document_write(doc_id);
  update public.documents set current_version_id = version_id where id = doc_id;
  perform app.close_document_write(doc_id);
  return version_id;
end;
$$;
revoke all on function app.store_sealed_pdf(uuid, uuid, uuid, text, text, bytea, text) from public;

create function app.advance_engagement_from_signature(p_matter_id uuid, p_agreement_id uuid, p_scope text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  pending_id uuid;
begin
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or matter.engagement_status is distinct from 'pending' then
    return;
  end if;
  select engagement.id into pending_id
  from public.matter_engagements engagement
  where engagement.matter_id = matter.id
    and engagement.status = 'pending'
  order by engagement.created_at desc
  limit 1;
  if pending_id is null then
    insert into public.matter_engagements (
      organization_id, matter_id, scope_summary, status, use_exception, agreement_locator, consultant_membership_id
    ) values (
      matter.organization_id,
      matter.id,
      btrim(p_scope),
      'engaged',
      false,
      p_agreement_id::text,
      matter.responsible_consultant_membership_id
    );
  else
    update public.matter_engagements
    set status = 'engaged',
        agreement_locator = p_agreement_id::text
    where id = pending_id;
  end if;
  insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
  values (
    matter.organization_id,
    matter.id,
    'service_agreement',
    'Executed in-house service agreement'
  );
  perform app.open_matter_column(matter.id, 'engagement');
  update public.matters set engagement_status = 'engaged' where id = matter.id;
  perform app.close_matter_column(matter.id);
  perform app.record_audit_event(
    matter.organization_id,
    'agreement.engagement_advanced',
    'public.agreements',
    p_agreement_id,
    'success',
    jsonb_build_object('matter_id', matter.id, 'status', 'engaged')
  );
end;
$$;
revoke all on function app.advance_engagement_from_signature(uuid, uuid, text) from public;

create function app.create_agreement_template(p_kind public.agreement_kind, p_name text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  new_id uuid;
begin
  if org is null then
    raise exception 'agreement template denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    org,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if p_name is null or length(btrim(p_name)) not between 1 and 200 or p_body is null or length(p_body) not between 1 and 20000 then
    raise exception 'template name and body are required' using errcode = '22023';
  end if;
  insert into public.agreement_templates (organization_id, kind, name, body)
  values (org, p_kind, btrim(p_name), p_body)
  returning id into new_id;
  perform app.record_audit_event(org, 'agreement.template_created', 'public.agreement_templates', new_id, 'success', jsonb_build_object('kind', p_kind));
  return new_id;
end;
$$;
revoke all on function app.create_agreement_template(public.agreement_kind, text, text) from public;

create function app.approve_agreement_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  template public.agreement_templates%rowtype;
  membership uuid;
begin
  perform app.require_active_staff(org, array['licensed_consultant']::public.org_role[], true);
  select * into template
  from public.agreement_templates
  where id = p_template_id
    and organization_id = org;
  if template.id is null or template.status <> 'draft' then
    raise exception 'agreement template denied' using errcode = '42501';
  end if;
  select mem.id into membership
  from public.memberships mem
  where mem.organization_id = org
    and mem.user_id = (select auth.uid())
    and mem.role = 'licensed_consultant'
    and mem.status = 'active'
  limit 1;
  update public.agreement_templates
  set status = 'approved',
      approved_at = statement_timestamp(),
      approved_by = membership
  where id = template.id;
  perform app.record_audit_event(org, 'agreement.template_approved', 'public.agreement_templates', template.id, 'success', '{}'::jsonb);
end;
$$;
revoke all on function app.approve_agreement_template(uuid) from public;

create function app.create_agreement(
  p_matter_id uuid,
  p_kind public.agreement_kind,
  p_title text,
  p_body text,
  p_scope text,
  p_exclusions text,
  p_refund_policy text,
  p_fee_cents bigint,
  p_currency text,
  p_government_fee_note text,
  p_template_id uuid,
  p_quote_expires_on date,
  p_supersedes_id uuid,
  p_comparison text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  template public.agreement_templates%rowtype;
  prior public.agreements%rowtype;
  body text := p_body;
  agreement_id uuid;
  version_id uuid;
  canonical text;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if app.responsible_licence_blocks_agreement(matter.id) then
    raise exception 'not entitled, revoked, suspended, or inactive licence blocks this agreement' using errcode = '42501';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'agreement title is required' using errcode = '22023';
  end if;
  if p_scope is null or length(btrim(p_scope)) not between 3 and 2000 then
    raise exception 'agreement scope is required' using errcode = '22023';
  end if;
  if p_fee_cents is not null and p_fee_cents < 0 then
    raise exception 'a professional fee cannot be negative' using errcode = '22023';
  end if;
  if p_template_id is not null then
    select * into template
    from public.agreement_templates
    where id = p_template_id
      and organization_id = matter.organization_id
      and status = 'approved'
      and kind = p_kind;
    if template.id is null then
      raise exception 'an approved template is required' using errcode = '42501';
    end if;
    if body is null or length(btrim(body)) = 0 then
      body := template.body;
    end if;
  end if;
  if body is null or length(body) not between 1 and 20000 then
    raise exception 'agreement text is required' using errcode = '22023';
  end if;
  if p_kind = 'amendment' then
    if p_comparison is null or length(btrim(p_comparison)) < 3 then
      raise exception 'an amendment needs a comparison' using errcode = '22023';
    end if;
    select * into prior
    from public.agreements
    where id = p_supersedes_id
      and organization_id = matter.organization_id
      and matter_id = matter.id
      and status = 'completed';
    if prior.id is null then
      raise exception 'an amendment replaces a completed agreement' using errcode = '42501';
    end if;
  elsif p_supersedes_id is not null then
    raise exception 'only an amendment names the agreement it replaces' using errcode = '22023';
  end if;
  if p_kind = 'quote' and p_quote_expires_on is null then
    raise exception 'a quote needs an expiry date' using errcode = '22023';
  end if;

  canonical := app.agreement_canonical(
    p_kind::text, btrim(p_title), btrim(p_scope), p_exclusions, p_refund_policy,
    p_fee_cents, coalesce(nullif(upper(btrim(p_currency)), ''), 'CAD'), p_government_fee_note, p_comparison, body
  );
  insert into public.agreements (
    organization_id, matter_id, kind, title, template_id, supersedes_id, quote_expires_on
  ) values (
    matter.organization_id, matter.id, p_kind, btrim(p_title), p_template_id, p_supersedes_id, p_quote_expires_on
  )
  returning id into agreement_id;
  insert into public.agreement_versions (
    organization_id, agreement_id, version_number, canonical_body, scope_summary, exclusions,
    refund_policy, fee_cents, currency, government_fee_note, comparison_note
  ) values (
    matter.organization_id,
    agreement_id,
    1,
    canonical,
    btrim(p_scope),
    p_exclusions,
    p_refund_policy,
    p_fee_cents,
    coalesce(nullif(upper(btrim(p_currency)), ''), 'CAD'),
    p_government_fee_note,
    p_comparison
  )
  returning id into version_id;
  perform app.open_esign_write(agreement_id);
  update public.agreements set current_version_id = version_id where id = agreement_id;
  perform app.close_esign_write(agreement_id);
  perform app.record_audit_event(
    matter.organization_id, 'agreement.draft_created', 'public.agreements', agreement_id, 'success',
    jsonb_build_object('kind', p_kind, 'matter_id', matter.id)
  );
  return agreement_id;
end;
$$;
revoke all on function app.create_agreement(uuid, public.agreement_kind, text, text, text, text, text, bigint, text, text, uuid, date, uuid, text) from public;

create function app.send_agreement(
  p_agreement_id uuid,
  p_signers jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.agreements%rowtype;
  ver public.agreement_versions%rowtype;
  matter public.matters%rowtype;
  existing public.signature_envelopes%rowtype;
  item jsonb;
  ordinal integer;
  signer_role public.agreement_signer_role;
  signer_person uuid;
  signer_membership uuid;
  signer_name text;
  envelope_id uuid;
  content_hash text;
  expires_at timestamptz;
  seen integer := 0;
begin
  select * into agreement from public.agreements where id = p_agreement_id for update;
  if agreement.id is null or app.can_read_agreement(agreement.id) is distinct from true then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    agreement.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 180 then
    raise exception 'an idempotency key is required' using errcode = '22023';
  end if;
  select * into existing
  from public.signature_envelopes
  where organization_id = agreement.organization_id
    and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    perform app.record_audit_event(
      agreement.organization_id, 'signature.replayed', 'public.signature_envelopes', existing.id, 'success',
      jsonb_build_object('idempotency_key', p_idempotency_key)
    );
    return jsonb_build_object('ok', true, 'replayed', true, 'envelope_id', existing.id, 'status', existing.status, 'content_sha256', existing.content_sha256);
  end if;
  if agreement.kind <> 'quote' and agreement.status <> 'draft' then
    raise exception 'only a draft agreement can be sent' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = agreement.matter_id;
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if app.responsible_licence_blocks_agreement(matter.id) then
    raise exception 'not entitled, revoked, suspended, or inactive licence blocks this agreement' using errcode = '42501';
  end if;
  select * into ver from public.agreement_versions where id = agreement.current_version_id for update;
  if agreement.kind = 'quote' and agreement.status in ('sent', 'accepted') then
    return jsonb_build_object('ok', true, 'replayed', true, 'status', agreement.status, 'content_sha256', ver.content_sha256);
  end if;
  if ver.id is null or ver.locked_at is not null then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  if agreement.kind = 'quote' then
    if agreement.status <> 'draft' then
      raise exception 'only a draft quote can be issued' using errcode = '42501';
    end if;
    content_hash := app.portal_statement_hash(ver.canonical_body);
    perform app.open_esign_write(ver.id);
    update public.agreement_versions
    set content_sha256 = content_hash, locked_at = statement_timestamp()
    where id = ver.id;
    perform app.close_esign_write(ver.id);
    perform app.open_esign_write(agreement.id);
    update public.agreements set status = 'sent' where id = agreement.id;
    perform app.close_esign_write(agreement.id);
    perform app.record_audit_event(
      agreement.organization_id, 'agreement.quote_issued', 'public.agreements', agreement.id, 'success',
      jsonb_build_object('content_sha256', content_hash)
    );
    return jsonb_build_object('ok', true, 'replayed', false, 'status', 'sent', 'content_sha256', content_hash);
  end if;
  if jsonb_typeof(p_signers) <> 'array' or jsonb_array_length(p_signers) not between 1 and 8 then
    raise exception 'at least one signer is required' using errcode = '22023';
  end if;

  content_hash := app.portal_statement_hash(ver.canonical_body);
  expires_at := coalesce(p_expires_at, app.envelope_default_expiry());
  if expires_at <= statement_timestamp() then
    raise exception 'envelope expiry must be in the future' using errcode = '22023';
  end if;

  perform app.open_esign_write(ver.id);
  update public.agreement_versions
  set content_sha256 = content_hash,
      locked_at = statement_timestamp()
  where id = ver.id;
  perform app.close_esign_write(ver.id);

  insert into public.signature_envelopes (
    organization_id, agreement_id, version_id, status, idempotency_key, expires_at, content_sha256
  ) values (
    agreement.organization_id, agreement.id, ver.id, 'sent', p_idempotency_key, expires_at, content_hash
  )
  returning id into envelope_id;

  for item, ordinal in
    select value, ordinality::integer
    from jsonb_array_elements(p_signers) with ordinality
  loop
    seen := seen + 1;
    if seen <> ordinal then
      raise exception 'signing order must be contiguous' using errcode = '22023';
    end if;
    begin
      signer_role := (item ->> 'role')::public.agreement_signer_role;
    exception when invalid_text_representation then
      raise exception 'signer role is not supported' using errcode = '22023';
    end;
    signer_name := btrim(coalesce(item ->> 'display_name', ''));
    if length(signer_name) not between 1 and 200 then
      raise exception 'signer name is required' using errcode = '22023';
    end if;
    signer_person := nullif(item ->> 'person_id', '')::uuid;
    signer_membership := nullif(item ->> 'membership_id', '')::uuid;
    if signer_role in ('consultant', 'firm') then
      if signer_membership is null or not exists (
        select 1 from public.memberships mem
        where mem.id = signer_membership
          and mem.organization_id = agreement.organization_id
          and mem.status = 'active'
          and mem.role in ('firm_owner', 'licensed_consultant', 'case_manager')
      ) then
        raise exception 'the firm signer must be an active staff member' using errcode = '42501';
      end if;
      signer_person := null;
    else
      if signer_person is null or not exists (
        select 1
        from public.matter_participants party
        where party.matter_id = agreement.matter_id
          and party.organization_id = agreement.organization_id
          and party.person_id = signer_person
      ) then
        raise exception 'the signer must be a person on the matter' using errcode = '42501';
      end if;
      signer_membership := null;
    end if;
    insert into public.envelope_signers (
      organization_id, envelope_id, signing_order, role, person_id, membership_id, display_name, status
    ) values (
      agreement.organization_id,
      envelope_id,
      ordinal,
      signer_role,
      signer_person,
      signer_membership,
      signer_name,
      case when ordinal = 1 then 'current'::public.agreement_signer_status else 'waiting'::public.agreement_signer_status end
    );
  end loop;

  perform app.open_esign_write(agreement.id);
  update public.agreements set status = 'sent' where id = agreement.id;
  perform app.close_esign_write(agreement.id);

  insert into public.signature_events (
    organization_id, envelope_id, kind, idempotency_key, actor_user_id, content_sha256, summary
  ) values (
    agreement.organization_id,
    envelope_id,
    'sent',
    p_idempotency_key || ':sent',
    (select auth.uid()),
    content_hash,
    jsonb_build_object('signers', seen)
  );
  perform app.enqueue_event(
    agreement.organization_id, 'agreement', agreement.id, 'agreement.sent',
    jsonb_build_object('agreement_id', agreement.id, 'envelope_id', envelope_id, 'matter_id', agreement.matter_id),
    ver.version_number,
    'agreement.sent:' || envelope_id::text,
    null
  );
  perform app.record_audit_event(
    agreement.organization_id, 'agreement.sent', 'public.signature_envelopes', envelope_id, 'success',
    jsonb_build_object('content_sha256', content_hash, 'signers', seen)
  );
  return jsonb_build_object('ok', true, 'replayed', false, 'envelope_id', envelope_id, 'status', 'sent', 'content_sha256', content_hash);
end;
$$;
revoke all on function app.send_agreement(uuid, jsonb, text, timestamptz) from public;

create function app.revise_agreement(
  p_agreement_id uuid,
  p_body text,
  p_scope text,
  p_fee_cents bigint,
  p_government_fee_note text,
  p_comparison text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.agreements%rowtype;
  ver public.agreement_versions%rowtype;
  envelope public.signature_envelopes%rowtype;
  signed_count integer := 0;
  next_number integer;
  new_version uuid;
  canonical text;
  fee_changed boolean;
begin
  select * into agreement from public.agreements where id = p_agreement_id for update;
  if agreement.id is null or app.can_read_agreement(agreement.id) is distinct from true then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    agreement.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if agreement.status in ('completed', 'accepted') then
    raise exception 'an executed agreement cannot be edited; create an amendment' using errcode = '42501';
  end if;
  if p_body is null or length(p_body) not between 1 and 20000 or p_scope is null or length(btrim(p_scope)) not between 3 and 2000 then
    raise exception 'revised text and scope are required' using errcode = '22023';
  end if;
  if p_comparison is null or length(btrim(p_comparison)) < 3 then
    raise exception 'a revision needs a comparison' using errcode = '22023';
  end if;
  select * into ver from public.agreement_versions where id = agreement.current_version_id;
  fee_changed := ver.fee_cents is distinct from p_fee_cents;
  select * into envelope
  from public.signature_envelopes
  where agreement_id = agreement.id
    and status in ('sent', 'partially_signed')
  order by sent_at desc
  limit 1
  for update;
  if envelope.id is not null then
    select count(*) into signed_count
    from public.envelope_signers signer
    where signer.envelope_id = envelope.id
      and signer.status = 'signed';
  end if;
  if ver.locked_at is null and envelope.id is null then
    canonical := app.agreement_canonical(
      agreement.kind::text, agreement.title, btrim(p_scope), ver.exclusions, ver.refund_policy,
      p_fee_cents, ver.currency, p_government_fee_note, btrim(p_comparison), p_body
    );
    perform app.open_esign_write(ver.id);
    update public.agreement_versions
    set canonical_body = canonical,
        scope_summary = btrim(p_scope),
        fee_cents = p_fee_cents,
        government_fee_note = p_government_fee_note,
        comparison_note = btrim(p_comparison)
    where id = ver.id;
    perform app.close_esign_write(ver.id);
    perform app.record_audit_event(
      agreement.organization_id, 'agreement.draft_revised', 'public.agreement_versions', ver.id, 'success',
      jsonb_build_object('fee_changed', fee_changed)
    );
    return ver.id;
  end if;

  if envelope.id is not null then
    perform app.open_esign_write(envelope.id);
    update public.signature_envelopes
    set status = 'superseded',
        voided_at = statement_timestamp()
    where id = envelope.id;
    perform app.close_esign_write(envelope.id);
    insert into public.signature_events (
      organization_id, envelope_id, kind, idempotency_key, actor_user_id, content_sha256, summary
    ) values (
      agreement.organization_id,
      envelope.id,
      'superseded',
      envelope.idempotency_key || ':superseded',
      (select auth.uid()),
      envelope.content_sha256,
      jsonb_build_object('fee_changed', fee_changed, 'signed_count', signed_count)
    );
  end if;

  select coalesce(max(version_number), 0) + 1 into next_number
  from public.agreement_versions
  where agreement_id = agreement.id;
  canonical := app.agreement_canonical(
    agreement.kind::text, agreement.title, btrim(p_scope), ver.exclusions, ver.refund_policy,
    p_fee_cents, ver.currency, p_government_fee_note, btrim(p_comparison), p_body
  );
  insert into public.agreement_versions (
    organization_id, agreement_id, version_number, canonical_body, scope_summary, exclusions,
    refund_policy, fee_cents, currency, government_fee_note, comparison_note
  ) values (
    agreement.organization_id, agreement.id, next_number, canonical, btrim(p_scope), ver.exclusions,
    ver.refund_policy, p_fee_cents, ver.currency, p_government_fee_note, btrim(p_comparison)
  )
  returning id into new_version;
  perform app.open_esign_write(agreement.id);
  update public.agreements
  set status = 'draft',
      current_version_id = new_version
  where id = agreement.id;
  perform app.close_esign_write(agreement.id);
  perform app.record_audit_event(
    agreement.organization_id,
    case when fee_changed and signed_count > 0 then 'agreement.fee_change_superseded' else 'agreement.superseded' end,
    'public.agreements',
    agreement.id,
    'success',
    jsonb_build_object('version_id', new_version, 'previous_sha256', ver.content_sha256, 'signed_count', signed_count)
  );
  return new_version;
end;
$$;
revoke all on function app.revise_agreement(uuid, text, text, bigint, text, text) from public;

create function app.sign_agreement(
  p_envelope_id uuid,
  p_consent boolean,
  p_idempotency_key text,
  p_ip inet,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  envelope public.signature_envelopes%rowtype;
  agreement public.agreements%rowtype;
  ver public.agreement_versions%rowtype;
  signer public.envelope_signers%rowtype;
  prior public.signature_events%rowtype;
  consent jsonb;
  v_consent_text text;
  v_consent_version text;
  next_signer uuid;
  remaining integer;
  person_id uuid;
  pdf bytea;
  certificate bytea;
  pdf_sha text;
  certificate_sha text;
  sealed_version uuid;
  certificate_version uuid;
  lines text[] := array[]::text[];
  cert_lines text[] := array[]::text[];
  chunk text;
  offset_pos integer := 1;
  signer_line record;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 180 then
    raise exception 'an idempotency key is required' using errcode = '22023';
  end if;
  if p_user_agent is null or length(btrim(p_user_agent)) not between 1 and 400 then
    raise exception 'user agent is required' using errcode = '22023';
  end if;
  if p_ip is null then
    raise exception 'signer IP is required' using errcode = '22023';
  end if;
  select * into envelope from public.signature_envelopes where id = p_envelope_id for update;
  if envelope.id is null then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  select * into agreement from public.agreements where id = envelope.agreement_id;
  if agreement.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  select * into prior
  from public.signature_events
  where organization_id = envelope.organization_id
    and idempotency_key = p_idempotency_key;
  if prior.id is not null then
    perform app.record_audit_event(
      envelope.organization_id, 'signature.replayed', 'public.signature_events', prior.id, 'success',
      jsonb_build_object('envelope_id', envelope.id)
    );
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'envelope_id', envelope.id, 'status', envelope.status,
      'content_sha256', envelope.content_sha256, 'sealed_sha256', envelope.sealed_sha256,
      'event_id', prior.id
    );
  end if;
  if envelope.status in ('voided', 'superseded', 'declined', 'expired', 'completed') then
    raise exception 'this envelope is no longer open' using errcode = '42501';
  end if;
  if envelope.expires_at <= statement_timestamp() then
    perform app.open_esign_write(envelope.id);
    update public.signature_envelopes set status = 'expired' where id = envelope.id;
    perform app.close_esign_write(envelope.id);
    perform app.open_esign_write(agreement.id);
    update public.agreements set status = 'expired' where id = agreement.id and status in ('sent', 'partially_signed');
    perform app.close_esign_write(agreement.id);
    insert into public.signature_events (
      organization_id, envelope_id, kind, idempotency_key, actor_user_id, content_sha256, summary
    ) values (
      envelope.organization_id, envelope.id, 'expired', p_idempotency_key, (select auth.uid()), envelope.content_sha256,
      jsonb_build_object('reason', 'expiry')
    );
    raise exception 'envelope expired' using errcode = '42501';
  end if;
  if p_consent is distinct from true then
    raise exception 'electronic signature consent is required' using errcode = '42501';
  end if;

  select * into signer
  from public.envelope_signers
  where envelope_id = envelope.id
    and status = 'current'
  for update;
  if signer.id is null then
    raise exception 'it is not your turn to sign' using errcode = '42501';
  end if;
  if signer.membership_id is not null then
    perform app.require_active_staff(
      envelope.organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
      true
    );
    if not exists (
      select 1 from public.memberships mem
      where mem.id = signer.membership_id
        and mem.user_id = (select auth.uid())
        and mem.status = 'active'
    ) then
      raise exception 'signer identity does not match' using errcode = '42501';
    end if;
  else
    if not exists (
      select 1 from public.persons person
      where person.id = signer.person_id
        and person.organization_id = envelope.organization_id
        and person.user_id = (select auth.uid())
    ) then
      raise exception 'signer identity does not match' using errcode = '42501';
    end if;
  end if;

  consent := app.esign_consent();
  v_consent_text := left(coalesce(consent ->> 'text', ''), 500);
  v_consent_version := coalesce(consent ->> 'version', 'esign-consent-2026-10-17');
  if length(v_consent_text) < 1 then
    raise exception 'electronic signature consent text is not configured' using errcode = '22023';
  end if;

  perform app.open_esign_write(signer.id);
  update public.envelope_signers
  set status = 'signed',
      consent_accepted = true,
      consent_version = v_consent_version,
      consent_text = v_consent_text,
      signed_at = statement_timestamp(),
      signer_user_id = (select auth.uid()),
      ip = p_ip,
      user_agent = left(btrim(p_user_agent), 400)
  where id = signer.id;
  perform app.close_esign_write(signer.id);

  if signer.person_id is not null then
    insert into public.consent_records (
      organization_id, person_id, matter_id, purpose, policy_version, scope,
      statement_text, statement_sha256, granted
    ) values (
      envelope.organization_id,
      signer.person_id,
      agreement.matter_id,
      'electronic_signature',
      v_consent_version,
      'electronic_signature',
      v_consent_text,
      app.portal_statement_hash(v_consent_text),
      true
    );
  end if;

  insert into public.signature_events (
    organization_id, envelope_id, signer_id, kind, idempotency_key, actor_user_id, ip, user_agent,
    consent_accepted, consent_version, content_sha256, summary
  ) values (
    envelope.organization_id, envelope.id, signer.id, 'signed', p_idempotency_key, (select auth.uid()),
    p_ip, left(btrim(p_user_agent), 400), true, v_consent_version, envelope.content_sha256,
    jsonb_build_object('signing_order', signer.signing_order, 'role', signer.role)
  );

  select count(*) into remaining
  from public.envelope_signers
  where envelope_id = envelope.id
    and status in ('waiting', 'current');
  if remaining > 0 then
    select id into next_signer
    from public.envelope_signers
    where envelope_id = envelope.id
      and status = 'waiting'
    order by signing_order
    limit 1;
    perform app.open_esign_write(next_signer);
    update public.envelope_signers set status = 'current' where id = next_signer;
    perform app.close_esign_write(next_signer);
    perform app.open_esign_write(envelope.id);
    update public.signature_envelopes set status = 'partially_signed' where id = envelope.id;
    perform app.close_esign_write(envelope.id);
    perform app.open_esign_write(agreement.id);
    update public.agreements set status = 'partially_signed' where id = agreement.id;
    perform app.close_esign_write(agreement.id);
    perform app.record_audit_event(
      envelope.organization_id, 'agreement.signed', 'public.envelope_signers', signer.id, 'success',
      jsonb_build_object('envelope_id', envelope.id, 'partial', true)
    );
    return jsonb_build_object(
      'ok', true, 'replayed', false, 'envelope_id', envelope.id, 'status', 'partially_signed',
      'content_sha256', envelope.content_sha256
    );
  end if;

  select * into ver from public.agreement_versions where id = envelope.version_id;
  lines := array[
    left(agreement.title, 110),
    'SHA-256 ' || envelope.content_sha256,
    'In-house electronic signature. Not a government form signature.'
  ];
  chunk := ver.canonical_body;
  while offset_pos <= least(length(chunk), 2400) and cardinality(lines) < 36 loop
    lines := lines || left(substr(chunk, offset_pos, 100), 100);
    offset_pos := offset_pos + 100;
  end loop;
  for signer_line in
    select display_name, role::text as role, signed_at
    from public.envelope_signers
    where envelope_id = envelope.id
    order by signing_order
  loop
    cert_lines := cert_lines || (
      signer_line.display_name || ' (' || signer_line.role || ') ' || to_char(signer_line.signed_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
    );
  end loop;
  cert_lines := array[
    'Completion certificate',
    agreement.title,
    'Content SHA-256 ' || envelope.content_sha256,
    'Consent ' || v_consent_version
  ] || cert_lines;
  pdf := app.build_text_pdf(lines);
  certificate := app.build_text_pdf(cert_lines);
  pdf_sha := encode(extensions.digest(pdf, 'sha256'), 'hex');
  certificate_sha := encode(extensions.digest(certificate, 'sha256'), 'hex');
  select signer_row.person_id into person_id
  from public.envelope_signers signer_row
  where signer_row.envelope_id = envelope.id
    and signer_row.person_id is not null
  order by signer_row.signing_order
  limit 1;
  if person_id is null then
    select party.person_id into person_id
    from public.matter_participants party
    where party.matter_id = agreement.matter_id
      and party.person_id is not null
    limit 1;
  end if;
  if person_id is null then
    raise exception 'a sealed agreement needs a person on the matter' using errcode = '42501';
  end if;
  sealed_version := app.store_sealed_pdf(
    agreement.organization_id, agreement.matter_id, person_id,
    'Executed agreement', 'executed-agreement.pdf', pdf, pdf_sha
  );
  certificate_version := app.store_sealed_pdf(
    agreement.organization_id, agreement.matter_id, person_id,
    'Completion certificate', 'completion-certificate.pdf', certificate, certificate_sha
  );
  perform app.open_esign_write(envelope.id);
  update public.signature_envelopes
  set status = 'completed',
      completed_at = statement_timestamp(),
      sealed_sha256 = pdf_sha,
      certificate_sha256 = certificate_sha,
      sealed_pdf = pdf,
      certificate_pdf = certificate,
      sealed_storage_key = (select storage_key from public.document_versions where id = sealed_version),
      certificate_storage_key = (select storage_key from public.document_versions where id = certificate_version),
      sealed_document_version_id = sealed_version,
      certificate_document_version_id = certificate_version
  where id = envelope.id;
  perform app.close_esign_write(envelope.id);
  perform app.open_esign_write(agreement.id);
  update public.agreements set status = 'completed' where id = agreement.id;
  perform app.close_esign_write(agreement.id);
  insert into public.signature_events (
    organization_id, envelope_id, kind, idempotency_key, actor_user_id, content_sha256, summary
  ) values (
    envelope.organization_id, envelope.id, 'completed', p_idempotency_key || ':completed', (select auth.uid()),
    envelope.content_sha256, jsonb_build_object('sealed_sha256', pdf_sha, 'certificate_sha256', certificate_sha)
  );
  if agreement.kind = 'service' then
    perform app.advance_engagement_from_signature(agreement.matter_id, agreement.id, ver.scope_summary);
  end if;
  perform app.enqueue_event(
    agreement.organization_id, 'agreement', agreement.id, 'agreement.executed',
    jsonb_build_object(
      'agreement_id', agreement.id, 'envelope_id', envelope.id, 'matter_id', agreement.matter_id,
      'content_sha256', envelope.content_sha256
    ),
    ver.version_number,
    'agreement.executed:' || envelope.id::text,
    null
  );
  perform app.record_audit_event(
    envelope.organization_id, 'agreement.completed', 'public.signature_envelopes', envelope.id, 'success',
    jsonb_build_object('content_sha256', envelope.content_sha256, 'sealed_sha256', pdf_sha)
  );
  return jsonb_build_object(
    'ok', true, 'replayed', false, 'envelope_id', envelope.id, 'status', 'completed',
    'content_sha256', envelope.content_sha256, 'sealed_sha256', pdf_sha,
    'sealed_version_id', sealed_version, 'certificate_version_id', certificate_version
  );
end;
$$;
revoke all on function app.sign_agreement(uuid, boolean, text, inet, text) from public;

create function app.decline_agreement(
  p_envelope_id uuid,
  p_idempotency_key text,
  p_ip inet,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  envelope public.signature_envelopes%rowtype;
  agreement public.agreements%rowtype;
  signer public.envelope_signers%rowtype;
  prior public.signature_events%rowtype;
begin
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200 then
    raise exception 'an idempotency key is required' using errcode = '22023';
  end if;
  select event.* into prior
  from public.signature_events event
  join public.signature_envelopes env on env.id = event.envelope_id
  where event.idempotency_key = p_idempotency_key
    and env.id = p_envelope_id
    and env.organization_id = (select app.current_organization_id());
  if prior.id is not null then
    return jsonb_build_object('ok', true, 'replayed', true, 'envelope_id', p_envelope_id, 'status', 'declined');
  end if;
  select * into envelope from public.signature_envelopes where id = p_envelope_id for update;
  if envelope.id is null or envelope.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  if envelope.status = 'completed' then
    raise exception 'an executed envelope cannot be declined' using errcode = '42501';
  end if;
  select * into signer from public.envelope_signers where envelope_id = envelope.id and status = 'current' for update;
  if signer.id is null then
    raise exception 'it is not your turn to sign' using errcode = '42501';
  end if;
  if signer.membership_id is not null then
    if not exists (
      select 1 from public.memberships mem
      where mem.id = signer.membership_id and mem.user_id = (select auth.uid()) and mem.status = 'active'
    ) or app.mfa_step_up_satisfied() is distinct from true then
      raise exception 'signer identity does not match' using errcode = '42501';
    end if;
  elsif not exists (
    select 1 from public.persons person
    where person.id = signer.person_id and person.user_id = (select auth.uid())
  ) then
    raise exception 'signer identity does not match' using errcode = '42501';
  end if;
  perform app.open_esign_write(signer.id);
  update public.envelope_signers
  set status = 'declined', declined_at = statement_timestamp(), signer_user_id = (select auth.uid()),
      ip = p_ip, user_agent = left(coalesce(p_user_agent, 'unknown'), 400)
  where id = signer.id;
  perform app.close_esign_write(signer.id);
  perform app.open_esign_write(envelope.id);
  update public.signature_envelopes set status = 'declined', voided_at = statement_timestamp() where id = envelope.id;
  perform app.close_esign_write(envelope.id);
  select * into agreement from public.agreements where id = envelope.agreement_id;
  perform app.open_esign_write(agreement.id);
  update public.agreements set status = 'declined' where id = agreement.id;
  perform app.close_esign_write(agreement.id);
  insert into public.signature_events (
    organization_id, envelope_id, signer_id, kind, idempotency_key, actor_user_id, ip, user_agent, content_sha256, summary
  ) values (
    envelope.organization_id, envelope.id, signer.id, 'declined', p_idempotency_key, (select auth.uid()),
    p_ip, left(coalesce(p_user_agent, 'unknown'), 400), envelope.content_sha256, jsonb_build_object('signing_order', signer.signing_order)
  );
  perform app.record_audit_event(
    envelope.organization_id, 'agreement.declined', 'public.signature_envelopes', envelope.id, 'success', '{}'::jsonb
  );
  return jsonb_build_object('ok', true, 'replayed', false, 'envelope_id', envelope.id, 'status', 'declined');
end;
$$;
revoke all on function app.decline_agreement(uuid, text, inet, text) from public;

create function app.void_agreement_envelope(p_envelope_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  envelope public.signature_envelopes%rowtype;
  agreement public.agreements%rowtype;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a void needs a reason' using errcode = '22023';
  end if;
  select * into envelope from public.signature_envelopes where id = p_envelope_id for update;
  if envelope.id is null or app.can_read_agreement(envelope.agreement_id) is distinct from true then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    envelope.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if envelope.status = 'completed' then
    raise exception 'an executed envelope cannot be voided' using errcode = '42501';
  end if;
  if envelope.status = 'voided' then
    return;
  end if;
  perform app.open_esign_write(envelope.id);
  update public.signature_envelopes set status = 'voided', voided_at = statement_timestamp() where id = envelope.id;
  perform app.close_esign_write(envelope.id);
  select * into agreement from public.agreements where id = envelope.agreement_id;
  perform app.open_esign_write(agreement.id);
  update public.agreements set status = 'voided' where id = agreement.id and status <> 'completed';
  perform app.close_esign_write(agreement.id);
  insert into public.signature_events (
    organization_id, envelope_id, kind, idempotency_key, actor_user_id, content_sha256, summary
  ) values (
    envelope.organization_id, envelope.id, 'voided', envelope.idempotency_key || ':voided:' || gen_random_uuid()::text,
    (select auth.uid()), envelope.content_sha256, jsonb_build_object('reason_length', length(btrim(p_reason)))
  );
  perform app.record_audit_event(
    envelope.organization_id, 'agreement.voided', 'public.signature_envelopes', envelope.id, 'success',
    jsonb_build_object('reason_length', length(btrim(p_reason)))
  );
end;
$$;
revoke all on function app.void_agreement_envelope(uuid, text) from public;

create function app.accept_quote(p_agreement_id uuid)
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
  if agreement.quote_expires_on is not null and agreement.quote_expires_on < (statement_timestamp() at time zone 'UTC')::date then
    raise exception 'quote expired' using errcode = '42501';
  end if;
  if agreement.status = 'accepted' then
    return;
  end if;
  if agreement.status <> 'sent' then
    raise exception 'quote denied' using errcode = '42501';
  end if;
  if app.can_read_agreement(agreement.id) is distinct from true
     and not exists (
       select 1
       from public.matter_participants party
       join public.persons person on person.id = party.person_id
       where party.matter_id = agreement.matter_id
         and person.user_id = (select auth.uid())
     ) then
    raise exception 'quote denied' using errcode = '42501';
  end if;
  perform app.open_esign_write(agreement.id);
  update public.agreements set status = 'accepted' where id = agreement.id;
  perform app.close_esign_write(agreement.id);
  perform app.record_audit_event(
    agreement.organization_id, 'agreement.quote_accepted', 'public.agreements', agreement.id, 'success',
    jsonb_build_object('matter_id', agreement.matter_id)
  );
end;
$$;
revoke all on function app.accept_quote(uuid) from public;

create function app.record_representation_authority(
  p_matter_id uuid,
  p_person_id uuid,
  p_scope text,
  p_evidence_locator text,
  p_effective_on date,
  p_agreement_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_id uuid;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'representation denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant']::public.org_role[],
    true
  );
  if p_scope is null or length(btrim(p_scope)) not between 3 and 1000
     or p_evidence_locator is null or length(btrim(p_evidence_locator)) not between 1 and 300
     or p_effective_on is null then
    raise exception 'representation scope, evidence, and effective date are required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.persons person
    where person.id = p_person_id and person.organization_id = matter.organization_id
  ) then
    raise exception 'representation denied' using errcode = '42501';
  end if;
  if p_agreement_id is not null and not exists (
    select 1 from public.agreements agreement
    where agreement.id = p_agreement_id and agreement.organization_id = matter.organization_id
  ) then
    raise exception 'representation denied' using errcode = '42501';
  end if;
  insert into public.representation_authorities (
    organization_id, matter_id, person_id, scope, evidence_locator, effective_on, agreement_id
  ) values (
    matter.organization_id, matter.id, p_person_id, btrim(p_scope), btrim(p_evidence_locator), p_effective_on, p_agreement_id
  )
  returning id into new_id;
  perform app.record_audit_event(
    matter.organization_id, 'representation.recorded', 'public.representation_authorities', new_id, 'success',
    jsonb_build_object('matter_id', matter.id)
  );
  return new_id;
end;
$$;
revoke all on function app.record_representation_authority(uuid, uuid, text, text, date, uuid) from public;

create function app.revoke_representation_authority(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  row public.representation_authorities%rowtype;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a revocation needs a reason' using errcode = '22023';
  end if;
  select * into row from public.representation_authorities where id = p_id for update;
  if row.id is null or app.can_read_matter(row.matter_id) is distinct from true then
    raise exception 'representation denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    row.organization_id,
    array['firm_owner', 'licensed_consultant']::public.org_role[],
    true
  );
  if row.revoked_at is not null then
    return;
  end if;
  perform app.open_esign_write(row.id);
  update public.representation_authorities
  set revoked_at = statement_timestamp(),
      revocation_reason = btrim(p_reason)
  where id = row.id;
  perform app.close_esign_write(row.id);
  perform app.record_audit_event(
    row.organization_id, 'representation.revoked', 'public.representation_authorities', row.id, 'success',
    jsonb_build_object('reason_length', length(btrim(p_reason)))
  );
end;
$$;
revoke all on function app.revoke_representation_authority(uuid, text) from public;

create function app.agreement_pdf(p_envelope_id uuid, p_which text)
returns bytea
language plpgsql
security definer
set search_path = ''
as $$
declare
  envelope public.signature_envelopes%rowtype;
begin
  select * into envelope from public.signature_envelopes where id = p_envelope_id;
  if envelope.id is null or app.can_read_agreement(envelope.agreement_id) is distinct from true then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  if p_which = 'certificate' then
    return envelope.certificate_pdf;
  end if;
  return envelope.sealed_pdf;
end;
$$;
revoke all on function app.agreement_pdf(uuid, text) from public;

-- Public wrappers. The database checks the caller; these stay security invoker.
create function public.create_agreement_template(p_kind public.agreement_kind, p_name text, p_body text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.create_agreement_template(p_kind, p_name, p_body); $$;
create function public.approve_agreement_template(p_template_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select app.approve_agreement_template(p_template_id); $$;
create function public.create_agreement(
  p_matter_id uuid, p_kind public.agreement_kind, p_title text, p_body text, p_scope text,
  p_exclusions text, p_refund_policy text, p_fee_cents bigint, p_currency text,
  p_government_fee_note text, p_template_id uuid, p_quote_expires_on date,
  p_supersedes_id uuid, p_comparison text
) returns uuid language sql security invoker set search_path = ''
as $$
  select app.create_agreement(
    p_matter_id, p_kind, p_title, p_body, p_scope, p_exclusions, p_refund_policy, p_fee_cents,
    p_currency, p_government_fee_note, p_template_id, p_quote_expires_on, p_supersedes_id, p_comparison
  );
$$;
create function public.send_agreement(p_agreement_id uuid, p_signers jsonb, p_idempotency_key text, p_expires_at timestamptz)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.send_agreement(p_agreement_id, p_signers, p_idempotency_key, p_expires_at); $$;
create function public.revise_agreement(
  p_agreement_id uuid, p_body text, p_scope text, p_fee_cents bigint, p_government_fee_note text, p_comparison text
) returns uuid language sql security invoker set search_path = ''
as $$ select app.revise_agreement(p_agreement_id, p_body, p_scope, p_fee_cents, p_government_fee_note, p_comparison); $$;
create function public.sign_agreement(p_envelope_id uuid, p_consent boolean, p_idempotency_key text, p_ip inet, p_user_agent text)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.sign_agreement(p_envelope_id, p_consent, p_idempotency_key, p_ip, p_user_agent); $$;
create function public.decline_agreement(p_envelope_id uuid, p_idempotency_key text, p_ip inet, p_user_agent text)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.decline_agreement(p_envelope_id, p_idempotency_key, p_ip, p_user_agent); $$;
create function public.void_agreement_envelope(p_envelope_id uuid, p_reason text)
returns void language sql security invoker set search_path = ''
as $$ select app.void_agreement_envelope(p_envelope_id, p_reason); $$;
create function public.accept_quote(p_agreement_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select app.accept_quote(p_agreement_id); $$;
create function public.record_representation_authority(
  p_matter_id uuid, p_person_id uuid, p_scope text, p_evidence_locator text, p_effective_on date, p_agreement_id uuid
) returns uuid language sql security invoker set search_path = ''
as $$
  select app.record_representation_authority(
    p_matter_id, p_person_id, p_scope, p_evidence_locator, p_effective_on, p_agreement_id
  );
$$;
create function public.revoke_representation_authority(p_id uuid, p_reason text)
returns void language sql security invoker set search_path = ''
as $$ select app.revoke_representation_authority(p_id, p_reason); $$;
create function public.agreement_executed_pdf(p_envelope_id uuid)
returns bytea language sql security invoker set search_path = ''
as $$ select app.agreement_pdf(p_envelope_id, 'executed'); $$;
create function public.agreement_certificate_pdf(p_envelope_id uuid)
returns bytea language sql security invoker set search_path = ''
as $$ select app.agreement_pdf(p_envelope_id, 'certificate'); $$;

revoke all on function public.create_agreement_template(public.agreement_kind, text, text) from public, anon;
revoke all on function public.approve_agreement_template(uuid) from public, anon;
revoke all on function public.create_agreement(uuid, public.agreement_kind, text, text, text, text, text, bigint, text, text, uuid, date, uuid, text) from public, anon;
revoke all on function public.send_agreement(uuid, jsonb, text, timestamptz) from public, anon;
revoke all on function public.revise_agreement(uuid, text, text, bigint, text, text) from public, anon;
revoke all on function public.sign_agreement(uuid, boolean, text, inet, text) from public, anon;
revoke all on function public.decline_agreement(uuid, text, inet, text) from public, anon;
revoke all on function public.void_agreement_envelope(uuid, text) from public, anon;
revoke all on function public.accept_quote(uuid) from public, anon;
revoke all on function public.record_representation_authority(uuid, uuid, text, text, date, uuid) from public, anon;
revoke all on function public.revoke_representation_authority(uuid, text) from public, anon;
revoke all on function public.agreement_executed_pdf(uuid) from public, anon;
revoke all on function public.agreement_certificate_pdf(uuid) from public, anon;

grant execute on function public.create_agreement_template(public.agreement_kind, text, text) to authenticated, service_role;
grant execute on function public.approve_agreement_template(uuid) to authenticated, service_role;
grant execute on function public.create_agreement(uuid, public.agreement_kind, text, text, text, text, text, bigint, text, text, uuid, date, uuid, text) to authenticated, service_role;
grant execute on function public.send_agreement(uuid, jsonb, text, timestamptz) to authenticated, service_role;
grant execute on function public.revise_agreement(uuid, text, text, bigint, text, text) to authenticated, service_role;
grant execute on function public.sign_agreement(uuid, boolean, text, inet, text) to authenticated, service_role;
grant execute on function public.decline_agreement(uuid, text, inet, text) to authenticated, service_role;
grant execute on function public.void_agreement_envelope(uuid, text) to authenticated, service_role;
grant execute on function public.accept_quote(uuid) to authenticated, service_role;
grant execute on function public.record_representation_authority(uuid, uuid, text, text, date, uuid) to authenticated, service_role;
grant execute on function public.revoke_representation_authority(uuid, text) to authenticated, service_role;
grant execute on function public.agreement_executed_pdf(uuid) to authenticated, service_role;
grant execute on function public.agreement_certificate_pdf(uuid) to authenticated, service_role;

grant execute on function app.guard_esign_write() to authenticated, service_role;
grant execute on function app.reject_signature_event_change() to authenticated, service_role;
grant execute on function app.create_agreement_template(public.agreement_kind, text, text) to authenticated, service_role;
grant execute on function app.approve_agreement_template(uuid) to authenticated, service_role;
grant execute on function app.create_agreement(uuid, public.agreement_kind, text, text, text, text, text, bigint, text, text, uuid, date, uuid, text) to authenticated, service_role;
grant execute on function app.send_agreement(uuid, jsonb, text, timestamptz) to authenticated, service_role;
grant execute on function app.revise_agreement(uuid, text, text, bigint, text, text) to authenticated, service_role;
grant execute on function app.sign_agreement(uuid, boolean, text, inet, text) to authenticated, service_role;
grant execute on function app.decline_agreement(uuid, text, inet, text) to authenticated, service_role;
grant execute on function app.void_agreement_envelope(uuid, text) to authenticated, service_role;
grant execute on function app.accept_quote(uuid) to authenticated, service_role;
grant execute on function app.record_representation_authority(uuid, uuid, text, text, date, uuid) to authenticated, service_role;
grant execute on function app.revoke_representation_authority(uuid, text) to authenticated, service_role;
grant execute on function app.agreement_pdf(uuid, text) to authenticated, service_role;

revoke all on table public.agreement_templates from anon, authenticated;
revoke all on table public.agreements from anon, authenticated;
revoke all on table public.agreement_versions from anon, authenticated;
revoke all on table public.signature_envelopes from anon, authenticated;
revoke all on table public.envelope_signers from anon, authenticated;
revoke all on table public.signature_events from anon, authenticated;
revoke all on table public.representation_authorities from anon, authenticated;
grant select on table public.agreement_templates to authenticated;
grant select on table public.agreements to authenticated;
grant select on table public.agreement_versions to authenticated;
grant select on table public.signature_envelopes to authenticated;
grant select on table public.envelope_signers to authenticated;
grant select on table public.signature_events to authenticated;
grant select on table public.representation_authorities to authenticated;

alter table public.agreement_templates enable row level security;
alter table public.agreement_templates force row level security;
alter table public.agreements enable row level security;
alter table public.agreements force row level security;
alter table public.agreement_versions enable row level security;
alter table public.agreement_versions force row level security;
alter table public.signature_envelopes enable row level security;
alter table public.signature_envelopes force row level security;
alter table public.envelope_signers enable row level security;
alter table public.envelope_signers force row level security;
alter table public.signature_events enable row level security;
alter table public.signature_events force row level security;
alter table public.representation_authorities enable row level security;
alter table public.representation_authorities force row level security;

create policy agreement_templates_select on public.agreement_templates
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(
      organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
    ))
  );
create policy agreements_select on public.agreements
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_agreement(id))
  );
create policy agreement_versions_select on public.agreement_versions
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_agreement(agreement_id))
  );
create policy signature_envelopes_select on public.signature_envelopes
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_agreement(agreement_id))
  );
create policy envelope_signers_select on public.envelope_signers
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1
      from public.signature_envelopes envelope
      where envelope.id = envelope_id
        and (select app.can_read_agreement(envelope.agreement_id))
    )
  );
create policy signature_events_select on public.signature_events
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1
      from public.signature_envelopes envelope
      where envelope.id = envelope_id
        and (select app.can_read_agreement(envelope.agreement_id))
    )
  );
create policy representation_authorities_select on public.representation_authorities
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (
      (
        (select app.staff_mfa_satisfied())
        and (select app.can_read_matter(matter_id))
      )
      or exists (
        select 1 from public.persons person
        where person.id = person_id
          and person.user_id = (select auth.uid())
      )
    )
  );

comment on table public.matter_engagements is
  'Proposed scope is pending with a null locator. An executed in-house service agreement sets engaged and stores the agreement id as the locator. Signing does not by itself prove government representation authority.';
