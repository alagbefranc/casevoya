-- Quote builder, Agreement editor and Compare versions (PRD §10 AGR-01, AGR-02, AGR-04; T022, T030).
--
-- 1. Quotes. A quote is an agreement of kind quote (20261017190100) whose version now carries the
--    Designer's quote fields: services, deliverables and fee structure (new nullable columns on
--    agreement_versions), its priced lines (public.quote_lines: professional fee, tax, disbursement,
--    government fee) and its instalments (public.quote_instalments). Totals are computed here, in
--    integer cents: the professional fee snapshot (agreement_versions.fee_cents) is the sum of the
--    professional_fee lines; the total to the firm is every line that is not a government fee.
--    A government fee is never invented by the platform: a government_fee line needs a dated
--    reference typed by staff (source_note) and records who entered it and on which firm day
--    (AGR-01). There is no tax-rate table, so a tax line is entered by hand with its rate note.
--    public.create_quote starts a quote on a matter (a quote needs a matter) from an approved quote
--    template or blank, expiring on the firm's today plus agreements.quote_days (product setting,
--    30). public.save_quote edits an unlocked draft in place; once the quote was sent (its version
--    is locked) a save makes version N+1 with comparison "Quote revised" and the quote returns to
--    draft, the way app.revise_agreement works. public.send_quote is app.send_agreement for a
--    quote: it hashes and locks the version, status sent, no envelope. No email is queued: there is
--    no approved email design for a sent quote (open item). public.quote_to_agreement makes a
--    service-agreement draft from a sent or accepted quote (scope, fees and notes carried over)
--    from an approved service template. app.accept_quote now records who accepted and when
--    (agreements.accepted_at, accepted_by).
--    Staff gate for every quote write: a licensed membership (licensed consultant, or the owner:
--    decision 2026-10-19) with staff MFA and a recent step-up (app.require_licensed_staff).
--    Sample mode: a quote on a sample matter makes is_sample lines; a real matter in a sample-mode
--    firm is refused by app.create_agreement as before.
-- 2. Clauses. Every agreement version is split into clauses (public.agreement_clauses) from its
--    text (agreement_versions.body, the text alone; canonical_body keeps the hashed canonical form).
--    Convention: a line starting with "## " is a clause title; "## !" marks a mandatory clause.
--    Text before the first title is a "Preamble" clause; a text with no titles is one clause,
--    "Agreement text". A template may also name mandatory clauses by title
--    (agreement_templates.mandatory_clauses). Mandatory clauses are owned by the professional
--    reviewer who approved the template and cannot be edited in the editor (AGR-02).
--    public.edit_agreement_clause replaces one non-mandatory clause's wording, rebuilds the text and
--    uses app.revise_agreement: in place while the version is unlocked with no live envelope,
--    otherwise a new version with a comparison note (an open envelope is superseded). An executed
--    or accepted agreement is never edited (AGR-04): revise_agreement refuses it.
--    app.create_agreement and app.revise_agreement are redefined from their latest definitions
--    (20261017190100_inhouse_esign.sql, their only definitions) with one change: the text alone is
--    stored on the version and its clauses are (re)built. app.accept_quote is redefined from
--    20261019216100_firm_today_rules.sql with one change: accepted_at and accepted_by are set.
-- 3. Compare versions reads versions, envelopes, signers and signature events through the existing
--    RLS; nothing new is written.
-- Forced RLS on every new table; reads follow app.can_read_agreement; writes only through the
-- functions here (no insert, update or delete grants); rows of a locked version never change
-- (app.guard_version_children). Audit through app.audit_row_change and app.record_audit_event.
-- Additive only.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.agreement_versions
  add column body text check (body is null or length(body) between 1 and 20000),
  add column services text check (services is null or length(services) <= 2000),
  add column deliverables text check (deliverables is null or length(deliverables) <= 2000),
  add column fee_structure text check (fee_structure is null or length(fee_structure) <= 500);
comment on column public.agreement_versions.body is
  'The agreement text alone (the template text, or the clauses joined). Null for versions made before 20261020140100. canonical_body is the hashed canonical form.';
comment on column public.agreement_versions.services is 'Quote: the services, as typed (Designer "Services").';
comment on column public.agreement_versions.deliverables is 'Quote: the deliverables, as typed.';
comment on column public.agreement_versions.fee_structure is 'Quote: how the fee is structured, as typed ("Milestones (flat per stage)").';

alter table public.agreement_templates
  add column mandatory_clauses text[] check (mandatory_clauses is null or cardinality(mandatory_clauses) <= 100);
comment on column public.agreement_templates.mandatory_clauses is
  'Clause titles the professional reviewer owns, in addition to "## !" titles in the body. Matched case-insensitively.';

alter table public.agreements
  add column accepted_at timestamptz,
  add column accepted_by uuid references auth.users (id);
create index agreements_accepted_by_idx on public.agreements (accepted_by);
comment on column public.agreements.accepted_at is 'Quote: when the client accepted it in their portal. An accepted quote is not a signed agreement.';

insert into public.product_settings (key, value, description, pending_confirmation) values
  (
    'agreements.quote_days',
    '{"days": 30}'::jsonb,
    'Proposed days a new quote stays valid: its expiry is the firm''s today plus this many days. Staff may set another expiry on the quote.',
    true
  );

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  agreement_version_id uuid not null,
  position integer not null check (position between 1 and 50),
  category public.quote_line_category not null,
  description text not null check (length(btrim(description)) between 1 and 300),
  amount_cents bigint not null check (amount_cents between 0 and 100000000000),
  tax_rate_bps integer check (tax_rate_bps is null or tax_rate_bps between 0 and 10000),
  source_note text check (source_note is null or length(source_note) <= 500),
  entered_by uuid references auth.users (id),
  entered_on date,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  unique (agreement_version_id, position),
  unique (id, organization_id),
  check (
    category <> 'government_fee'
    or (source_note is not null and length(btrim(source_note)) >= 3 and entered_by is not null and entered_on is not null)
  ),
  foreign key (agreement_version_id, organization_id) references public.agreement_versions (id, organization_id)
);
comment on table public.quote_lines is
  'One priced line of a quote version, in integer cents. A government_fee line is a dated reference entered by staff (source_note, entered_by, entered_on); the platform keeps no fee schedule.';
create index quote_lines_org_fk_idx on public.quote_lines (organization_id);
create index quote_lines_version_org_fk_idx on public.quote_lines (agreement_version_id, organization_id);
create index quote_lines_entered_by_idx on public.quote_lines (entered_by);

create table public.quote_instalments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  agreement_version_id uuid not null,
  position integer not null check (position between 1 and 12),
  label text not null check (length(btrim(label)) between 1 and 200),
  amount_cents bigint not null check (amount_cents between 0 and 100000000000),
  paid_as public.quote_paid_as not null,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  unique (agreement_version_id, position),
  unique (id, organization_id),
  foreign key (agreement_version_id, organization_id) references public.agreement_versions (id, organization_id)
);
comment on table public.quote_instalments is
  'When each part of a quote is paid: "On signing" or a milestone, in integer cents, as an advance (client account) or an invoice after delivery. They add up to the total to the firm.';
create index quote_instalments_org_fk_idx on public.quote_instalments (organization_id);
create index quote_instalments_version_org_fk_idx on public.quote_instalments (agreement_version_id, organization_id);

create table public.agreement_clauses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  agreement_version_id uuid not null,
  position integer not null check (position between 1 and 200),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null check (length(body) <= 20000),
  mandatory boolean not null default false,
  headed boolean not null default true,
  source public.agreement_clause_source not null default 'template',
  created_at timestamptz not null default now(),
  unique (agreement_version_id, position),
  unique (id, organization_id),
  foreign key (agreement_version_id, organization_id) references public.agreement_versions (id, organization_id)
);
comment on table public.agreement_clauses is
  'One agreement version''s text split into clauses by its "## " titles ("## !" = mandatory, owned by the professional reviewer). headed is false for a Preamble or a text without titles. Rebuilt whenever the version''s text changes.';
create index agreement_clauses_org_fk_idx on public.agreement_clauses (organization_id);
create index agreement_clauses_version_org_fk_idx on public.agreement_clauses (agreement_version_id, organization_id);

-- Rows of a locked version (sent, hashed) never change; an unlocked draft's rows are replaced
-- only by the functions below (there is no insert, update or delete grant).
create function app.guard_version_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_id uuid := case when tg_op = 'DELETE' then old.agreement_version_id else new.agreement_version_id end;
begin
  if exists (
    select 1 from public.agreement_versions ver
    where ver.id = version_id and ver.locked_at is not null
  ) then
    raise exception 'a locked agreement version cannot change' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_version_children() from public;
grant execute on function app.guard_version_children() to authenticated, service_role;

create trigger quote_lines_guard before insert or update or delete on public.quote_lines
  for each row execute function app.guard_version_children();
create trigger quote_lines_audit after insert or update or delete on public.quote_lines
  for each row execute function app.audit_row_change();
create trigger quote_instalments_guard before insert or update or delete on public.quote_instalments
  for each row execute function app.guard_version_children();
create trigger quote_instalments_audit after insert or update or delete on public.quote_instalments
  for each row execute function app.audit_row_change();
create trigger agreement_clauses_guard before insert or update or delete on public.agreement_clauses
  for each row execute function app.guard_version_children();
create trigger agreement_clauses_audit after insert or update or delete on public.agreement_clauses
  for each row execute function app.audit_row_change('body');

revoke all on table public.quote_lines from anon, authenticated;
revoke all on table public.quote_instalments from anon, authenticated;
revoke all on table public.agreement_clauses from anon, authenticated;
grant select on table public.quote_lines to authenticated;
grant select on table public.quote_instalments to authenticated;
grant select on table public.agreement_clauses to authenticated;

alter table public.quote_lines enable row level security;
alter table public.quote_lines force row level security;
alter table public.quote_instalments enable row level security;
alter table public.quote_instalments force row level security;
alter table public.agreement_clauses enable row level security;
alter table public.agreement_clauses force row level security;

create policy quote_lines_select on public.quote_lines
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.agreement_versions ver
      where ver.id = agreement_version_id
        and (select app.can_read_agreement(ver.agreement_id))
    )
  );
create policy quote_instalments_select on public.quote_instalments
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.agreement_versions ver
      where ver.id = agreement_version_id
        and (select app.can_read_agreement(ver.agreement_id))
    )
  );
create policy agreement_clauses_select on public.agreement_clauses
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.agreement_versions ver
      where ver.id = agreement_version_id
        and (select app.can_read_agreement(ver.agreement_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Clauses
-- ---------------------------------------------------------------------------

-- Splits an agreement text into clauses: "## Title" starts a clause, "## !Title" a mandatory
-- one. Text before the first title is the Preamble (headed false); a text with no title is one
-- clause, "Agreement text" (headed false). Blank-only clauses are dropped.
create function app.split_agreement_clauses(p_body text)
returns table (clause_position integer, clause_title text, clause_body text, clause_mandatory boolean, clause_headed boolean)
language plpgsql
immutable
set search_path = ''
as $$
declare
  line text;
  heading text;
  cur_title text := null;
  cur_mandatory boolean := false;
  cur_headed boolean := false;
  cur_lines text[] := array[]::text[];
  n integer := 0;
  seen_heading boolean := false;
  text_body text;
begin
  for line in select unnest(string_to_array(replace(coalesce(p_body, ''), E'\r\n', E'\n'), E'\n')) loop
    if line ~ '^##\s' then
      text_body := btrim(array_to_string(cur_lines, E'\n'), E' \t\n');
      if length(text_body) > 0 then
        n := n + 1;
        clause_position := n;
        clause_title := coalesce(cur_title, 'Preamble');
        clause_body := text_body;
        clause_mandatory := cur_mandatory;
        clause_headed := cur_headed;
        return next;
      elsif cur_headed then
        n := n + 1;
        clause_position := n;
        clause_title := cur_title;
        clause_body := '';
        clause_mandatory := cur_mandatory;
        clause_headed := true;
        return next;
      end if;
      seen_heading := true;
      heading := btrim(substr(line, 3));
      cur_mandatory := heading ~ '^!';
      if cur_mandatory then
        heading := btrim(substr(heading, 2));
      end if;
      cur_title := left(coalesce(nullif(heading, ''), 'Clause'), 200);
      cur_headed := true;
      cur_lines := array[]::text[];
    else
      cur_lines := cur_lines || line;
    end if;
  end loop;
  text_body := btrim(array_to_string(cur_lines, E'\n'), E' \t\n');
  if length(text_body) > 0 or cur_headed then
    n := n + 1;
    clause_position := n;
    clause_title := coalesce(cur_title, case when seen_heading then 'Preamble' else 'Agreement text' end);
    clause_body := text_body;
    clause_mandatory := cur_mandatory;
    clause_headed := cur_headed;
    return next;
  end if;
  return;
end;
$$;
revoke all on function app.split_agreement_clauses(text) from public;
grant execute on function app.split_agreement_clauses(text) to authenticated, service_role;

-- Joins a version's clauses back into the agreement text, with one clause's body replaced.
create function app.join_agreement_clauses(p_version_id uuid, p_clause_id uuid, p_body text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select string_agg(
    case when clause.headed then '## ' || case when clause.mandatory then '!' else '' end || clause.title || E'\n' else '' end
      || case when clause.id = p_clause_id then coalesce(p_body, '') else clause.body end,
    E'\n\n' order by clause.position
  )
  from public.agreement_clauses clause
  where clause.agreement_version_id = p_version_id;
$$;
revoke all on function app.join_agreement_clauses(uuid, uuid, text) from public;
grant execute on function app.join_agreement_clauses(uuid, uuid, text) to authenticated, service_role;

-- Rebuilds a version's clause rows from its text. Mandatory: "## !" in the text, or a title in
-- the template's mandatory_clauses. Source: 'template' when the wording equals the template's
-- clause of the same title (or, without a template, version 1's), else 'edited'.
create function app.store_agreement_clauses(p_version_id uuid, p_body text, p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ver public.agreement_versions%rowtype;
  template public.agreement_templates%rowtype;
  owned text[] := array[]::text[];
  reference_body text;
  clause record;
  reference_text text;
begin
  select * into ver from public.agreement_versions where id = p_version_id;
  if ver.id is null then
    return;
  end if;
  if p_template_id is not null then
    select * into template from public.agreement_templates where id = p_template_id and organization_id = ver.organization_id;
    owned := coalesce(template.mandatory_clauses, array[]::text[]);
    reference_body := template.body;
  end if;
  if reference_body is null then
    select first.body into reference_body
    from public.agreement_versions first
    where first.agreement_id = ver.agreement_id
      and first.version_number = 1
      and first.id <> ver.id;
  end if;
  delete from public.agreement_clauses where agreement_version_id = ver.id;
  for clause in select * from app.split_agreement_clauses(p_body) loop
    reference_text := null;
    if reference_body is not null then
      select split.clause_body into reference_text
      from app.split_agreement_clauses(reference_body) split
      where lower(btrim(split.clause_title)) = lower(btrim(clause.clause_title))
      order by split.clause_position
      limit 1;
    end if;
    insert into public.agreement_clauses (
      organization_id, agreement_version_id, position, title, body, mandatory, headed, source
    ) values (
      ver.organization_id,
      ver.id,
      clause.clause_position,
      clause.clause_title,
      clause.clause_body,
      clause.clause_mandatory or exists (
        select 1 from unnest(owned) name where lower(btrim(name)) = lower(btrim(clause.clause_title))
      ),
      clause.clause_headed,
      case when reference_body is null or reference_text is not distinct from clause.clause_body then 'template'::public.agreement_clause_source else 'edited'::public.agreement_clause_source end
    );
  end loop;
end;
$$;
revoke all on function app.store_agreement_clauses(uuid, text, uuid) from public;
grant execute on function app.store_agreement_clauses(uuid, text, uuid) to authenticated, service_role;

-- app.create_agreement: latest definition from 20261017190100_inhouse_esign.sql (its only one).
-- Only change: the text alone is stored on the version (body) and its clauses are built.
create or replace function app.create_agreement(
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
    refund_policy, fee_cents, currency, government_fee_note, comparison_note, body
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
    p_comparison,
    body
  )
  returning id into version_id;
  perform app.store_agreement_clauses(version_id, body, p_template_id);
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

-- app.revise_agreement: latest definition from 20261017190100_inhouse_esign.sql (its only one).
-- Only change: the text alone is stored on the version (body) and its clauses are rebuilt, in
-- both the in-place and the new-version branches.
create or replace function app.revise_agreement(
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
        comparison_note = btrim(p_comparison),
        body = p_body
    where id = ver.id;
    perform app.close_esign_write(ver.id);
    perform app.store_agreement_clauses(ver.id, p_body, agreement.template_id);
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
    refund_policy, fee_cents, currency, government_fee_note, comparison_note, body
  ) values (
    agreement.organization_id, agreement.id, next_number, canonical, btrim(p_scope), ver.exclusions,
    ver.refund_policy, p_fee_cents, ver.currency, p_government_fee_note, btrim(p_comparison), p_body
  )
  returning id into new_version;
  perform app.store_agreement_clauses(new_version, p_body, agreement.template_id);
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

-- Replaces one non-mandatory clause's wording. In place while the version is unlocked with no
-- live envelope; otherwise a new version with a comparison note (app.revise_agreement). An
-- executed or accepted agreement is refused there (AGR-04).
create function app.edit_agreement_clause(p_agreement_id uuid, p_clause_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.agreements%rowtype;
  ver public.agreement_versions%rowtype;
  clause public.agreement_clauses%rowtype;
  new_body text;
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
  if p_body is null or length(btrim(p_body)) not between 1 and 20000 then
    raise exception 'clause text is required' using errcode = '22023';
  end if;
  select * into ver from public.agreement_versions where id = agreement.current_version_id;
  select * into clause
  from public.agreement_clauses
  where id = p_clause_id
    and agreement_version_id = ver.id
    and organization_id = agreement.organization_id;
  if clause.id is null then
    raise exception 'clause denied' using errcode = '42501';
  end if;
  if clause.mandatory then
    raise exception 'a mandatory clause is owned by the professional reviewer' using errcode = '42501';
  end if;
  if btrim(p_body, E' \t\n') = clause.body then
    return ver.id;
  end if;
  new_body := app.join_agreement_clauses(ver.id, clause.id, btrim(p_body, E' \t\n'));
  if new_body is null or length(new_body) not between 1 and 20000 then
    raise exception 'the agreement text is too long' using errcode = '22023';
  end if;
  return app.revise_agreement(
    agreement.id,
    new_body,
    ver.scope_summary,
    ver.fee_cents,
    ver.government_fee_note,
    'Clause ' || clause.position::text || ' (' || clause.title || ') edited'
  );
end;
$$;
revoke all on function app.edit_agreement_clause(uuid, uuid, text) from public;
grant execute on function app.edit_agreement_clause(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Quotes
-- ---------------------------------------------------------------------------

-- The firm's today plus agreements.quote_days (30 when unset or out of 1..365).
create function app.quote_default_expiry(p_org uuid)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  days integer;
begin
  select coalesce((value ->> 'days')::integer, 30) into days
  from public.product_settings
  where key = 'agreements.quote_days';
  if days is null or days < 1 or days > 365 then
    days := 30;
  end if;
  return app.firm_today(p_org) + days;
end;
$$;
revoke all on function app.quote_default_expiry(uuid) from public;
grant execute on function app.quote_default_expiry(uuid) to authenticated, service_role;

-- Starts a quote on a matter from an approved quote template, or blank. The quote's scope starts
-- as its title and is set in Edit quote (save_quote) before it is sent.
create function app.create_quote(p_matter_id uuid, p_title text, p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  template public.agreement_templates%rowtype;
  title text;
  new_id uuid;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(matter.organization_id, true);
  if p_template_id is not null then
    select * into template
    from public.agreement_templates
    where id = p_template_id
      and organization_id = matter.organization_id
      and status = 'approved'
      and kind = 'quote';
    if template.id is null then
      raise exception 'an approved template is required' using errcode = '42501';
    end if;
  end if;
  title := left(coalesce(nullif(btrim(coalesce(p_title, '')), ''), template.name, 'Quote'), 200);
  new_id := app.create_agreement(
    matter.id, 'quote', title, coalesce(template.body, title), title,
    null, null, null, 'CAD', null, template.id, app.quote_default_expiry(matter.organization_id), null, null
  );
  perform app.record_audit_event(
    matter.organization_id, 'agreement.quote_created', 'public.agreements', new_id, 'success',
    jsonb_build_object('matter_id', matter.id, 'template_id', template.id, 'is_sample', matter.is_sample)
  );
  return new_id;
end;
$$;
revoke all on function app.create_quote(uuid, text, uuid) from public;
grant execute on function app.create_quote(uuid, text, uuid) to authenticated, service_role;

-- Saves a quote's scope, texts, expiry, lines and instalments. Totals are computed here in
-- cents. An unlocked draft is edited in place; a locked (sent) quote gets version N+1
-- ("Quote revised") and returns to draft. An accepted quote is never edited.
create function app.save_quote(
  p_agreement_id uuid,
  p_scope text,
  p_services text,
  p_exclusions text,
  p_deliverables text,
  p_fee_structure text,
  p_refund_policy text,
  p_quote_expires_on date,
  p_government_fee_note text,
  p_lines jsonb,
  p_instalments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.agreements%rowtype;
  matter public.matters%rowtype;
  ver public.agreement_versions%rowtype;
  item jsonb;
  ordinal integer;
  line_category public.quote_line_category;
  line_paid_as public.quote_paid_as;
  line_amount bigint;
  line_rate integer;
  line_text text;
  line_note text;
  fee_total bigint := 0;
  firm_total bigint := 0;
  instalment_total bigint := 0;
  today date;
  version_id uuid;
  next_number integer;
  comparison text;
  quote_body text;
  canonical text;
  lines_text text := '';
  instalments_text text := '';
begin
  select * into agreement from public.agreements where id = p_agreement_id for update;
  if agreement.id is null or app.can_read_agreement(agreement.id) is distinct from true then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  if agreement.kind <> 'quote' then
    raise exception 'only a quote is saved here' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(agreement.organization_id, true);
  if agreement.status = 'accepted' then
    raise exception 'an accepted quote cannot be edited; make a new quote' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = agreement.matter_id;
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if app.responsible_licence_blocks_agreement(matter.id) then
    raise exception 'not entitled, revoked, suspended, or inactive licence blocks this agreement' using errcode = '42501';
  end if;
  if p_scope is null or length(btrim(p_scope)) not between 3 and 2000 then
    raise exception 'agreement scope is required' using errcode = '22023';
  end if;
  if length(coalesce(p_services, '')) > 2000 or length(coalesce(p_exclusions, '')) > 2000
     or length(coalesce(p_deliverables, '')) > 2000 or length(coalesce(p_refund_policy, '')) > 2000
     or length(coalesce(p_fee_structure, '')) > 500 or length(coalesce(p_government_fee_note, '')) > 500 then
    raise exception 'a quote text is too long' using errcode = '22023';
  end if;
  today := app.firm_today(agreement.organization_id);
  if p_quote_expires_on is null or p_quote_expires_on < today then
    raise exception 'quote expiry must be today or later' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 50 then
    raise exception 'quote lines must be a list of at most 50' using errcode = '22023';
  end if;
  if p_instalments is null or jsonb_typeof(p_instalments) <> 'array' or jsonb_array_length(p_instalments) > 12 then
    raise exception 'quote instalments must be a list of at most 12' using errcode = '22023';
  end if;

  -- Validate and total the lines before anything is written.
  for item, ordinal in select value, ordinality::integer from jsonb_array_elements(p_lines) with ordinality loop
    begin
      line_category := (item ->> 'category')::public.quote_line_category;
    exception when invalid_text_representation then
      raise exception 'quote line category is not supported' using errcode = '22023';
    end;
    line_text := btrim(coalesce(item ->> 'description', ''));
    if length(line_text) not between 1 and 300 then
      raise exception 'each quote line needs a description' using errcode = '22023';
    end if;
    if coalesce(item ->> 'amount_cents', '') !~ '^[0-9]{1,12}$' then
      raise exception 'each quote line needs a whole amount in cents' using errcode = '22023';
    end if;
    line_amount := (item ->> 'amount_cents')::bigint;
    line_rate := nullif(item ->> 'tax_rate_bps', '')::integer;
    if line_rate is not null and line_rate not between 0 and 10000 then
      raise exception 'a tax rate is between 0 and 100 percent' using errcode = '22023';
    end if;
    line_note := nullif(btrim(coalesce(item ->> 'source_note', '')), '');
    if line_category = 'government_fee' and (line_note is null or length(line_note) < 3) then
      raise exception 'a government fee line needs a dated reference to the official fee list' using errcode = '22023';
    end if;
    if line_note is not null and length(line_note) > 500 then
      raise exception 'keep the fee reference to 500 characters' using errcode = '22023';
    end if;
    if line_category = 'professional_fee' then
      fee_total := fee_total + line_amount;
    end if;
    if line_category <> 'government_fee' then
      firm_total := firm_total + line_amount;
    end if;
    lines_text := lines_text || E'\n- ' || line_category::text || ' | ' || line_text || ' | ' || line_amount::text
      || coalesce(' | ' || line_rate::text || ' bps', '') || coalesce(' | ' || line_note, '');
  end loop;
  for item, ordinal in select value, ordinality::integer from jsonb_array_elements(p_instalments) with ordinality loop
    begin
      line_paid_as := (item ->> 'paid_as')::public.quote_paid_as;
    exception when invalid_text_representation then
      raise exception 'instalment payment kind is not supported' using errcode = '22023';
    end;
    line_text := btrim(coalesce(item ->> 'label', ''));
    if length(line_text) not between 1 and 200 then
      raise exception 'each instalment needs a label' using errcode = '22023';
    end if;
    if coalesce(item ->> 'amount_cents', '') !~ '^[0-9]{1,12}$' then
      raise exception 'each instalment needs a whole amount in cents' using errcode = '22023';
    end if;
    line_amount := (item ->> 'amount_cents')::bigint;
    instalment_total := instalment_total + line_amount;
    instalments_text := instalments_text || E'\n- ' || line_text || ' | ' || line_amount::text || ' | ' || line_paid_as::text;
  end loop;
  if jsonb_array_length(p_instalments) > 0 and instalment_total <> firm_total then
    raise exception 'instalments must add up to the total to the firm' using errcode = '22023';
  end if;

  select * into ver from public.agreement_versions where id = agreement.current_version_id;
  quote_body := concat_ws(E'\n',
    'Scope: ' || btrim(p_scope),
    'Services: ' || coalesce(p_services, ''),
    'Not included: ' || coalesce(p_exclusions, ''),
    'Deliverables: ' || coalesce(p_deliverables, ''),
    'Fee structure: ' || coalesce(p_fee_structure, ''),
    'Expires on: ' || p_quote_expires_on::text,
    'Lines:' || lines_text,
    'Professional fee: ' || fee_total::text || ' ' || ver.currency,
    'Total to the firm: ' || firm_total::text || ' ' || ver.currency,
    'Instalments:' || instalments_text,
    'Refund policy: ' || coalesce(p_refund_policy, ''),
    'Government fees: ' || coalesce(p_government_fee_note, '')
  );
  if length(quote_body) > 20000 then
    raise exception 'the quote text is too long' using errcode = '22023';
  end if;

  if ver.locked_at is null then
    comparison := ver.comparison_note;
    canonical := app.agreement_canonical(
      'quote', agreement.title, btrim(p_scope), p_exclusions, p_refund_policy,
      fee_total, ver.currency, p_government_fee_note, comparison, quote_body
    );
    perform app.open_esign_write(ver.id);
    update public.agreement_versions
    set canonical_body = canonical,
        scope_summary = btrim(p_scope),
        exclusions = p_exclusions,
        refund_policy = p_refund_policy,
        fee_cents = fee_total,
        government_fee_note = p_government_fee_note,
        body = quote_body,
        services = p_services,
        deliverables = p_deliverables,
        fee_structure = p_fee_structure
    where id = ver.id;
    perform app.close_esign_write(ver.id);
    version_id := ver.id;
    delete from public.quote_lines where agreement_version_id = ver.id;
    delete from public.quote_instalments where agreement_version_id = ver.id;
  else
    comparison := 'Quote revised';
    select coalesce(max(version_number), 0) + 1 into next_number
    from public.agreement_versions
    where agreement_id = agreement.id;
    canonical := app.agreement_canonical(
      'quote', agreement.title, btrim(p_scope), p_exclusions, p_refund_policy,
      fee_total, ver.currency, p_government_fee_note, comparison, quote_body
    );
    insert into public.agreement_versions (
      organization_id, agreement_id, version_number, canonical_body, scope_summary, exclusions,
      refund_policy, fee_cents, currency, government_fee_note, comparison_note, body,
      services, deliverables, fee_structure
    ) values (
      agreement.organization_id, agreement.id, next_number, canonical, btrim(p_scope), p_exclusions,
      p_refund_policy, fee_total, ver.currency, p_government_fee_note, comparison, quote_body,
      p_services, p_deliverables, p_fee_structure
    )
    returning id into version_id;
  end if;

  for item, ordinal in select value, ordinality::integer from jsonb_array_elements(p_lines) with ordinality loop
    line_category := (item ->> 'category')::public.quote_line_category;
    insert into public.quote_lines (
      organization_id, agreement_version_id, position, category, description, amount_cents, tax_rate_bps,
      source_note, entered_by, entered_on, is_sample
    ) values (
      agreement.organization_id,
      version_id,
      ordinal,
      line_category,
      btrim(item ->> 'description'),
      (item ->> 'amount_cents')::bigint,
      nullif(item ->> 'tax_rate_bps', '')::integer,
      nullif(btrim(coalesce(item ->> 'source_note', '')), ''),
      case when line_category = 'government_fee' then (select auth.uid()) else null end,
      case when line_category = 'government_fee' then today else null end,
      matter.is_sample
    );
  end loop;
  for item, ordinal in select value, ordinality::integer from jsonb_array_elements(p_instalments) with ordinality loop
    insert into public.quote_instalments (
      organization_id, agreement_version_id, position, label, amount_cents, paid_as, is_sample
    ) values (
      agreement.organization_id,
      version_id,
      ordinal,
      btrim(item ->> 'label'),
      (item ->> 'amount_cents')::bigint,
      (item ->> 'paid_as')::public.quote_paid_as,
      matter.is_sample
    );
  end loop;

  perform app.open_esign_write(agreement.id);
  update public.agreements
  set quote_expires_on = p_quote_expires_on,
      status = 'draft',
      current_version_id = version_id
  where id = agreement.id;
  perform app.close_esign_write(agreement.id);
  perform app.record_audit_event(
    agreement.organization_id,
    case when version_id = ver.id then 'agreement.quote_saved' else 'agreement.quote_revised' end,
    'public.agreement_versions',
    version_id,
    'success',
    jsonb_build_object('fee_cents', fee_total, 'total_cents', firm_total, 'lines', jsonb_array_length(p_lines), 'instalments', jsonb_array_length(p_instalments))
  );
  return version_id;
end;
$$;
revoke all on function app.save_quote(uuid, text, text, text, text, text, text, date, text, jsonb, jsonb) from public;
grant execute on function app.save_quote(uuid, text, text, text, text, text, text, date, text, jsonb, jsonb) to authenticated, service_role;

-- Sends a draft quote: app.send_agreement for a quote (hash, lock, status sent, no envelope).
-- No email is queued: there is no approved email design for a sent quote.
create function app.send_quote(p_agreement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.agreements%rowtype;
  matter public.matters%rowtype;
  ver public.agreement_versions%rowtype;
  result jsonb;
begin
  select * into agreement from public.agreements where id = p_agreement_id;
  if agreement.id is null or app.can_read_agreement(agreement.id) is distinct from true then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  if agreement.kind <> 'quote' then
    raise exception 'only a quote is sent here' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(agreement.organization_id, true);
  if agreement.status <> 'draft' then
    raise exception 'only a draft quote can be issued' using errcode = '42501';
  end if;
  if agreement.quote_expires_on is null or agreement.quote_expires_on < app.firm_today(agreement.organization_id) then
    raise exception 'quote expiry must be today or later' using errcode = '22023';
  end if;
  select * into ver from public.agreement_versions where id = agreement.current_version_id;
  select * into matter from public.matters where id = agreement.matter_id;
  result := app.send_agreement(agreement.id, '[]'::jsonb, 'quote-send-' || agreement.id::text || '-v' || ver.version_number::text, null);
  perform app.record_audit_event(
    agreement.organization_id, 'agreement.quote_sent', 'public.agreements', agreement.id, 'success',
    jsonb_build_object('matter_id', agreement.matter_id, 'is_sample', matter.is_sample, 'version_number', ver.version_number, 'email', false)
  );
  return result;
end;
$$;
revoke all on function app.send_quote(uuid) from public;
grant execute on function app.send_quote(uuid) to authenticated, service_role;

-- A service-agreement draft from a sent or accepted quote: scope, fee, currency, exclusions,
-- refund policy and government-fee note carried over; the text from an approved service template.
create function app.quote_to_agreement(p_agreement_id uuid, p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement public.agreements%rowtype;
  ver public.agreement_versions%rowtype;
  template public.agreement_templates%rowtype;
  new_id uuid;
begin
  select * into agreement from public.agreements where id = p_agreement_id;
  if agreement.id is null or app.can_read_agreement(agreement.id) is distinct from true then
    raise exception 'agreement denied' using errcode = '42501';
  end if;
  if agreement.kind <> 'quote' then
    raise exception 'only a quote turns into an agreement' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(agreement.organization_id, true);
  if agreement.status not in ('sent', 'accepted') then
    raise exception 'send the quote before turning it into an agreement' using errcode = '42501';
  end if;
  select * into template
  from public.agreement_templates
  where id = p_template_id
    and organization_id = agreement.organization_id
    and status = 'approved'
    and kind = 'service';
  if template.id is null then
    raise exception 'an approved template is required' using errcode = '42501';
  end if;
  select * into ver from public.agreement_versions where id = agreement.current_version_id;
  new_id := app.create_agreement(
    agreement.matter_id, 'service', template.name, null, ver.scope_summary, ver.exclusions, ver.refund_policy,
    ver.fee_cents, ver.currency, ver.government_fee_note, template.id, null, null, null
  );
  perform app.record_audit_event(
    agreement.organization_id, 'agreement.created_from_quote', 'public.agreements', new_id, 'success',
    jsonb_build_object('quote_id', agreement.id, 'quote_status', agreement.status, 'template_id', template.id)
  );
  return new_id;
end;
$$;
revoke all on function app.quote_to_agreement(uuid, uuid) from public;
grant execute on function app.quote_to_agreement(uuid, uuid) to authenticated, service_role;

-- app.accept_quote: latest definition from 20261019216100_firm_today_rules.sql.
-- Only change: who accepted and when are recorded (accepted_at, accepted_by) and audited.
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

-- ---------------------------------------------------------------------------
-- Public wrappers (security invoker; the database checks the caller)
-- ---------------------------------------------------------------------------

create function public.create_quote(p_matter_id uuid, p_title text, p_template_id uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select app.create_quote(p_matter_id, p_title, p_template_id); $$;
create function public.save_quote(
  p_agreement_id uuid, p_scope text, p_services text, p_exclusions text, p_deliverables text,
  p_fee_structure text, p_refund_policy text, p_quote_expires_on date, p_government_fee_note text,
  p_lines jsonb, p_instalments jsonb
) returns uuid language sql security invoker set search_path = ''
as $$
  select app.save_quote(
    p_agreement_id, p_scope, p_services, p_exclusions, p_deliverables, p_fee_structure,
    p_refund_policy, p_quote_expires_on, p_government_fee_note, p_lines, p_instalments
  );
$$;
create function public.send_quote(p_agreement_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select app.send_quote(p_agreement_id); $$;
create function public.quote_to_agreement(p_agreement_id uuid, p_template_id uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select app.quote_to_agreement(p_agreement_id, p_template_id); $$;
create function public.edit_agreement_clause(p_agreement_id uuid, p_clause_id uuid, p_body text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.edit_agreement_clause(p_agreement_id, p_clause_id, p_body); $$;

revoke all on function public.create_quote(uuid, text, uuid) from public, anon;
revoke all on function public.save_quote(uuid, text, text, text, text, text, text, date, text, jsonb, jsonb) from public, anon;
revoke all on function public.send_quote(uuid) from public, anon;
revoke all on function public.quote_to_agreement(uuid, uuid) from public, anon;
revoke all on function public.edit_agreement_clause(uuid, uuid, text) from public, anon;
grant execute on function public.create_quote(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.save_quote(uuid, text, text, text, text, text, text, date, text, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.send_quote(uuid) to authenticated, service_role;
grant execute on function public.quote_to_agreement(uuid, uuid) to authenticated, service_role;
grant execute on function public.edit_agreement_clause(uuid, uuid, text) to authenticated, service_role;
