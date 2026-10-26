-- Live official claims with firm-only licensed edits (#188). Francis's decisions, 2026-10-25:
-- 11:42 / 11:50 CDT (captured official claims go live on load with no label; licensed edits are
-- firm-only overrides, a fresh step-up every time, stamped and kept; a changed re-capture goes live
-- and flags the firm's edit "Source changed since your edit"; the stale block stays; suspended
-- claims stay suspended, with a stamped step-up unsuspend; author/approver distinctness no longer
-- applies to captured claims) and 4:48 PM CDT (proposal approved as proposed: firm-added claims
-- keep licensed approval with step-up; overdue windows 7 days for fees, forms and checklists, 14
-- for program pages and guides, 30 for law, as product settings source.recheck_interval.*).
--
-- 1. Official claims. A captured claim is a platform rule version (organization_id null) with
--    origin official_capture, shared by every firm, live as soon as it is loaded with its evidence
--    (URL and section, SHA-256 and retrieval time of the page, the dates the page prints). Only
--    app.load_official_claims (scripts/ops/load-official-claims.mjs) loads them, and only in a
--    database maintenance session: the app, the service role, Vo, imports and jobs can't. A changed
--    page hash or claim text loads a new version that goes live and supersedes the old one; an
--    unchanged one records a successful check and nothing else (RULES §7).
-- 2. Firm edits. public.edit_rule_claim records a firm's own wording (or a revert to the official
--    text) in public.rule_claim_overrides: append-only, forced RLS, no table grants, written only
--    by app.edit_rule_claim after a licensed member's fresh step-up (each step-up is used once,
--    public.rule_step_up_uses). The captured version is never changed. "Source changed since your
--    edit" is worked out, never stored: the edit's base version is no longer the live one.
-- 3. Reading. app.firm_rule_claim(org, definition) is the one read of a claim for a firm: the
--    official text and evidence, the firm's edit and stamp, source_changed and stale. Vo, the
--    support catalogue and Source review read through it.
-- 4. Stale. A source is overdue when its last successful check is older than its category's
--    interval (source.recheck_interval.fee|form|checklist|program|law; guides use program). Vo
--    doesn't cite an overdue fee or advice-like official claim and says why.
-- 5. Kept from SRC-03: review_rule_version, suspend_rule_version, the publication gate and
--    app.rule_version_is_live. Firm-entered claims (Add claim) still need licensed review with a
--    step-up. New: public.unsuspend_rule_version (licensed, fresh step-up, audited).
--
-- New tables: public.rule_claim_overrides, public.rule_step_up_uses.
-- New columns: rule_versions.origin; rule_definitions.source_category. The stable-key check now
-- allows a segment that starts with a digit (IRCC guide numbers, "CA.GUIDE.5269.INTRO").
-- Redefined (each copied from its latest definition; changes marked "Live claims"):
--   app.prepare_rule_definition()          20261017113157  source_category is immutable
--   app.guard_rule_version()               20261025400000  official captures: maintenance only
--   app.rule_publication_blockers(uuid,int) 20261025400000  official captures need no review
--   app.apply_source_check_attempt()       20261017113157  an unchanged re-capture moves "last checked"
--   app.rule_pack_is_live(uuid)            20261025410100  a pack item follows its claim's live official version
--   app.src_rule_from_pinned_pack()        20261025410000  a live official claim of the matter's program counts
--   app.support_catalogue(uuid)            20261025410100  live official claims count; stale flag; firm edit stamps
--   app.vo_official_attestation(...)       20261025450000  also returns the firm's edit stamp
--   app.vo_letter_official_items(uuid,uuid) 20261025450000 firm wording, CA.FEES.* for any pack, stale block
--   public.vo_run_official_content(uuid)   20261025450000  lists overdue claims Vo won't cite, with why
--   public.finish_vo_run(...)              20261025450000  a draft's source list keeps the edit stamp
-- Seeds: the five source.recheck_interval.* product settings. No claim is seeded: the loader loads
-- the committed capture files after this migration.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.rule_versions
  add column origin public.rule_origin not null default 'firm_entry';
alter table public.rule_versions
  add constraint rule_versions_official_capture_platform check (origin = 'firm_entry' or organization_id is null);
create index rule_versions_official_definition_idx on public.rule_versions (definition_id, version_number desc) where origin = 'official_capture';
comment on column public.rule_versions.origin is
  'official_capture: loaded from Casevoya''s capture of an official page (platform-wide, live on load). firm_entry: entered by a firm and published only through licensed review.';

-- IRCC guide numbers make segments that start with a digit (CA.GUIDE.5269.INTRO).
alter table public.rule_definitions drop constraint rule_definitions_stable_key_check;
alter table public.rule_definitions
  add constraint rule_definitions_stable_key_check check (stable_key ~ '^[A-Z][A-Z0-9]*(\.[A-Z0-9][A-Z0-9_]*)+$');

alter table public.rule_definitions
  add column source_category text,
  add constraint rule_definitions_source_category check (
    source_category is null
    or (organization_id is null and source_category in ('fee', 'form', 'checklist', 'program', 'guide', 'law'))
  );
comment on column public.rule_definitions.source_category is
  'Official captures only: the kind of page the claim is read from. Sets how long its source may go unchecked (source.recheck_interval.*).';

-- ---------------------------------------------------------------------------
-- Overdue windows (product settings; Francis 4:48 PM CDT 2026-10-25)
-- ---------------------------------------------------------------------------

insert into public.product_settings (key, value, description, pending_confirmation) values
  ('source.recheck_interval.fee', '{"unit":"days","count":7}'::jsonb,
   'An official fee claim''s source is overdue for a re-check when its last successful check is older than this. Vo won''t cite an overdue fee. Confirmed by Francis 2026-10-25.', false),
  ('source.recheck_interval.form', '{"unit":"days","count":7}'::jsonb,
   'An official form claim''s source is overdue for a re-check when its last successful check is older than this. Confirmed by Francis 2026-10-25.', false),
  ('source.recheck_interval.checklist', '{"unit":"days","count":7}'::jsonb,
   'An official checklist claim''s source is overdue for a re-check when its last successful check is older than this. Confirmed by Francis 2026-10-25.', false),
  ('source.recheck_interval.program', '{"unit":"days","count":14}'::jsonb,
   'An official program page or guide claim''s source is overdue for a re-check when its last successful check is older than this. Confirmed by Francis 2026-10-25.', false),
  ('source.recheck_interval.law', '{"unit":"days","count":30}'::jsonb,
   'An official Justice Laws claim''s source is overdue for a re-check when its last successful check is older than this. Confirmed by Francis 2026-10-25.', false);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- A database maintenance session: no request claims and none of the API roles. That is where
-- migrations and operators (scripts/ops) work; never the app, Vo, an import or a job.
create function app.db_maintenance_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(current_setting('request.jwt.claims', true), '') = ''
    and coalesce(current_setting('request.jwt.claim.sub', true), '') = ''
    and coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon', 'service_role');
$$;
revoke all on function app.db_maintenance_session() from public, anon, authenticated, service_role;

-- How long an official claim's source may go without a successful check, by its category.
create function app.source_recheck_interval(p_category text)
returns interval
language sql
stable
security definer
set search_path = ''
as $$
  select app.product_setting_interval('source.recheck_interval.' || case when p_category = 'guide' then 'program' else p_category end)
  where p_category in ('fee', 'form', 'checklist', 'program', 'guide', 'law');
$$;
revoke all on function app.source_recheck_interval(text) from public, anon;
grant execute on function app.source_recheck_interval(text) to authenticated, service_role;

-- The captured page a rule version rests on (its newest capture) and that page's check state.
create function app.rule_version_source(p_version uuid)
returns table (
  snapshot_id uuid,
  source_id uuid,
  content_hash text,
  retrieved_at timestamptz,
  final_url text,
  publisher text,
  last_checked_at timestamptz,
  last_attempt_at timestamptz,
  last_attempt_result public.source_observation
)
language sql
stable
security definer
set search_path = ''
as $$
  select snap.id, snap.source_id, snap.content_hash, snap.retrieved_at, snap.final_url, snap.publisher,
         src.last_checked_at, src.last_attempt_at, src.last_attempt_result
  from public.rule_evidence link
  join public.source_snapshots snap on snap.id = link.snapshot_id
  join public.official_sources src on src.id = snap.source_id
  where link.rule_version_id = p_version
  order by snap.retrieved_at desc
  limit 1;
$$;
revoke all on function app.rule_version_source(uuid) from public, anon, authenticated, service_role;

-- The live official version of a platform claim (newest first), or null.
create function app.official_live_version(p_definition uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id
  from public.rule_versions v
  where v.definition_id = p_definition
    and v.origin = 'official_capture'
    and app.rule_version_is_live(v.id)
  order by v.version_number desc
  limit 1;
$$;
revoke all on function app.official_live_version(uuid) from public, anon;
grant execute on function app.official_live_version(uuid) to authenticated, service_role;

-- Overdue: an official claim whose source's last successful check is older than its category's
-- interval (or that was never checked). Firm-entered claims have no category and are never "stale" here.
create function app.official_claim_stale(p_version uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select src.last_checked_at is null
        or src.last_checked_at < statement_timestamp() - app.source_recheck_interval(d.source_category)
    from public.rule_versions v
    join public.rule_definitions d on d.id = v.definition_id
    cross join lateral app.rule_version_source(v.id) src
    where v.id = p_version
      and v.origin = 'official_capture'
      and app.source_recheck_interval(d.source_category) is not null
  ), false);
$$;
revoke all on function app.official_claim_stale(uuid) from public, anon;
grant execute on function app.official_claim_stale(uuid) to authenticated, service_role;

-- The organization the caller reads claims for: its staff with MFA. Refuses anyone else.
create function app.claims_reader_org()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization_id();
begin
  if (select auth.uid()) is null or v_org is null
     or app.is_org_staff(v_org) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  return v_org;
end;
$$;
revoke all on function app.claims_reader_org() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A fresh step-up, used once (decision 1: "a fresh step-up every time, server-enforced")
-- ---------------------------------------------------------------------------

-- The time of the newest second-factor check in this session within p_max_age (the moments
-- app.mfa_step_up_satisfied accepts: a passkey; at aal2 a TOTP, WebAuthn or recovery-code entry;
-- or a recovery-code proof for this session), or null.
create function app.latest_step_up_at(p_max_age interval default interval '15 minutes')
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := auth.jwt();
  aal2 boolean := app.current_aal() = 'aal2';
  entry jsonb;
  ts numeric;
  stamp timestamptz;
  best timestamptz;
  proof timestamptz;
begin
  if (select auth.uid()) is null or app.session_is_revoked() then
    return null;
  end if;
  if claims is not null and jsonb_typeof(claims -> 'amr') = 'array' then
    for entry in select value from jsonb_array_elements(claims -> 'amr') as t(value)
    loop
      if jsonb_typeof(entry) is distinct from 'object' then
        continue;
      end if;
      if not (entry ->> 'method' = 'passkey' or (aal2 and entry ->> 'method' in ('totp', 'mfa/webauthn', 'mfa/recovery_code'))) then
        continue;
      end if;
      begin
        ts := nullif(entry ->> 'timestamp', '')::numeric;
      exception when others then
        ts := null;
      end;
      if ts is null then
        continue;
      end if;
      if ts > 100000000000 then
        ts := ts / 1000.0;
      end if;
      stamp := to_timestamp(ts);
      if stamp > statement_timestamp() + interval '60 seconds' or stamp < statement_timestamp() - p_max_age then
        continue;
      end if;
      if best is null or stamp > best then
        best := stamp;
      end if;
    end loop;
  end if;
  select max(row_proof.created_at) into proof
  from public.mfa_assurance_proofs row_proof
  where row_proof.user_id = (select auth.uid())
    and row_proof.session_id = app.current_session_id()
    and row_proof.method = 'recovery_code'
    and row_proof.created_at >= statement_timestamp() - p_max_age;
  return greatest(best, proof);
end;
$$;
revoke all on function app.latest_step_up_at(interval) from public, anon, authenticated, service_role;

create table public.rule_step_up_uses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references auth.users (id),
  session_id uuid,
  step_up_at timestamptz not null,
  action text not null check (action in ('claim_edit', 'claim_revert', 'unsuspend')),
  object_id uuid not null,
  created_at timestamptz not null default clock_timestamp()
);
comment on table public.rule_step_up_uses is
  'Live claims: each step-up a licensed member used for a claim edit, revert or unsuspend. A step-up is used once; the next change needs a fresh one.';
create unique index rule_step_up_uses_once_uidx
  on public.rule_step_up_uses (user_id, coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid), step_up_at);
create index rule_step_up_uses_org_idx on public.rule_step_up_uses (organization_id);
create index rule_step_up_uses_user_idx on public.rule_step_up_uses (user_id);
revoke all on table public.rule_step_up_uses from public, anon, authenticated, service_role;
alter table public.rule_step_up_uses enable row level security;
alter table public.rule_step_up_uses force row level security;
create trigger rule_step_up_uses_no_change before update or delete on public.rule_step_up_uses
  for each row execute function app.reject_governed_delete();
create trigger rule_step_up_uses_no_truncate before truncate on public.rule_step_up_uses
  for each statement execute function app.reject_governed_delete();

-- Uses the caller's fresh step-up for one change, or refuses: none in the last 15 minutes, or this
-- one already used. Returns the step-up's time.
create function app.use_rule_step_up(p_org uuid, p_action text, p_object uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  stamp timestamptz := app.latest_step_up_at();
  zero constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  if stamp is null or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.rule_step_up_uses:' || (select auth.uid())::text, 0));
  if exists (
    select 1 from public.rule_step_up_uses used
    where used.user_id = (select auth.uid())
      and coalesce(used.session_id, zero) = coalesce(app.current_session_id(), zero)
      and used.step_up_at = stamp
  ) then
    raise exception 'step-up is required: each change to a claim needs a fresh step-up' using errcode = '42501';
  end if;
  insert into public.rule_step_up_uses (organization_id, user_id, session_id, step_up_at, action, object_id)
  values (p_org, (select auth.uid()), app.current_session_id(), stamp, p_action, p_object);
  return stamp;
end;
$$;
revoke all on function app.use_rule_step_up(uuid, text, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Firm edits: public.rule_claim_overrides (append-only)
-- ---------------------------------------------------------------------------

create table public.rule_claim_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  definition_id uuid not null references public.rule_definitions (id),
  base_version_id uuid not null references public.rule_versions (id),
  action text not null check (action in ('edit', 'revert')),
  claim_text text check (claim_text is null or length(btrim(claim_text)) between 3 and 2000),
  output_value jsonb check (output_value is null or (jsonb_typeof(output_value) = 'object' and length(output_value ->> 'text') between 1 and 200)),
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  editor_membership_id uuid not null,
  editor_name text not null check (length(btrim(editor_name)) between 1 and 120),
  editor_licence_id uuid not null,
  editor_licence_number text not null check (editor_licence_number ~ '^[A-Z0-9-]{1,40}$'),
  step_up_at timestamptz not null,
  step_up_session_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users (id),
  check ((action = 'edit') = (claim_text is not null)),
  check (action = 'edit' or output_value is null),
  unique (id, organization_id),
  foreign key (editor_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (editor_licence_id, organization_id) references public.consultant_credentials (id, organization_id)
);
comment on table public.rule_claim_overrides is
  'A firm''s licensed edits of a live official claim, append-only. The newest row is the firm''s current state: an edit shows its wording with "Edited by <name>, licence <number>, <date>", a revert means the official text applies. Other firms keep the official text. The captured version is never changed.';
comment on column public.rule_claim_overrides.base_version_id is
  'The official version the member edited. When it is no longer the live official version, the firm sees "Source changed since your edit".';
comment on column public.rule_claim_overrides.editor_licence_number is
  'The licence (College ID) as it was on the licence record when the edit was made.';

create index rule_claim_overrides_firm_claim_idx on public.rule_claim_overrides (organization_id, definition_id, created_at desc);
create index rule_claim_overrides_definition_idx on public.rule_claim_overrides (definition_id);
create index rule_claim_overrides_base_idx on public.rule_claim_overrides (base_version_id);
create index rule_claim_overrides_editor_idx on public.rule_claim_overrides (editor_membership_id, organization_id);
create index rule_claim_overrides_licence_idx on public.rule_claim_overrides (editor_licence_id, organization_id);
create index rule_claim_overrides_created_by_idx on public.rule_claim_overrides (created_by);

-- Only app.edit_rule_claim writes a row (it turns this on for its own insert); nothing updates or
-- deletes one. The service role and direct SQL as a signed-in member are refused.
create function app.guard_rule_claim_override()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'claim edits are kept as they were made' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.rule_override_write', true), '') is distinct from 'on' then
    raise exception 'a claim is edited only through Edit in Source review, by a licensed member with a step-up' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_rule_claim_override() from public;

create trigger rule_claim_overrides_guard before insert or update or delete on public.rule_claim_overrides
  for each row execute function app.guard_rule_claim_override();
create trigger rule_claim_overrides_stamp before insert on public.rule_claim_overrides
  for each row execute function app.stamp_created_by();
create trigger rule_claim_overrides_audit after insert on public.rule_claim_overrides
  for each row execute function app.audit_row_change();
create trigger rule_claim_overrides_no_truncate before truncate on public.rule_claim_overrides
  for each statement execute function app.reject_governed_delete();

revoke all on table public.rule_claim_overrides from public, anon, authenticated, service_role;
grant select on table public.rule_claim_overrides to authenticated;
alter table public.rule_claim_overrides enable row level security;
alter table public.rule_claim_overrides force row level security;
create policy rule_claim_overrides_select on public.rule_claim_overrides
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

-- The firm's current edit of a claim: its newest row when that row is an edit; null otherwise.
create function app.rule_claim_edit(p_org uuid, p_definition uuid)
returns public.rule_claim_overrides
language sql
stable
security definer
set search_path = ''
as $$
  select newest.*
  from (
    select row_override.*
    from public.rule_claim_overrides row_override
    where row_override.organization_id = p_org and row_override.definition_id = p_definition
    order by row_override.created_at desc, row_override.id desc
    limit 1
  ) newest
  where newest.action = 'edit';
$$;
revoke all on function app.rule_claim_edit(uuid, uuid) from public, anon, authenticated, service_role;

-- The firm's edit stamp for an official version it cites: {edited, edited_by, edited_licence,
-- edited_on, source_changed}; null when the firm hasn't edited the claim.
create function app.rule_version_firm_edit(p_org uuid, p_version uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_definition uuid;
  edit public.rule_claim_overrides;
begin
  if p_org is null or p_version is null then
    return null;
  end if;
  select v.definition_id into v_definition from public.rule_versions v where v.id = p_version and v.origin = 'official_capture';
  if v_definition is null then
    return null;
  end if;
  edit := app.rule_claim_edit(p_org, v_definition);
  if edit.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'edited', true,
    'edited_by', edit.editor_name,
    'edited_licence', edit.editor_licence_number,
    'edited_on', app.firm_local_date(p_org, edit.created_at),
    'source_changed', edit.base_version_id is distinct from app.official_live_version(v_definition)
  );
end;
$$;
revoke all on function app.rule_version_firm_edit(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reading a claim for a firm
-- ---------------------------------------------------------------------------

-- The one read of an official claim for one firm: the official text and its evidence, the firm's
-- edit and stamp when there is one, source_changed and stale. Null when the claim isn't a live
-- official claim. p_org null reads it as any firm does (no edit).
create function app.firm_rule_claim(p_org uuid, p_definition uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.rule_definitions%rowtype;
  v public.rule_versions%rowtype;
  link public.rule_evidence%rowtype;
  src record;
  edit public.rule_claim_overrides;
  recheck interval;
  overdue boolean;
  base_number integer;
begin
  select * into d from public.rule_definitions where id = p_definition and organization_id is null;
  if d.id is null then
    return null;
  end if;
  select * into v from public.rule_versions where id = app.official_live_version(d.id);
  if v.id is null then
    return null;
  end if;
  select * into link from public.rule_evidence e where e.rule_version_id = v.id order by (e.snapshot_id is null), e.created_at limit 1;
  select * into src from app.rule_version_source(v.id);
  recheck := app.source_recheck_interval(d.source_category);
  overdue := recheck is not null and (src.last_checked_at is null or src.last_checked_at < statement_timestamp() - recheck);
  if p_org is not null then
    edit := app.rule_claim_edit(p_org, d.id);
    if edit.id is not null then
      select base.version_number into base_number from public.rule_versions base where base.id = edit.base_version_id;
    end if;
  end if;
  return jsonb_build_object(
    'definition_id', d.id,
    'stable_key', d.stable_key,
    'program_key', d.program_key,
    'jurisdiction', d.jurisdiction,
    'category', d.source_category,
    'version_id', v.id,
    'version_number', v.version_number,
    'version', v.version,
    'official_claim', v.claim,
    'official_value', v.output_value ->> 'text',
    'claim', coalesce(edit.claim_text, v.claim),
    'value', case when edit.id is not null then edit.output_value ->> 'text' else v.output_value ->> 'text' end,
    'source_url', link.source_url,
    'section', link.source_section,
    'excerpt', link.evidence_excerpt,
    'form_number', link.form_number,
    'modified_on', link.modified_on,
    'last_amended_on', link.last_amended_on,
    'current_to', link.current_to,
    'checked_on', link.checked_on,
    'publisher', src.publisher,
    'sha256', src.content_hash,
    'retrieved_at', src.retrieved_at,
    'last_checked_at', src.last_checked_at,
    'last_attempt_at', src.last_attempt_at,
    'last_attempt_result', src.last_attempt_result,
    'recheck_days', case when recheck is null then null else extract(day from recheck)::integer end,
    'stale', coalesce(overdue, false),
    'edit', case when edit.id is null then null else jsonb_build_object(
      'id', edit.id,
      'claim', edit.claim_text,
      'value', edit.output_value ->> 'text',
      'reason', edit.reason,
      'editor', edit.editor_name,
      'licence_number', edit.editor_licence_number,
      'edited_at', edit.created_at,
      'edited_on', app.firm_local_date(p_org, edit.created_at),
      'base_version_id', edit.base_version_id,
      'base_version_number', base_number
    ) end,
    'source_changed', edit.id is not null and edit.base_version_id is distinct from v.id
  );
end;
$$;
revoke all on function app.firm_rule_claim(uuid, uuid) from public, anon, authenticated, service_role;

-- Source review's "Live official claims" list for the caller's firm: search (key, wording, section
-- or program), newest captures first within the key order, a page of up to 100.
create function public.official_claims(p_query text default null, p_program text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.claims_reader_org();
  needle text := nullif(btrim(coalesce(p_query, '')), '');
  v_program text := nullif(lower(btrim(coalesce(p_program, ''))), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  matches uuid[];
begin
  if needle is not null and length(needle) > 120 then
    raise exception 'the search is too long' using errcode = '22023';
  end if;
  select coalesce(array_agg(d.id order by d.stable_key), '{}'::uuid[]) into matches
  from public.rule_definitions d
  join public.rule_versions v on v.id = app.official_live_version(d.id)
  left join lateral (select app.rule_claim_edit(v_org, d.id) as edit) firm on true
  where d.organization_id is null
    and d.source_category is not null
    and (v_program is null or d.program_key = v_program)
    and (
      needle is null
      or d.stable_key ilike '%' || needle || '%'
      or v.claim ilike '%' || needle || '%'
      or coalesce((firm.edit).claim_text, '') ilike '%' || needle || '%'
      or coalesce(d.program_key, '') ilike '%' || needle || '%'
      or exists (select 1 from public.rule_evidence e where e.rule_version_id = v.id and e.source_section ilike '%' || needle || '%')
    );
  return jsonb_build_object(
    'total', cardinality(matches),
    'rows', coalesce((
      select jsonb_agg(app.firm_rule_claim(v_org, page.id) order by page.n)
      from unnest(matches[v_offset + 1 : v_offset + v_limit]) with ordinality as page(id, n)
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.official_claims(text, text, integer, integer) from public, anon;
grant execute on function public.official_claims(text, text, integer, integer) to authenticated;

-- One live official claim as the caller's firm sees it.
create function public.official_claim(p_definition_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.firm_rule_claim(app.claims_reader_org(), p_definition_id);
$$;
revoke all on function public.official_claim(uuid) from public, anon;
grant execute on function public.official_claim(uuid) to authenticated;

-- History of a claim, oldest first: the captured text, every official re-capture (each with its
-- evidence) and every edit and revert the caller's firm made (who, which licence, when, why). A
-- firm-entered claim lists its own versions and approvals.
create function public.rule_claim_history(p_definition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.claims_reader_org();
  d public.rule_definitions%rowtype;
begin
  select * into d from public.rule_definitions where id = p_definition_id and (organization_id is null or organization_id = v_org);
  if d.id is null then
    raise exception 'claim not found' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(entry order by entry ->> 'at', entry ->> 'order')
    from (
      select jsonb_build_object(
        'order', '0',
        'kind', case when v.origin = 'official_capture' then case when v.supersedes_version_id is null then 'capture' else 'recapture' end else 'version' end,
        'at', coalesce(src.retrieved_at, v.created_at),
        'version_id', v.id,
        'version_number', v.version_number,
        'status', v.status,
        'claim', v.claim,
        'value', v.output_value ->> 'text',
        'source_url', link.source_url,
        'section', link.source_section,
        'excerpt', link.evidence_excerpt,
        'modified_on', link.modified_on,
        'last_amended_on', link.last_amended_on,
        'current_to', link.current_to,
        'sha256', src.content_hash,
        'retrieved_at', src.retrieved_at,
        'reviewer', review.reviewer,
        'reviewed_at', review.decided_at,
        'reason', v.status_reason
      ) as entry
      from public.rule_versions v
      left join lateral (select * from public.rule_evidence e where e.rule_version_id = v.id order by (e.snapshot_id is null), e.created_at limit 1) link on true
      left join lateral (select * from app.rule_version_source(v.id)) src on true
      left join lateral (
        select coalesce(nullif(btrim(profile.display_name), ''), 'a licensed member') as reviewer, r.decided_at
        from public.professional_reviews r
        left join public.memberships mem on mem.id = r.reviewer_membership_id
        left join public.profiles profile on profile.id = mem.user_id
        where r.rule_version_id = v.id and r.decision = 'approved' and r.organization_id = v_org
        order by r.decided_at desc limit 1
      ) review on true
      where v.definition_id = d.id
        and (v.organization_id is null or v.organization_id = v_org)
        and (v.origin = 'official_capture' or v.status not in ('draft'))
      union all
      select jsonb_build_object(
        'order', '1',
        'kind', o.action,
        'at', o.created_at,
        'version_id', o.base_version_id,
        'version_number', base.version_number,
        'claim', o.claim_text,
        'value', o.output_value ->> 'text',
        'reason', o.reason,
        'editor', o.editor_name,
        'licence_number', o.editor_licence_number,
        'edited_on', app.firm_local_date(v_org, o.created_at)
      )
      from public.rule_claim_overrides o
      join public.rule_versions base on base.id = o.base_version_id
      where o.organization_id = v_org and o.definition_id = d.id
    ) history
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.rule_claim_history(uuid) from public, anon;
grant execute on function public.rule_claim_history(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Edit or revert (firm-only, licensed, fresh step-up every time)
-- ---------------------------------------------------------------------------

create function app.edit_rule_claim(
  p_definition_id uuid,
  p_expected_base_version_id uuid,
  p_text text,
  p_value text,
  p_reason text,
  p_action text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization_id();
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  d public.rule_definitions%rowtype;
  live uuid;
  current_edit public.rule_claim_overrides;
  editor uuid;
  editor_display text;
  licence record;
  stamp timestamptz;
  new_id uuid;
begin
  if v_org is null then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  -- A firm owner or licensed consultant whose licence doesn't block, with a fresh step-up (the
  -- same checks review_rule_version uses).
  perform app.require_licensed_staff(v_org, true);
  if p_action is null or p_action not in ('edit', 'revert') then
    raise exception 'choose edit or revert' using errcode = '22023';
  end if;
  select * into d from public.rule_definitions where id = p_definition_id and organization_id is null for update;
  if d.id is null or d.source_category is null then
    raise exception 'only a live official claim can be edited' using errcode = '22023';
  end if;
  live := app.official_live_version(d.id);
  if live is null then
    raise exception 'only a live official claim can be edited' using errcode = '22023';
  end if;
  if p_expected_base_version_id is distinct from live then
    raise exception 'rule version conflict' using errcode = 'PT409';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'say why' using errcode = '22023';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'the reason is too long' using errcode = '22023';
  end if;
  current_edit := app.rule_claim_edit(v_org, d.id);
  if p_action = 'edit' then
    if v_text is null or length(v_text) not between 3 and 2000 then
      raise exception 'write the firm''s wording' using errcode = '22023';
    end if;
    if v_value is not null and length(v_value) > 200 then
      raise exception 'the value is too long' using errcode = '22023';
    end if;
  else
    if current_edit.id is null then
      raise exception 'nothing to revert: the firm shows the official text' using errcode = '22023';
    end if;
    v_text := null;
    v_value := null;
  end if;
  editor := app.gov_actor_membership(v_org);
  select c.id, c.college_id into licence
  from public.consultant_credentials c
  where c.membership_id = editor and c.organization_id = v_org
  limit 1;
  if licence.id is null then
    raise exception 'your licence isn''t recorded: add it in Settings before editing a claim' using errcode = '42501';
  end if;
  select left(coalesce(nullif(btrim(profile.display_name), ''), 'A licensed member'), 120) into editor_display
  from public.memberships mem
  left join public.profiles profile on profile.id = mem.user_id
  where mem.id = editor;
  stamp := app.use_rule_step_up(v_org, case when p_action = 'edit' then 'claim_edit' else 'claim_revert' end, d.id);

  perform set_config('app.rule_override_write', 'on', true);
  insert into public.rule_claim_overrides (
    organization_id, definition_id, base_version_id, action, claim_text, output_value, reason,
    editor_membership_id, editor_name, editor_licence_id, editor_licence_number, step_up_at, step_up_session_id
  ) values (
    v_org, d.id, live, p_action, v_text,
    case when v_value is null then null else jsonb_build_object('text', v_value) end,
    v_reason, editor, coalesce(editor_display, 'A licensed member'), licence.id, licence.college_id, stamp, app.current_session_id()
  )
  returning id into new_id;
  perform set_config('app.rule_override_write', '', true);

  perform app.record_audit_event(
    v_org, case when p_action = 'edit' then 'rule.claim_edited' else 'rule.claim_reverted' end,
    'public.rule_claim_overrides', new_id, 'success',
    jsonb_build_object('stable_key', d.stable_key, 'base_version_id', live, 'reason', left(v_reason, 500),
      'licence_number', licence.college_id, 'step_up_at', stamp)
  );
  return new_id;
end;
$$;
revoke all on function app.edit_rule_claim(uuid, uuid, text, text, text, text) from public, anon, authenticated, service_role;

create function public.edit_rule_claim(
  p_definition_id uuid, p_expected_base_version_id uuid, p_text text, p_value text, p_reason text, p_action text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select app.edit_rule_claim(p_definition_id, p_expected_base_version_id, p_text, p_value, p_reason, p_action);
$$;
revoke all on function public.edit_rule_claim(uuid, uuid, text, text, text, text) from public, anon, service_role;
grant execute on function public.edit_rule_claim(uuid, uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Unsuspend (decision 7: suspended claims stay suspended; a stamped, step-up unsuspend)
-- ---------------------------------------------------------------------------

create function app.unsuspend_rule_version(p_version_id uuid, p_expected_version integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rv public.rule_versions%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  actor uuid;
  stamp timestamptz;
  licence text;
  new_version integer;
begin
  select * into rv from public.rule_versions where id = p_version_id for update;
  if rv.id is null or rv.organization_id is null or rv.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'rule review denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(rv.organization_id, true);
  if rv.version is distinct from p_expected_version then
    raise exception 'rule version conflict' using errcode = 'PT409';
  end if;
  if rv.status is distinct from 'suspended' then
    raise exception 'only a suspended version can be unsuspended' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'say why' using errcode = '22023';
  end if;
  if rv.effective_to is not null and rv.effective_to <= statement_timestamp() then
    raise exception 'this version has expired: its end date has passed' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.rule_versions other
    where other.definition_id = rv.definition_id and other.id <> rv.id and other.status in ('published', 'review_due')
  ) then
    raise exception 'a newer version of this claim is live' using errcode = '22023';
  end if;
  actor := app.gov_actor_membership(rv.organization_id);
  select c.college_id into licence from public.consultant_credentials c where c.membership_id = actor and c.organization_id = rv.organization_id limit 1;
  stamp := app.use_rule_step_up(rv.organization_id, 'unsuspend', rv.id);
  perform app.gov_open_write(rv.id);
  update public.rule_versions
  set status = 'published', status_reason = left(v_reason, 500), status_changed_at = statement_timestamp(), status_changed_by_membership_id = actor
  where id = rv.id
  returning version into new_version;
  perform app.gov_close_write(rv.id);
  perform app.record_audit_event(
    rv.organization_id, 'rule.version_unsuspended', 'public.rule_versions', rv.id, 'success',
    jsonb_build_object('reason', left(v_reason, 500), 'licence_number', licence, 'step_up_at', stamp)
  );
  return new_version;
end;
$$;
revoke all on function app.unsuspend_rule_version(uuid, integer, text) from public, anon, authenticated, service_role;

create function public.unsuspend_rule_version(p_version_id uuid, p_expected_version integer, p_reason text)
returns integer
language sql
security definer
set search_path = ''
as $$ select app.unsuspend_rule_version(p_version_id, p_expected_version, p_reason); $$;
revoke all on function public.unsuspend_rule_version(uuid, integer, text) from public, anon, service_role;
grant execute on function public.unsuspend_rule_version(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Loading captured claims (scripts/ops/load-official-claims.mjs, maintenance session only)
-- ---------------------------------------------------------------------------

-- Loads one captured claim as a live official claim. Returns new | changed | unchanged |
-- suspended | "refused: <why>". With p_dry_run nothing is written. A claim is refused when its
-- text is the fee list's loading placeholder, its source is a homepage or not an official
-- Government of Canada page, it has no page hash or retrieval time, or a field is out of range.
create function app.load_official_claim(p_claim jsonb, p_dry_run boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := btrim(coalesce(p_claim ->> 'key', ''));
  v_category text := p_claim ->> 'category';
  v_program text := nullif(lower(btrim(coalesce(p_claim ->> 'program', ''))), '');
  v_jurisdiction text := upper(btrim(coalesce(p_claim ->> 'jurisdiction', 'CA')));
  v_claim text := btrim(coalesce(p_claim ->> 'claim', ''));
  v_value text := nullif(btrim(coalesce(p_claim ->> 'value', '')), '');
  v_url text := btrim(coalesce(p_claim ->> 'source_url', ''));
  v_section text := nullif(btrim(coalesce(p_claim ->> 'section', '')), '');
  v_excerpt text := nullif(btrim(coalesce(p_claim ->> 'excerpt', '')), '');
  v_form text := nullif(upper(btrim(coalesce(p_claim ->> 'form_number', ''))), '');
  page jsonb := coalesce(p_claim -> 'page', '{}'::jsonb);
  v_hash text := lower(btrim(coalesce(page ->> 'sha256', '')));
  v_page_url text;
  v_final text;
  v_at timestamptz;
  v_http integer;
  v_modified date;
  v_amended date;
  v_current date;
  v_title text;
  v_publisher text;
  v_host text;
  anchor text;
  d public.rule_definitions%rowtype;
  latest public.rule_versions%rowtype;
  latest_hash text;
  src uuid;
  snap uuid;
  snap_at timestamptz;
  new_id uuid;
  next_number integer;
begin
  if app.db_maintenance_session() is distinct from true then
    raise exception 'official claims are loaded only in a database maintenance session' using errcode = '42501';
  end if;
  if v_key !~ '^[A-Z][A-Z0-9]*(\.[A-Z0-9][A-Z0-9_]*)+$' or length(v_key) > 120 then
    return 'refused: unknown claim key';
  end if;
  if v_category is null or v_category not in ('fee', 'form', 'checklist', 'program', 'guide', 'law') then
    return 'refused: unknown category';
  end if;
  if v_program is not null and v_program !~ '^[a-z0-9_]{1,80}$' then
    return 'refused: unknown program';
  end if;
  if v_jurisdiction !~ '^[A-Z]{2}(-[A-Z0-9]{1,6})?$' then
    return 'refused: unknown jurisdiction';
  end if;
  if concat_ws(' ', v_claim, v_value, v_excerpt) ~* 'error loading fee' then
    return 'refused: the page''s fee placeholder ("Error loading fee") is not a claim';
  end if;
  if length(v_claim) not between 3 and 2000 then
    return 'refused: the claim text is empty or too long';
  end if;
  if length(coalesce(v_value, '')) > 200 or length(coalesce(v_excerpt, '')) > 600 or length(coalesce(v_section, '')) > 300 then
    return 'refused: a field is too long';
  end if;
  v_host := app.official_claim_url(v_url);
  if v_host is null then
    if app.federal_official_url(v_url) is null then
      return 'refused: not an official Government of Canada page';
    end if;
    return 'refused: a homepage is not evidence';
  end if;
  anchor := nullif(split_part(v_url, '#', 2), '');
  if anchor is null and v_section is null then
    return 'refused: no section or anchor';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then
    return 'refused: no SHA-256 of the page';
  end if;
  begin
    v_at := (page ->> 'retrieved_at')::timestamptz;
    v_modified := nullif(page ->> 'modified_on', '')::date;
    v_amended := nullif(page ->> 'last_amended_on', '')::date;
    v_current := nullif(page ->> 'current_to', '')::date;
    v_http := nullif(page ->> 'http_status', '')::integer;
  exception when others then
    return 'refused: a page date is not a date';
  end;
  if v_at is null or v_at > statement_timestamp() + interval '5 minutes' then
    return 'refused: no retrieval time, or one in the future';
  end if;
  -- A date the page prints can't be later than the day it was retrieved (a day's slack across timezones).
  if v_modified > (v_at at time zone 'America/Toronto')::date + 1 or v_amended > (v_at at time zone 'America/Toronto')::date + 1
     or v_current > (v_at at time zone 'America/Toronto')::date + 1 then
    return 'refused: a date the page states is in the future';
  end if;
  if v_http is not null and v_http not between 100 and 599 then
    v_http := null;
  end if;
  v_page_url := split_part(btrim(coalesce(page ->> 'url', v_url)), '#', 1);
  v_final := split_part(btrim(coalesce(page ->> 'final_url', v_page_url)), '#', 1);
  if app.federal_official_url(v_page_url) is null or app.federal_official_url(v_final) is null then
    return 'refused: not an official Government of Canada page';
  end if;
  if v_form is not null and v_form !~ '^[A-Z0-9][A-Z0-9 .()/-]{0,39}$' then
    v_form := null;
  end if;
  v_title := nullif(left(btrim(coalesce(page ->> 'title', '')), 300), '');

  select * into d from public.rule_definitions where organization_id is null and stable_key = v_key for update;
  if d.id is not null and d.source_category is null then
    return 'refused: a platform rule with this key isn''t an official capture';
  end if;
  if d.id is not null then
    select * into latest from public.rule_versions
    where definition_id = d.id and origin = 'official_capture'
    order by version_number desc limit 1;
    -- Decision 7: a suspended claim stays suspended; nothing is loaded over it.
    if latest.status = 'suspended' then
      return 'suspended';
    end if;
    select snapshot.content_hash, snapshot.id, snapshot.source_id into latest_hash, snap, src
    from public.rule_evidence link
    join public.source_snapshots snapshot on snapshot.id = link.snapshot_id
    where link.rule_version_id = latest.id
    order by snapshot.retrieved_at desc limit 1;
    if latest.id is not null and latest.status in ('published', 'review_due')
       and latest.claim = v_claim
       and (latest.output_value ->> 'text') is not distinct from v_value
       and latest_hash = v_hash then
      -- Unchanged: record one successful check of the page (RULES §7) and nothing else.
      if not p_dry_run then
        select snapshot.retrieved_at into snap_at from public.source_snapshots snapshot where snapshot.id = snap;
        if v_at > snap_at and not exists (
          select 1 from public.source_check_attempts attempt where attempt.source_id = src and attempt.attempted_at = v_at
        ) then
          insert into public.source_check_attempts (organization_id, source_id, attempted_at, result, http_status, snapshot_id)
          values (null, src, v_at, 'unchanged', v_http, snap);
        end if;
      end if;
      return 'unchanged';
    end if;
  end if;
  if p_dry_run then
    return case when latest.id is null then 'new' else 'changed' end;
  end if;

  -- The page (platform source) and its capture.
  select domain.authority into v_publisher
  from public.official_source_domains domain
  where domain.active and (v_host = domain.host or right(v_host, length(domain.host) + 1) = '.' || domain.host)
  order by length(domain.host) desc
  limit 1;
  v_publisher := left(coalesce(nullif(btrim(page ->> 'publisher'), ''), v_publisher, 'Government of Canada'), 200);
  select source.id into src from public.official_sources source where source.organization_id is null and source.canonical_url = v_page_url;
  if src is null then
    insert into public.official_sources (organization_id, publisher, canonical_url, allowed_host, jurisdiction, content_kind, discovery_status, title, source_language)
    values (
      null, v_publisher, v_page_url, app.official_url_host(v_page_url), 'CA',
      case v_category
        when 'fee' then 'fee_schedule'::public.source_content_kind
        when 'law' then case when v_page_url like '%/regulations/%' then 'regulation'::public.source_content_kind else 'legislation'::public.source_content_kind end
        when 'form' then 'form_instruction'::public.source_content_kind
        when 'checklist' then 'checklist'::public.source_content_kind
        else 'program_guidance'::public.source_content_kind
      end,
      'active', v_title, 'en'
    )
    returning id into src;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.source_snapshots:' || src::text, 0));
  snap := null;
  select snapshot.id, snapshot.retrieved_at into snap, snap_at
  from public.source_snapshots snapshot
  where snapshot.source_id = src and snapshot.content_hash = v_hash
  order by snapshot.snapshot_number desc
  limit 1;
  if snap is null then
    insert into public.source_snapshots (
      organization_id, source_id, snapshot_number, final_url, publisher, retrieved_at, modified_on, current_to,
      content_hash, retrieval_result, http_status, review_status
    ) values (
      null, src, 1, v_final, v_publisher, v_at, coalesce(v_modified, v_amended), v_current,
      v_hash, 'success', v_http, 'evidence_captured'
    )
    returning id into snap;
  elsif v_at > snap_at and not exists (
    select 1 from public.source_check_attempts attempt where attempt.source_id = src and attempt.attempted_at = v_at
  ) then
    insert into public.source_check_attempts (organization_id, source_id, attempted_at, result, http_status, snapshot_id)
    values (null, src, v_at, 'unchanged', v_http, snap);
  end if;

  -- The claim and its new version, live once its evidence is in.
  if d.id is null then
    insert into public.rule_definitions (organization_id, stable_key, category, jurisdiction, program_key, source_category)
    values (null, v_key, 'immigration_requirement', v_jurisdiction, v_program, v_category)
    returning * into d;
  end if;
  select coalesce(max(v.version_number), 0) + 1 into next_number from public.rule_versions v where v.definition_id = d.id;
  insert into public.rule_versions (definition_id, version_number, claim, output_value, status, origin, supersedes_version_id)
  values (
    d.id, next_number, v_claim,
    case when v_value is null then null else jsonb_build_object('text', v_value) end,
    'evidence_captured', 'official_capture', latest.id
  )
  returning id into new_id;
  insert into public.rule_evidence (
    rule_version_id, snapshot_id, source_section, evidence_excerpt, locator, source_language, source_url,
    form_number, modified_on, last_amended_on, current_to, checked_on
  ) values (
    new_id, snap, left(coalesce(v_section, '#' || anchor), 300), v_excerpt,
    case when anchor is null then null else left('#' || anchor, 300) end, 'en', v_url,
    v_form, v_modified, v_amended, v_current, (v_at at time zone 'America/Toronto')::date
  );
  update public.rule_versions
  set status = 'published', status_changed_at = statement_timestamp()
  where id = new_id;
  if latest.id is not null and latest.status in ('published', 'review_due') then
    update public.rule_versions
    set status = 'superseded', status_changed_at = statement_timestamp()
    where id = latest.id;
  end if;
  return case when latest.id is null then 'new' else 'changed' end;
end;
$$;
revoke all on function app.load_official_claim(jsonb, boolean) from public, anon, authenticated, service_role;

-- A batch for the loader: each claim's result ({key, result}); a claim that fails is refused with
-- the database's reason and the others still load.
create function app.load_official_claims(p_claims jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  outcome text;
  results jsonb := '[]'::jsonb;
begin
  if app.db_maintenance_session() is distinct from true then
    raise exception 'official claims are loaded only in a database maintenance session' using errcode = '42501';
  end if;
  if p_claims is null or jsonb_typeof(p_claims) <> 'array' or jsonb_array_length(p_claims) > 500 then
    raise exception 'give up to 500 claims' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_claims)
  loop
    begin
      outcome := app.load_official_claim(item, coalesce(p_dry_run, true));
    exception when others then
      outcome := 'refused: ' || left(sqlerrm, 200);
    end;
    results := results || jsonb_build_array(jsonb_build_object('key', item ->> 'key', 'result', outcome));
  end loop;
  return results;
end;
$$;
revoke all on function app.load_official_claims(jsonb, boolean) from public, anon, authenticated, service_role;

-- A pack item is live while its rule version is, or, for an official claim, while the claim has a
-- live official version (a re-capture supersedes the version the pack named).
create function app.rule_item_is_live(p_version uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.rule_version_is_live(p_version)
    or exists (
      select 1 from public.rule_versions v
      where v.id = p_version
        and v.origin = 'official_capture'
        and app.official_live_version(v.definition_id) is not null
    );
$$;
revoke all on function app.rule_item_is_live(uuid) from public, anon;
grant execute on function app.rule_item_is_live(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Redefined: app.prepare_rule_definition (from 20261017113157_source_governance.sql)
-- Live claims: source_category is part of a claim's identity.
-- ---------------------------------------------------------------------------
create or replace function app.prepare_rule_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.has_published_version := false;
    return new;
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.stable_key is distinct from old.stable_key
     or new.category is distinct from old.category
     or new.jurisdiction is distinct from old.jurisdiction
     or new.program_key is distinct from old.program_key
     -- Live claims: an official claim's category never changes.
     or new.source_category is distinct from old.source_category then
    raise exception 'rule definition identity columns are immutable' using errcode = '42501';
  end if;
  if old.has_published_version and new.required_facts is distinct from old.required_facts then
    raise exception 'required facts are frozen once a version is published' using errcode = '42501';
  end if;
  if new.has_published_version is distinct from old.has_published_version
     and coalesce(current_setting('app.rule_visibility_write', true), '') is distinct from 'on' then
    raise exception 'has_published_version is maintained from rule version status' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.prepare_rule_definition() from public;

-- ---------------------------------------------------------------------------
-- Redefined: app.guard_rule_version (from 20261025400000_src_claims_review.sql)
-- Live claims: an official capture is created and published only in a database maintenance
-- session (the loader), with no review; its origin never changes. Firm entries are unchanged.
-- ---------------------------------------------------------------------------
create or replace function app.guard_rule_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  blockers text[];
  content_changed boolean := false;
begin
  if tg_op = 'INSERT' then
    new.content_frozen := false;
    new.content_revision := 1;
    if new.status in ('approved', 'published', 'review_due', 'suspended', 'superseded') then
      raise exception 'publication blocked: status_requires_prior_review' using errcode = '23514';
    end if;
    -- Live claims: only the loader, in a maintenance session, creates an official capture.
    if new.origin = 'official_capture' and app.db_maintenance_session() is distinct from true then
      raise exception 'official claims are loaded only in a database maintenance session' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Live claims: where a version came from never changes.
  if new.origin is distinct from old.origin then
    raise exception 'a rule version''s origin is immutable' using errcode = '42501';
  end if;

  content_changed :=
    new.claim is distinct from old.claim
    or new.structured_condition is distinct from old.structured_condition
    or new.output_value is distinct from old.output_value
    or new.exceptions is distinct from old.exceptions
    or new.applicability is distinct from old.applicability
    or new.applicability_note is distinct from old.applicability_note
    or new.applicability_established is distinct from old.applicability_established
    or new.effective_from is distinct from old.effective_from
    or new.effective_to is distinct from old.effective_to
    or new.test_case_ids is distinct from old.test_case_ids
    or new.supersedes_version_id is distinct from old.supersedes_version_id
    or new.definition_id is distinct from old.definition_id;

  if old.content_frozen and content_changed then
    raise exception 'published rule content is immutable' using errcode = '42501';
  end if;
  if old.content_frozen and new.content_frozen is distinct from true then
    raise exception 'published rule content stays frozen' using errcode = '42501';
  end if;
  if old.status in ('rejected', 'superseded') and new.status is distinct from old.status then
    raise exception 'rule status % is terminal', old.status using errcode = '42501';
  end if;
  if old.content_frozen
     and new.status in ('draft', 'evidence_captured', 'professional_review', 'approved', 'rejected') then
    raise exception 'published rule version cannot move to %', new.status using errcode = '42501';
  end if;
  -- Live claims: an official capture's status changes only in a maintenance session (the loader).
  if old.origin = 'official_capture' and new.status is distinct from old.status
     and app.db_maintenance_session() is distinct from true then
    raise exception 'official claims change only when the loader runs' using errcode = '42501';
  end if;

  if content_changed then
    new.content_revision := old.content_revision + 1;
  end if;

  if new.status in ('approved', 'published') and old.status is distinct from new.status then
    if content_changed then
      raise exception 'publication blocked: content_changed_during_publish' using errcode = '23514';
    end if;
    blockers := app.rule_publication_blockers(old.id, old.content_revision);
    if blockers is not null and cardinality(blockers) > 0 then
      raise exception 'publication blocked: %', array_to_string(blockers, ', ') using errcode = '23514';
    end if;
    -- SRC-03: only the review workbench (licensed reviewer with step-up) publishes a firm entry.
    -- Live claims: an official capture goes live when the loader loads it (maintenance session).
    if old.origin = 'official_capture' then
      if app.db_maintenance_session() is distinct from true then
        raise exception 'publication blocked: official claims go live only when the loader runs' using errcode = '42501';
      end if;
    elsif app.rule_review_gate_open(old.id) is distinct from true then
      raise exception 'publication blocked: approval_required (a licensed reviewer approves it in Source review, with a step-up)'
        using errcode = '42501';
    end if;
  end if;

  if new.status = 'published' then
    new.content_frozen := true;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_rule_version() from public;

-- ---------------------------------------------------------------------------
-- Redefined: app.rule_publication_blockers (from 20261025400000_src_claims_review.sql)
-- Live claims: an official capture needs its captured page (hash, retrieval time, section) and its
-- claim; no reviewer, next review date or applicability resolution (decision 2026-10-25).
-- ---------------------------------------------------------------------------
create or replace function app.rule_publication_blockers(p_id uuid, p_content_revision integer)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rv public.rule_versions%rowtype;
  blockers text[] := array[]::text[];
  evidence_count integer;
  usable integer;
  copied integer;
begin
  select * into rv from public.rule_versions where id = p_id;
  if not found then
    return array['missing_rule_version']::text[];
  end if;
  if rv.claim is null or length(btrim(rv.claim)) = 0 then
    blockers := array_append(blockers, 'missing_claim');
  end if;

  -- Live claims: an official capture rests on its captured page alone.
  if rv.origin = 'official_capture' then
    if not exists (
      select 1
      from public.rule_evidence e
      join public.source_snapshots s on s.id = e.snapshot_id
      join public.official_sources src on src.id = s.source_id
      where e.rule_version_id = p_id
        and e.source_section is not null
        and length(btrim(e.source_section)) > 0
        and s.content_hash ~ '^[0-9a-f]{64}$'
        and s.retrieved_at is not null
        and src.organization_id is null
        and app.official_claim_url(e.source_url) is not null
        and app.host_is_allowlisted(app.official_url_host(s.final_url))
    ) then
      blockers := array_append(blockers, 'missing_captured_page');
    end if;
    return blockers;
  end if;

  if rv.next_review_at is null then
    blockers := array_append(blockers, 'missing_next_review_at');
  end if;
  -- SRC-01: only an executable rule needs test cases.
  if rv.structured_condition is not null and coalesce(cardinality(rv.test_case_ids), 0) = 0 then
    blockers := array_append(blockers, 'missing_test_cases');
  end if;
  if rv.effective_from is null and rv.applicability_established is not true then
    blockers := array_append(blockers, 'missing_effective_applicability');
  end if;
  if rv.applicability_established is true
     and (rv.applicability_note is null or length(btrim(rv.applicability_note)) = 0) then
    blockers := array_append(blockers, 'missing_applicability_note');
  end if;

  select count(*) into evidence_count
  from public.rule_evidence e
  where e.rule_version_id = p_id;
  if evidence_count = 0 then
    blockers := array_append(blockers, 'missing_evidence');
  else
    select count(*) into usable
    from public.rule_evidence e
    left join public.source_snapshots s on s.id = e.snapshot_id
    left join public.official_sources src on src.id = s.source_id
    where e.rule_version_id = p_id
      and e.source_section is not null
      and length(btrim(e.source_section)) > 0
      and (
        (
          s.id is not null
          and s.content_hash ~ '^[0-9a-f]{64}$'
          and s.retrieved_at is not null
          and length(btrim(s.publisher)) > 0
          and length(btrim(src.publisher)) > 0
          and app.host_is_allowlisted(app.official_url_host(s.final_url))
        )
        -- SRC-01: no capture, but the approving reviewer attested the official page.
        or (
          e.snapshot_id is null
          and e.page_attested_on is not null
          and app.official_claim_url(e.source_url) is not null
        )
      );
    if usable = 0 then
      blockers := array_append(blockers, 'missing_source_section');
    end if;
    select count(*) into copied
    from public.rule_evidence e
    join public.source_snapshots s on s.id = e.snapshot_id
    where e.rule_version_id = p_id
      and rv.effective_from is not null
      and rv.effective_from = s.retrieved_at
      and s.published_at is null
      and s.published_on is null
      and s.current_to is null
      and rv.applicability_established is not true;
    if copied > 0 then
      blockers := array_append(blockers, 'effective_from_copies_retrieved_at');
    end if;
  end if;

  if not exists (
    select 1
    from public.professional_reviews r
    where r.rule_version_id = p_id
      and r.decision = 'approved'
      and r.decided_at is not null
      and r.rule_content_revision = p_content_revision
      and (rv.organization_id is null or r.organization_id = rv.organization_id)
  ) then
    blockers := array_append(blockers, 'missing_reviewer');
  end if;

  return blockers;
end;
$$;
revoke all on function app.rule_publication_blockers(uuid, integer) from public;

-- ---------------------------------------------------------------------------
-- Redefined: app.apply_source_check_attempt (from 20261017113157_source_governance.sql)
-- Live claims: an unchanged re-capture the loader records (maintenance session) is a successful
-- check at the time it was made, so "last checked" moves to it. Elsewhere, as before: a check
-- moves "last checked" only to its capture's retrieval time; a failure never moves it.
-- ---------------------------------------------------------------------------
create or replace function app.apply_source_check_attempt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.source_state_write', 'on', true);
  update public.official_sources src
  set last_attempt_at = new.attempted_at,
      last_attempt_result = new.result,
      last_attempt_error = case
        when new.result in ('failed', 'blocked') then left(coalesce(new.error_code, 'failed'), 80)
        else null
      end,
      last_checked_at = case
        -- Live claims: the loader's unchanged re-capture.
        when new.result = 'unchanged' and app.db_maintenance_session() then
          greatest(src.last_checked_at, new.attempted_at)
        when new.result in ('success', 'unchanged', 'changed') then (
          select case
            when src.last_checked_at is null or snap.retrieved_at > src.last_checked_at then snap.retrieved_at
            else src.last_checked_at
          end
          from public.source_snapshots snap
          where snap.id = new.snapshot_id
        )
        else src.last_checked_at
      end,
      change_state = case
        when new.result = 'changed' then 'change_detected'::public.source_change_state
        else src.change_state
      end
  where src.id = new.source_id;
  perform set_config('app.source_state_write', '', true);
  return null;
end;
$$;
revoke all on function app.apply_source_check_attempt() from public;

-- ---------------------------------------------------------------------------
-- Redefined: app.rule_pack_is_live (from 20261025410100_src_pins_live_rule.sql)
-- Live claims: an item that is an official claim counts while the claim has a live official
-- version (app.rule_item_is_live); a firm claim still needs its own version live.
-- ---------------------------------------------------------------------------
create or replace function app.rule_pack_is_live(p_pack uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.rule_pack_versions pack
      where pack.id = p_pack
        and pack.status = 'published'
    )
    and exists (select 1 from public.rule_pack_items i where i.pack_id = p_pack)
    and not exists (
      select 1
      from public.rule_pack_items i
      where i.pack_id = p_pack
        -- Live claims: an official claim follows its live official version.
        and app.rule_item_is_live(i.rule_version_id) is distinct from true
    );
$$;
revoke all on function app.rule_pack_is_live(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Redefined: app.src_rule_from_pinned_pack (from 20261025410000_src_pins_scope.sql)
-- Live claims (checklists, INT-02 intake packs): a checklist item or deadline may also come from a
-- live official claim for the matter's program (or one for every program).
-- ---------------------------------------------------------------------------
create or replace function app.src_rule_from_pinned_pack()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rule_version_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.rule_version_id is not distinct from old.rule_version_id then
    return new;
  end if;
  -- Live claims: a live official claim of the matter's program.
  if exists (
    select 1
    from public.rule_versions v
    join public.rule_definitions d on d.id = v.definition_id
    where v.id = new.rule_version_id
      and v.origin = 'official_capture'
      and app.rule_version_is_live(v.id)
      and (d.program_key is null or d.program_key = app.matter_program_key(new.matter_id))
  ) then
    return new;
  end if;
  if not exists (
    select 1
    from public.matter_rule_bindings b
    join public.rule_pack_items i on i.pack_id = b.rule_pack_version_id
    where b.matter_id = new.matter_id
      and b.superseded_at is null
      and i.rule_version_id = new.rule_version_id
  ) then
    raise exception 'rules and checklist items come only from the rule pack pinned on this matter'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.src_rule_from_pinned_pack() from public, anon;

-- The live official claims for a matter's program, as the firm sees them (its edits applied, each
-- with its source link and edition): what checklists and intake packs (INT-02) read. Staff of the
-- matter's firm. Empty when the matter has no program.
create function public.matter_official_claims(p_matter_id uuid, p_category text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.claims_reader_org();
  v_program text;
begin
  if not exists (select 1 from public.matters m where m.id = p_matter_id and m.organization_id = v_org) then
    raise exception 'matter not found' using errcode = '42501';
  end if;
  v_program := app.matter_program_key(p_matter_id);
  return coalesce((
    select jsonb_agg(app.firm_rule_claim(v_org, d.id) order by d.source_category, d.stable_key)
    from public.rule_definitions d
    where d.organization_id is null
      and d.source_category is not null
      and (p_category is null or d.source_category = p_category)
      and v_program is not null
      and d.program_key = v_program
      and app.official_live_version(d.id) is not null
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.matter_official_claims(uuid, text) from public, anon;
grant execute on function public.matter_official_claims(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Redefined: app.support_catalogue (from 20261025410100_src_pins_live_rule.sql)
-- Live claims: a program is supported once it has live official claims for its forms or
-- checklists (or a live pack, as before); each program says how many, whether any source is
-- overdue for a re-check (stale), its oldest last check, and, for a firm's staff, the firm's edits.
-- ---------------------------------------------------------------------------
create or replace function app.support_catalogue(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_programs jsonb;
  v_jurisdictions jsonb;
  v_case_types jsonb;
  v_firm text[];
begin
  if p_org is not null
     and (select auth.uid()) is not null
     and p_org = app.current_organization_id()
     and app.is_org_staff(p_org)
     and app.staff_mfa_satisfied() then
    v_org := p_org;
    select org.jurisdiction_codes into v_firm from public.organizations org where org.id = v_org;
  end if;

  with catalogued as (
    select e.scope_key as program_key, e.label, e.jurisdiction, e.case_type_key, e.official_name, e.snapshot_id,
      e.source_section, e.position, true as catalogued
    from public.support_catalogue_entries e
    where e.scope_kind = 'program' and e.active
  ),
  pack_only as (
    select distinct on (pack.program_key)
      pack.program_key, null::text as label, pack.jurisdiction, null::text as case_type_key, null::text as official_name,
      null::uuid as snapshot_id, null::text as source_section, 1000 as position, false as catalogued
    from public.rule_pack_versions pack
    where app.rule_pack_is_live(pack.id)
      and (pack.organization_id is null or pack.organization_id = v_org)
      and not exists (
        select 1 from public.support_catalogue_entries e where e.scope_kind = 'program' and e.scope_key = pack.program_key
      )
    order by pack.program_key, pack.pack_version desc
  ),
  -- Live claims: a program with live official claims for its forms or checklists is listed too.
  claims_only as (
    select distinct on (d.program_key)
      d.program_key, null::text as label, d.jurisdiction, null::text as case_type_key, null::text as official_name,
      null::uuid as snapshot_id, null::text as source_section, 1000 as position, false as catalogued
    from public.rule_definitions d
    where d.organization_id is null
      and d.source_category in ('form', 'checklist')
      and d.program_key is not null
      and app.official_live_version(d.id) is not null
      and not exists (
        select 1 from public.support_catalogue_entries e where e.scope_kind = 'program' and e.scope_key = d.program_key
      )
      and not exists (select 1 from pack_only po where po.program_key = d.program_key)
    order by d.program_key
  ),
  programs as (
    select c.*, app.current_program_pack(v_org, c.program_key) as pack_id
    from (select * from catalogued union all select * from pack_only union all select * from claims_only) c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', p.program_key,
      'label', p.label,
      'jurisdiction', p.jurisdiction,
      'case_type', p.case_type_key,
      'catalogued', p.catalogued,
      -- Live claims: a program counts once it has live official claims for its forms or checklists.
      'supported', p.pack_id is not null or coalesce(claims.live_claims, 0) > 0,
      'official_claims', coalesce(claims.live_claims, 0),
      'stale', coalesce(claims.stale, false),
      'last_checked_at', claims.oldest_check,
      'firm_edits', coalesce(edits.rows, '[]'::jsonb),
      'pack_version', pack.pack_version,
      'pack_scope', case when pack.id is null then null when pack.organization_id is null then 'platform' else 'firm' end,
      'official', case when snap.id is null then null else jsonb_build_object(
        'name', p.official_name,
        'url', snap.final_url,
        'section', p.source_section,
        'retrieved_at', snap.retrieved_at,
        'modified_on', snap.modified_on,
        'content_hash', snap.content_hash,
        'reviewed', snap.review_status = 'verified'
      ) end
    ) order by p.position, p.program_key), '[]'::jsonb)
  into v_programs
  from programs p
  left join public.rule_pack_versions pack on pack.id = p.pack_id
  left join public.source_snapshots snap on snap.id = p.snapshot_id
  -- Live claims: the program's live official form and checklist claims, whether any source is
  -- overdue for a re-check, and the oldest last successful check among them.
  left join lateral (
    select count(*) as live_claims,
           bool_or(app.official_claim_stale(live.id)) as stale,
           min(live_src.last_checked_at) as oldest_check
    from public.rule_definitions d
    cross join lateral (select app.official_live_version(d.id) as id) live
    left join lateral app.rule_version_source(live.id) live_src on true
    where d.organization_id is null
      and d.source_category in ('form', 'checklist')
      and d.program_key = p.program_key
      and live.id is not null
  ) claims on true
  -- Live claims (staff only): the firm's edits of those claims, each with its stamp.
  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'key', d.stable_key,
             'edited_by', (firm.row_edit).editor_name,
             'edited_licence', (firm.row_edit).editor_licence_number,
             'edited_on', app.firm_local_date(v_org, (firm.row_edit).created_at)
           ) order by d.stable_key) as rows
    from public.rule_definitions d
    cross join lateral (select app.rule_claim_edit(v_org, d.id) as row_edit) firm
    where v_org is not null
      and d.organization_id is null
      and d.source_category in ('form', 'checklist')
      and d.program_key = p.program_key
      and (firm.row_edit).id is not null
  ) edits on true;

  select coalesce(jsonb_agg(jsonb_build_object(
      'key', e.scope_key,
      'label', e.label,
      'note', e.note,
      'supported', exists (
        select 1 from jsonb_array_elements(v_programs) prog
        where (prog ->> 'supported')::boolean and prog ->> 'jurisdiction' = e.scope_key
      ),
      'firm_practises', v_firm is not null and e.scope_key = any(v_firm)
    ) order by e.position, e.scope_key), '[]'::jsonb)
  into v_jurisdictions
  from public.support_catalogue_entries e
  where e.scope_kind = 'jurisdiction' and e.active;

  select coalesce(jsonb_agg(jsonb_build_object(
      'key', e.scope_key,
      'label', e.label,
      'note', e.note,
      'supported', exists (
        select 1 from jsonb_array_elements(v_programs) prog
        where (prog ->> 'supported')::boolean and prog ->> 'case_type' = e.scope_key
      )
    ) order by e.position, e.scope_key), '[]'::jsonb)
  into v_case_types
  from public.support_catalogue_entries e
  where e.scope_kind = 'case_type' and e.active;

  return jsonb_build_object(
    'programs', v_programs,
    'jurisdictions', v_jurisdictions,
    'case_types', v_case_types,
    'firm_jurisdictions', case when v_org is null then null else to_jsonb(coalesce(v_firm, '{}'::text[])) end
  );
end;
$$;
revoke all on function app.support_catalogue(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Redefined: app.vo_official_attestation (from 20261025450000_vo_attested_citations.sql)
-- Live claims: also returns the firm's edit stamp of an official claim ({edited, edited_by,
-- edited_licence, edited_on}), so every place Vo cites it (Ask Vo, drafts, letters) carries it.
-- ---------------------------------------------------------------------------
create or replace function app.vo_official_attestation(p_org uuid, p_kind text, p_id uuid, p_sha256 text, p_attested_on date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  attester uuid;
  reviewer_name text;
  edit jsonb;
begin
  -- Live claims: a firm's licensed edit of an official claim is cited with its stamp.
  if p_kind = 'rule_version' then
    edit := app.rule_version_firm_edit(p_org, p_id);
    if edit is not null then
      edit := jsonb_build_object('attested', false) || (edit - 'source_changed');
    end if;
  end if;
  if p_sha256 is not null or p_attested_on is null or p_id is null then
    return edit;
  end if;
  if p_kind = 'rule_version' then
    select link.page_attested_by_membership_id into attester
    from public.rule_evidence link
    where link.rule_version_id = p_id
      and link.organization_id = p_org
      and link.snapshot_id is null
      and link.page_attested_on = p_attested_on
    order by link.page_attested_at desc
    limit 1;
  elsif p_kind = 'submission_requirement' then
    select req.page_attested_by_membership_id into attester
    from public.submission_requirements req
    where req.id = p_id and req.organization_id = p_org and req.page_attested_on = p_attested_on;
  elsif p_kind = 'renewal_timing' then
    select timing.page_attested_by_membership_id into attester
    from public.renewal_timings timing
    where timing.id = p_id and timing.organization_id = p_org and timing.page_attested_on = p_attested_on;
  elsif p_kind = 'follow_up_step' then
    select step.page_attested_by_membership_id into attester
    from public.approval_follow_up_steps step
    where step.id = p_id and step.organization_id = p_org and step.page_attested_on = p_attested_on;
  end if;
  if attester is null then
    return edit;
  end if;
  select nullif(btrim(profile.display_name), '') into reviewer_name
  from public.memberships mem
  join public.profiles profile on profile.id = mem.user_id
  where mem.id = attester and mem.organization_id = p_org;
  return coalesce(edit - 'attested', '{}'::jsonb) || jsonb_build_object(
    'attested', true,
    'attested_by', left(coalesce(reviewer_name, 'a licensed member'), 120),
    'attested_on', p_attested_on
  );
end;
$$;
revoke all on function app.vo_official_attestation(uuid, text, uuid, text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Redefined: app.vo_letter_official_items (from 20261025450000_vo_attested_citations.sql)
-- Live claims: official claims are read with the firm's edit (its wording); a CA.FEES.* claim
-- reaches Vo whatever pack the matter has, labelled with its program; an overdue fee or advice-like
-- official claim is left out (the stale block).
-- ---------------------------------------------------------------------------
create or replace function app.vo_letter_official_items(p_org uuid, p_matter_id uuid)
returns table (
  kind text,
  id uuid,
  label text,
  content text,
  source_url text,
  source_section text,
  form_number text,
  form_modified_on date,
  checked_on date,
  current_to date,
  snapshot_sha256 text,
  attested_on date,
  reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select items.*
  from (
    with program as (select app.matter_program_key(p_matter_id) as key)
    select 'fee', fee.id, left(fee.name, 300),
           left(fee.name || ': CAD ' || to_char(fee.amount_cents / 100.0, 'FM999999990.00'), 600),
           fee.source_url, fee.section, null::text, null::date,
           app.firm_local_date(p_org, fee.retrieved_at), null::date, fee.snapshot_sha256, null::date, fee.reviewed_at
    from public.government_fee_references fee
    where fee.organization_id = p_org and fee.status = 'approved'
    union all
    select 'submission_requirement', req.id,
           case when req.kind = 'channel_name' then 'IRCC channel name' else 'Step outside Casevoya' end,
           left(req.label, 600),
           req.source_url, req.source_section, req.form_number, req.form_modified_on,
           req.checked_on, req.current_to, req.snapshot_sha256, req.page_attested_on, req.reviewed_at
    from public.submission_requirements req, program
    where req.organization_id = p_org and req.status = 'approved'
      and (req.program_key is null or req.program_key = program.key)
    union all
    select 'renewal_timing', timing.id, left(timing.applies_to, 300),
           left(timing.applies_to || ': ' || timing.timing_text, 600),
           timing.source_url, timing.source_section, timing.form_number, timing.form_modified_on,
           timing.checked_on, timing.current_to, timing.snapshot_sha256, timing.page_attested_on, timing.reviewed_at
    from public.renewal_timings timing, program
    where timing.organization_id = p_org and timing.status = 'approved'
      and (timing.program_key is null or timing.program_key = program.key)
    union all
    select 'follow_up_step', step.id, left(step.label, 300),
           left(step.label || coalesce(': ' || step.timing_text, ''), 600),
           step.source_url, step.source_section, step.form_number, step.form_modified_on,
           step.checked_on, step.current_to, step.snapshot_sha256, step.page_attested_on, step.reviewed_at
    from public.approval_follow_up_steps step, program
    where step.organization_id = p_org and step.status = 'approved' and step.retired_at is null
      and step.program_key = program.key
    union all
    -- Live claims: a fee claim says which program it is for; the firm's wording when a licensed
    -- member edited the claim (cited with its stamp, app.vo_official_attestation).
    select 'rule_version', rule.id,
           left(definition.stable_key || case when definition.stable_key like 'CA.FEES.%' and definition.program_key is not null then ' (' || definition.program_key || ')' else '' end, 300),
           left(coalesce((firm.row_edit).claim_text, rule.claim)
             || case when (firm.row_edit).id is not null and (firm.row_edit).output_value ->> 'text' is not null
                       and position((firm.row_edit).output_value ->> 'text' in (firm.row_edit).claim_text) = 0
                     then ' (' || ((firm.row_edit).output_value ->> 'text') || ')' else '' end, 600),
           evidence.final_url, evidence.source_section, null::text, evidence.modified_on,
           evidence.checked_on, evidence.current_to, evidence.content_hash, evidence.attested_on, null::timestamptz
    from public.rule_versions rule
    join public.rule_definitions definition on definition.id = rule.definition_id
    cross join program
    cross join lateral (select app.rule_claim_edit(p_org, definition.id) as row_edit) firm
    cross join lateral (
      -- Attested: a captured page as before; otherwise evidence Casevoya couldn't capture that the
      -- approving reviewer attested (who and the date they opened the page), on a deep federal page.
      select coalesce(snapshot.final_url, link.source_url) as final_url,
             link.source_section,
             case when snapshot.id is null then link.modified_on else snapshot.modified_on end as modified_on,
             case when snapshot.id is null then link.checked_on else app.firm_local_date(p_org, snapshot.retrieved_at) end as checked_on,
             case when snapshot.id is null then link.current_to else snapshot.current_to end as current_to,
             snapshot.content_hash,
             case when snapshot.id is null then link.page_attested_on end as attested_on
      from public.rule_evidence link
      left join public.source_snapshots snapshot on snapshot.id = link.snapshot_id
      where link.rule_version_id = rule.id
        and (
          snapshot.id is not null
          or (
            link.snapshot_id is null
            and link.page_attested_on is not null
            and link.page_attested_by_membership_id is not null
            and app.official_claim_url(link.source_url) is not null
            and app.vo_citable_official_url(link.source_url)
            and exists (
              select 1 from public.professional_reviews review
              where review.rule_version_id = rule.id
                and review.decision = 'approved'
                and review.reviewer_membership_id = link.page_attested_by_membership_id
            )
          )
        )
      order by (snapshot.id is null), snapshot.retrieved_at desc nulls last, link.page_attested_at desc
      limit 1
    ) evidence
    where app.rule_version_is_live(rule.id)
      and rule.claim is not null
      and (definition.organization_id is null or definition.organization_id = p_org)
      and (rule.organization_id is null or rule.organization_id = p_org)
      and (
        definition.program_key is null or definition.program_key = program.key
        -- Live claims (bug 6): a fee claim reaches Vo whatever pack the matter has.
        or definition.stable_key like 'CA.FEES.%'
      )
      -- Live claims (stale block): Vo doesn't cite a fee or advice-like official claim whose source
      -- is overdue for a re-check (public.vo_run_official_content says why).
      and not (
        app.official_claim_stale(rule.id)
        and (
          definition.source_category = 'fee'
          or definition.stable_key like 'CA.FEES.%'
          or app.vo_advice_like(coalesce((firm.row_edit).claim_text, rule.claim))
        )
      )
  ) as items (
    kind, id, label, content, source_url, source_section, form_number, form_modified_on,
    checked_on, current_to, snapshot_sha256, attested_on, reviewed_at
  )
  where app.vo_citable_official_url(items.source_url)
    -- Attested: a page Casevoya didn't capture is citable only with a reviewer's attestation.
    and (items.snapshot_sha256 is not null or items.attested_on is not null);
$$;
revoke all on function app.vo_letter_official_items(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- The stale block: what Vo won't cite (new)
-- ---------------------------------------------------------------------------

-- Live official claims for this matter that Vo would cite but won't, because their source is
-- overdue for a re-check: fee claims and advice-like claims (decision 4). The firm's wording when
-- it edited the claim; the date of the source's last successful check in the firm's timezone.
create function app.vo_stale_official_items(p_org uuid, p_matter_id uuid)
returns table (id uuid, label text, content text, source_url text, last_checked_on date)
language sql
stable
security definer
set search_path = ''
as $$
  with program as (select app.matter_program_key(p_matter_id) as key)
  select rule.id,
         left(definition.stable_key || case when definition.stable_key like 'CA.FEES.%' and definition.program_key is not null then ' (' || definition.program_key || ')' else '' end, 300),
         left(coalesce((firm.row_edit).claim_text, rule.claim), 600),
         link.source_url,
         case when src.last_checked_at is null then null else app.firm_local_date(p_org, src.last_checked_at) end
  from public.rule_versions rule
  join public.rule_definitions definition on definition.id = rule.definition_id
  cross join program
  cross join lateral (select app.rule_claim_edit(p_org, definition.id) as row_edit) firm
  cross join lateral app.rule_version_source(rule.id) src
  cross join lateral (
    select e.source_url from public.rule_evidence e where e.rule_version_id = rule.id and e.snapshot_id is not null limit 1
  ) link
  where rule.origin = 'official_capture'
    and app.rule_version_is_live(rule.id)
    and (definition.program_key is null or definition.program_key = program.key or definition.stable_key like 'CA.FEES.%')
    and app.official_claim_stale(rule.id)
    and (
      definition.source_category = 'fee'
      or definition.stable_key like 'CA.FEES.%'
      or app.vo_advice_like(coalesce((firm.row_edit).claim_text, rule.claim))
    )
    and app.vo_citable_official_url(link.source_url);
$$;
revoke all on function app.vo_stale_official_items(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Redefined: public.vo_run_official_content (from 20261025450000_vo_attested_citations.sql)
-- Live claims: after the content Vo may cite, the official claims it won't cite because their
-- source is overdue, each with the reason (stale: true, citable: false).
-- ---------------------------------------------------------------------------
create or replace function public.vo_run_official_content(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  run public.vo_runs;
begin
  run := app.vo_ask_run(p_run_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', item.kind,
      'id', item.id,
      'label', item.label,
      'content', item.content,
      'source_url', item.source_url,
      'source_section', item.source_section,
      'form_number', item.form_number,
      'form_modified_on', item.form_modified_on,
      'checked_on', item.checked_on,
      'current_to', item.current_to,
      'snapshot_sha256', item.snapshot_sha256
    -- Attested: the reviewer's attestation when Casevoya didn't capture the page.
    ) || coalesce(
      app.vo_official_attestation(run.organization_id, item.kind, item.id, item.snapshot_sha256, item.attested_on),
      jsonb_build_object('attested', false)
    ) order by item.kind, item.label)
    from (select * from app.vo_letter_official_items(run.organization_id, run.matter_id) limit 400) item
  ), '[]'::jsonb)
  -- Live claims (stale block): what Vo can't cite because its source is overdue, and why.
  || coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', 'rule_version',
      'id', stale.id,
      'label', stale.label,
      'content', stale.content,
      'source_url', stale.source_url,
      'checked_on', stale.last_checked_on,
      'attested', false,
      'stale', true,
      'citable', false,
      'stale_reason', 'The source for this was last checked '
        || coalesce(to_char(stale.last_checked_on, 'FMDD FMMonth YYYY'), 'never')
        || ' and is due for a re-check'
    ) order by stale.label)
    from (select * from app.vo_stale_official_items(run.organization_id, run.matter_id) limit 100) stale
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.vo_run_official_content(uuid) from public, anon;
grant execute on function public.vo_run_official_content(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Redefined: public.finish_vo_run (from 20261025450000_vo_attested_citations.sql)
-- Live claims: a draft's source list keeps the firm's edit stamp of an official claim it cites
-- (the run's citations already carry it from app.vo_official_attestation).
-- ---------------------------------------------------------------------------
create or replace function public.finish_vo_run(
  p_run_id uuid,
  p_result public.vo_run_result,
  p_title text default null,
  p_body text default null,
  p_sources jsonb default null,
  p_model text default null,
  p_prompt_version text default null,
  p_needs_rule boolean default false,
  p_latency_ms integer default null,
  p_failure text default null,
  p_tools text[] default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_cost_usd numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  run public.vo_runs%rowtype;
  src jsonb;
  src_kind text;
  src_id text;
  src_label text;
  src_source_kind text;
  fact_category text;
  official record;
  attestation jsonb;
  entry jsonb;
  cites jsonb := '[]'::jsonb;
  draft_sources jsonb := '[]'::jsonb;
  cites_official boolean := false;
  review_required boolean := false;
  did uuid;
  count_sources integer := 0;
begin
  select * into run from public.vo_runs where id = p_run_id for update;
  if run.id is null or actor is null or run.user_id is distinct from actor
     or app.in_active_org(run.organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  if run.result <> 'running' then
    raise exception 'this Vo run is already finished' using errcode = '22023';
  end if;
  if p_result is null or p_result = 'running'
     or (p_result = 'drafted' and run.kind = 'ask')
     or (p_result = 'answered' and run.kind <> 'ask') then
    raise exception 'say how the run ended' using errcode = '22023';
  end if;
  if p_model is not null and p_model !~ '^[a-z0-9@][a-z0-9@._/-]{2,119}$' then
    raise exception 'unknown model' using errcode = '22023';
  end if;
  if p_prompt_version is not null and p_prompt_version !~ '^[a-z0-9._-]{1,40}$' then
    raise exception 'unknown prompt version' using errcode = '22023';
  end if;
  if p_latency_ms is not null and p_latency_ms not between 0 and 600000 then
    raise exception 'latency out of range' using errcode = '22023';
  end if;
  if p_tools is not null and (
    cardinality(p_tools) > 60
    or exists (select 1 from unnest(p_tools) t where t !~ '^[A-Za-z0-9_]{1,80}$')
  ) then
    raise exception 'tool names out of range' using errcode = '22023';
  end if;
  if coalesce(p_input_tokens, 0) < 0 or coalesce(p_output_tokens, 0) < 0 or coalesce(p_cost_usd, 0) < 0 or coalesce(p_cost_usd, 0) > 1000 then
    raise exception 'usage out of range' using errcode = '22023';
  end if;
  if p_failure is not null and (p_result <> 'failed' or p_failure not in ('unavailable', 'failed', 'empty', 'nothing_to_draft')) then
    raise exception 'unknown failure' using errcode = '22023';
  end if;

  -- A run left open too long ends as failed; nothing is saved from it.
  if run.created_at < statement_timestamp() - interval '10 minutes' then
    update public.vo_runs
      set result = 'failed', failure = 'expired', finished_at = clock_timestamp()
      where id = run.id;
    return null;
  end if;

  if p_result in ('drafted', 'answered') then
    if app.message_staff_reads_matter(run.matter_id, run.organization_id) is distinct from true then
      raise exception 'vo denied' using errcode = '42501';
    end if;
    if p_model is null or p_prompt_version is null then
      raise exception 'a draft records its model and prompt version' using errcode = '22023';
    end if;
    -- Ask Vo answers are shown to the asker and not kept (only the run and its citations).
    if p_result = 'drafted' and (
      p_title is null or length(btrim(p_title)) not between 1 and 200
      or p_body is null or length(btrim(p_body)) not between 1 and 4000
    ) then
      raise exception 'a draft needs a title and 1 to 4000 characters' using errcode = '22023';
    end if;
    if p_sources is null or jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) not between 1 and 40 then
      raise exception 'a draft cites 1 to 40 records' using errcode = '22023';
    end if;
    -- Every cited record is in the run's allowed set: its own matter and conversation, the
    -- matter's documents and approved facts, and approved official content from a deep federal
    -- official page. A draft can't claim a source from another matter, client or firm, or a page
    -- nobody approved.
    for src in select value from jsonb_array_elements(p_sources)
    loop
      src_kind := src ->> 'kind';
      src_id := src ->> 'id';
      src_label := src ->> 'label';
      if jsonb_typeof(src) <> 'object' or src_id is null
         or src_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or src_label is null or length(btrim(src_label)) not between 1 and 120 then
        raise exception 'a source needs a kind, an id and a label' using errcode = '22023';
      end if;
      entry := jsonb_build_object('kind', src_kind, 'id', src_id, 'label', btrim(src_label));
      if src_kind = 'matter' then
        if src_id::uuid <> run.matter_id then
          raise exception 'a source is outside this matter' using errcode = '42501';
        end if;
      elsif src_kind = 'message' then
        if run.thread_id is null or not exists (
          select 1 from public.matter_messages message
          where message.id = src_id::uuid
            and message.organization_id = run.organization_id
            and message.thread_id = run.thread_id
        ) then
          raise exception 'a source is outside this conversation' using errcode = '42501';
        end if;
      elsif src_kind = 'document_request' then
        if not exists (
          select 1 from public.document_requests request
          where request.id = src_id::uuid
            and request.organization_id = run.organization_id
            and request.matter_id = run.matter_id
        ) then
          raise exception 'a source is outside this matter' using errcode = '42501';
        end if;
      elsif src_kind = 'task' then
        if not exists (
          select 1 from public.tasks task
          where task.id = src_id::uuid
            and task.organization_id = run.organization_id
            and task.matter_id = run.matter_id
        ) then
          raise exception 'a source is outside this matter' using errcode = '42501';
        end if;
      elsif src_kind = 'deadline' then
        if not exists (
          select 1 from public.deadlines deadline
          where deadline.id = src_id::uuid
            and deadline.organization_id = run.organization_id
            and deadline.matter_id = run.matter_id
        ) then
          raise exception 'a source is outside this matter' using errcode = '42501';
        end if;
      elsif src_kind = 'document_version' then
        if not exists (
          select 1
          from public.document_versions version
          join public.document_matter_refs link
            on link.document_id = version.document_id and link.organization_id = version.organization_id
          where version.id = src_id::uuid
            and version.organization_id = run.organization_id
            and link.matter_id = run.matter_id
            and link.removed_at is null
        ) then
          raise exception 'a source is outside this matter' using errcode = '42501';
        end if;
      elsif src_kind = 'fact' then
        select approved.category into fact_category
        from app.matter_approved_facts(run.matter_id) approved
        where approved.answer_id = src_id::uuid;
        if not found then
          raise exception 'a cited fact is not an approved fact on this matter' using errcode = '42501';
        end if;
        if fact_category <> 'general' and app.vo_category_allowed(run.organization_id, fact_category) is distinct from true then
          raise exception 'the firm hasn''t let Vo use this kind of fact' using errcode = '42501';
        end if;
      elsif src_kind = 'official' then
        src_source_kind := src ->> 'source_kind';
        select * into official
        from app.vo_letter_official_items(run.organization_id, run.matter_id) approved
        where approved.kind = src_source_kind and approved.id = src_id::uuid;
        if not found then
          raise exception 'a cited source is not approved official content of this firm' using errcode = '42501';
        end if;
        cites_official := true;
        entry := entry || jsonb_build_object(
          'source_kind', official.kind,
          'url', official.source_url,
          'section', official.source_section,
          'form_number', official.form_number,
          'form_modified_on', official.form_modified_on,
          'checked_on', official.checked_on,
          'current_to', official.current_to,
          'snapshot_sha256', official.snapshot_sha256
        );
        -- Attested: a page Casevoya didn't capture is cited only with the reviewer's attestation
        -- (who, and the date they opened it), taken from the database, never from the service.
        attestation := app.vo_official_attestation(run.organization_id, official.kind, official.id, official.snapshot_sha256, official.attested_on);
        if official.snapshot_sha256 is null and attestation is null then
          raise exception 'a cited source is not approved official content of this firm' using errcode = '42501';
        end if;
        entry := entry || coalesce(attestation, jsonb_build_object('attested', false));
      else
        raise exception 'unknown source kind' using errcode = '22023';
      end if;
      cites := cites || jsonb_build_array(entry);
      -- The draft keeps the short form (its column holds up to 16 kB); the run keeps the full one.
      draft_sources := draft_sources || jsonb_build_array(
        jsonb_build_object('kind', src_kind, 'id', src_id, 'label', btrim(src_label))
        || jsonb_strip_nulls(jsonb_build_object('source_kind', entry ->> 'source_kind', 'url', entry ->> 'url'))
        -- Attested: the draft's source list shows the attestation next to the citation.
        || case when (entry ->> 'attested')::boolean is true
             then jsonb_build_object('attested', true, 'attested_by', entry ->> 'attested_by', 'attested_on', entry ->> 'attested_on')
             else '{}'::jsonb end
        -- Live claims: and the firm's edit stamp next to an edited official claim.
        || case when (entry ->> 'edited')::boolean is true
             then jsonb_build_object('edited', true, 'edited_by', entry ->> 'edited_by', 'edited_licence', entry ->> 'edited_licence', 'edited_on', entry ->> 'edited_on')
             else '{}'::jsonb end
      );
      count_sources := count_sources + 1;
    end loop;
  end if;

  if p_result = 'drafted' then
    review_required := cites_official or app.vo_advice_like(p_body);
    insert into public.vo_drafts (
      organization_id, run_id, kind, matter_id, thread_id, title, body, sources, model, prompt_version,
      needs_rule, is_sample, created_by, licensed_review_required
    ) values (
      run.organization_id, run.id, run.kind::text::public.vo_draft_kind, run.matter_id, run.thread_id, btrim(p_title), btrim(p_body), draft_sources,
      p_model, p_prompt_version, coalesce(p_needs_rule, false), run.is_sample, actor, review_required
    )
    returning id into did;
  end if;

  update public.vo_runs
    set result = p_result,
        model = p_model,
        prompt_version = p_prompt_version,
        source_count = case when p_result in ('drafted', 'answered') then count_sources else null end,
        citations = case when p_result in ('drafted', 'answered') then cites else '[]'::jsonb end,
        latency_ms = p_latency_ms,
        tools_called = coalesce(p_tools, '{}'::text[]),
        input_tokens = p_input_tokens,
        output_tokens = p_output_tokens,
        cost_usd = p_cost_usd,
        failure = case when p_result = 'failed' then coalesce(p_failure, 'failed') else null end,
        finished_at = clock_timestamp()
    where id = run.id;

  perform app.record_audit_event(
    run.organization_id, 'vo.run_finished', 'vo_runs', run.id, 'success',
    jsonb_build_object(
      'kind', run.kind,
      'result', p_result,
      'model', p_model,
      'prompt_version', p_prompt_version,
      'source_count', case when p_result in ('drafted', 'answered') then count_sources else null end,
      'official_sources', case when p_result in ('drafted', 'answered') then (select count(*) from jsonb_array_elements(cites) c where c ->> 'kind' = 'official') else null end,
      'needs_rule', case when p_result = 'drafted' then coalesce(p_needs_rule, false) else null end,
      'licensed_review_required', case when p_result = 'drafted' then review_required else null end,
      'draft_id', did,
      'tools', coalesce(p_tools, '{}'::text[])
    )
  );
  return did;
end;
$$;
revoke all on function public.finish_vo_run(uuid, public.vo_run_result, text, text, jsonb, text, text, boolean, integer, text, text[], integer, integer, numeric) from public, anon;
grant execute on function public.finish_vo_run(uuid, public.vo_run_result, text, text, jsonb, text, text, boolean, integer, text, text[], integer, integer, numeric)
  to authenticated, service_role;
