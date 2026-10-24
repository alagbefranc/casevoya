-- ORG-06 (#175): a firm transfer record. The firm owner (step-up) records the receiving firm and
-- the matters in scope, reviews each client's authority (checkbox + note), and makes a
-- permissioned client-file export per matter with the existing export (start_matter_export).
-- Nothing is moved, shared or deleted by any of this: the receiving firm gets only what the owner
-- downloads and hands over, and onboards the client separately. Status shows on Settings > Team.
--   firm_transfers / firm_transfer_items   RLS forced, no policies: read through firm_transfers_overview.
--   record_firm_transfer                   owner + step-up: the receiving firm and the matters.
--   review_firm_transfer_authority         owner + step-up: per matter, authorised or not, with a note.
--   close_firm_transfer                    owner + step-up: completed (handed over) or cancelled.
--   firm_transfers_overview                owner: the transfers, each matter's review and latest export.

create table public.firm_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  receiving_firm text not null check (length(btrim(receiving_firm)) between 2 and 200),
  receiving_contact_name text check (receiving_contact_name is null or length(btrim(receiving_contact_name)) between 1 and 200),
  receiving_contact_email text check (receiving_contact_email is null or (receiving_contact_email = lower(receiving_contact_email) and receiving_contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  note text check (note is null or length(note) <= 2000),
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  closed_at timestamptz,
  closed_by uuid references auth.users (id),
  close_note text check (close_note is null or length(close_note) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check ((status = 'open') = (closed_at is null))
);
comment on table public.firm_transfers is
  'ORG-06: the firm owner''s record of handing matters to another firm. A record only: nothing moves automatically.';
alter table public.firm_transfers enable row level security;
alter table public.firm_transfers force row level security;
create index firm_transfers_org_idx on public.firm_transfers (organization_id, created_at desc);
create index firm_transfers_created_by_idx on public.firm_transfers (created_by);
create index firm_transfers_closed_by_idx on public.firm_transfers (closed_by);
revoke all on public.firm_transfers from public, anon, authenticated;

create table public.firm_transfer_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  transfer_id uuid not null,
  matter_id uuid not null,
  authority text not null default 'pending' check (authority in ('pending', 'authorised', 'not_authorised')),
  authority_note text check (authority_note is null or length(btrim(authority_note)) between 3 and 1000),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (transfer_id, matter_id),
  foreign key (transfer_id, organization_id) references public.firm_transfers (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  check ((authority = 'pending') = (reviewed_at is null)),
  check (authority = 'pending' or authority_note is not null)
);
comment on table public.firm_transfer_items is
  'ORG-06: one matter in a firm transfer, with the owner''s review of the client''s authority before it moves.';
alter table public.firm_transfer_items enable row level security;
alter table public.firm_transfer_items force row level security;
create index firm_transfer_items_transfer_org_fk_idx on public.firm_transfer_items (transfer_id, organization_id);
create index firm_transfer_items_matter_org_fk_idx on public.firm_transfer_items (matter_id, organization_id);
create index firm_transfer_items_reviewed_by_idx on public.firm_transfer_items (reviewed_by);
revoke all on public.firm_transfer_items from public, anon, authenticated;

create function public.record_firm_transfer(
  p_organization_id uuid,
  p_receiving_firm text,
  p_contact_name text,
  p_contact_email text,
  p_note text,
  p_matter_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  firm_name text := btrim(coalesce(p_receiving_firm, ''));
  contact text := nullif(btrim(coalesce(p_contact_name, '')), '');
  email_raw text := nullif(btrim(coalesce(p_contact_email, '')), '');
  email text;
  note_value text := nullif(btrim(coalesce(p_note, '')), '');
  ids uuid[] := coalesce((select array_agg(distinct x) from unnest(p_matter_ids) x where x is not null), array[]::uuid[]);
  transfer_id uuid;
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  if length(firm_name) not between 2 and 200 then
    raise exception 'name the receiving firm' using errcode = '22023';
  end if;
  email := app.normalize_email(email_raw);
  if email_raw is not null and email is null then
    raise exception 'the receiving firm''s email is not usable' using errcode = '22023';
  end if;
  if (contact is not null and length(contact) > 200) or (note_value is not null and length(note_value) > 2000) then
    raise exception 'that is too long' using errcode = '22023';
  end if;
  if cardinality(ids) = 0 or cardinality(ids) > 200 then
    raise exception 'choose the matters in scope' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(ids) x
    where not exists (select 1 from public.matters m where m.id = x and m.organization_id = p_organization_id and not m.is_sample)
  ) then
    raise exception 'choose this firm''s own matters' using errcode = '22023';
  end if;

  insert into public.firm_transfers (organization_id, receiving_firm, receiving_contact_name, receiving_contact_email, note, created_by)
  values (p_organization_id, firm_name, contact, email, note_value, (select auth.uid()))
  returning id into transfer_id;
  insert into public.firm_transfer_items (organization_id, transfer_id, matter_id)
  select p_organization_id, transfer_id, x from unnest(ids) x;

  perform app.record_audit_event(
    p_organization_id, 'firm_transfer.recorded', 'public.firm_transfers', transfer_id, 'success',
    jsonb_build_object('matters', cardinality(ids), 'contact_email', email is not null)
  );
  return transfer_id;
end;
$$;
comment on function public.record_firm_transfer(uuid, text, text, text, text, uuid[]) is
  'Firm owner + step-up (ORG-06): records a transfer to a receiving firm and the matters in scope. Moves nothing. Audited.';
revoke all on function public.record_firm_transfer(uuid, text, text, text, text, uuid[]) from public, anon;
grant execute on function public.record_firm_transfer(uuid, text, text, text, text, uuid[]) to authenticated;

create function public.review_firm_transfer_authority(p_item_id uuid, p_authorised boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.firm_transfer_items%rowtype;
  transfer public.firm_transfers%rowtype;
  note_value text := btrim(coalesce(p_note, ''));
begin
  select * into item from public.firm_transfer_items where id = p_item_id for update;
  if item.id is null then
    raise exception 'transfer matter not found' using errcode = '42501';
  end if;
  perform app.require_firm_owner_step_up(item.organization_id);
  select * into transfer from public.firm_transfers where id = item.transfer_id;
  if transfer.status <> 'open' then
    raise exception 'this transfer is closed' using errcode = '22023';
  end if;
  if p_authorised is null then
    raise exception 'say whether the client authorised the transfer' using errcode = '22023';
  end if;
  if length(note_value) not between 3 and 1000 then
    raise exception 'add a note on the client''s authority' using errcode = '22023';
  end if;
  update public.firm_transfer_items
     set authority = case when p_authorised then 'authorised' else 'not_authorised' end,
         authority_note = note_value,
         reviewed_at = statement_timestamp(),
         reviewed_by = (select auth.uid())
   where id = item.id;
  perform app.record_audit_event(
    item.organization_id, 'firm_transfer.authority_reviewed', 'public.firm_transfer_items', item.id, 'success',
    jsonb_build_object('transfer_id', item.transfer_id, 'matter_id', item.matter_id, 'authorised', p_authorised)
  );
end;
$$;
comment on function public.review_firm_transfer_authority(uuid, boolean, text) is
  'Firm owner + step-up (ORG-06): records whether the client authorised moving this matter to the receiving firm, with a note. Audited; the note stays out of the audit context.';
revoke all on function public.review_firm_transfer_authority(uuid, boolean, text) from public, anon;
grant execute on function public.review_firm_transfer_authority(uuid, boolean, text) to authenticated;

create function public.close_firm_transfer(p_transfer_id uuid, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  transfer public.firm_transfers%rowtype;
  note_value text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into transfer from public.firm_transfers where id = p_transfer_id for update;
  if transfer.id is null then
    raise exception 'transfer not found' using errcode = '42501';
  end if;
  perform app.require_firm_owner_step_up(transfer.organization_id);
  if transfer.status <> 'open' then
    raise exception 'this transfer is closed' using errcode = '22023';
  end if;
  if p_status not in ('completed', 'cancelled') then
    raise exception 'choose completed or cancelled' using errcode = '22023';
  end if;
  if p_status = 'completed' and exists (
    select 1 from public.firm_transfer_items item where item.transfer_id = transfer.id and item.authority = 'pending'
  ) then
    raise exception 'review the client''s authority on every matter first' using errcode = '22023';
  end if;
  if note_value is not null and length(note_value) > 2000 then
    raise exception 'that is too long' using errcode = '22023';
  end if;
  update public.firm_transfers
     set status = p_status, closed_at = statement_timestamp(), closed_by = (select auth.uid()), close_note = note_value, updated_at = now()
   where id = transfer.id;
  perform app.record_audit_event(
    transfer.organization_id, 'firm_transfer.closed', 'public.firm_transfers', transfer.id, 'success',
    jsonb_build_object('status', p_status)
  );
end;
$$;
comment on function public.close_firm_transfer(uuid, text, text) is
  'Firm owner + step-up (ORG-06): marks a transfer completed (every matter''s authority reviewed) or cancelled. Moves nothing. Audited.';
revoke all on function public.close_firm_transfer(uuid, text, text) from public, anon;
grant execute on function public.close_firm_transfer(uuid, text, text) to authenticated;

-- The firm's transfers for its owner: each matter's authority review and its newest ready export
-- made since the transfer was recorded (the export itself stays behind start_matter_export).
create function public.firm_transfers_overview(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner']::public.org_role[], false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'receiving_firm', t.receiving_firm,
      'contact_name', t.receiving_contact_name,
      'contact_email', t.receiving_contact_email,
      'note', t.note,
      'status', t.status,
      'created_at', t.created_at,
      'closed_at', t.closed_at,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', item.id,
          'matter_id', item.matter_id,
          'matter', coalesce(m.reference, m.title),
          'authority', item.authority,
          'authority_note', item.authority_note,
          'reviewed_at', item.reviewed_at,
          'export', (
            select jsonb_build_object('id', x.id, 'ready_at', x.ready_at, 'expires_at', x.expires_at)
            from public.matter_exports x
            where x.matter_id = item.matter_id and x.organization_id = item.organization_id
              and x.status = 'ready' and x.requested_at >= t.created_at
            order by x.ready_at desc nulls last
            limit 1
          )
        ) order by coalesce(m.reference, m.title))
        from public.firm_transfer_items item
        join public.matters m on m.id = item.matter_id and m.organization_id = item.organization_id
        where item.transfer_id = t.id
      ), '[]'::jsonb)
    ) order by t.created_at desc)
    from public.firm_transfers t
    where t.organization_id = p_organization_id
  ), '[]'::jsonb);
end;
$$;
comment on function public.firm_transfers_overview(uuid) is
  'Firm owner at aal2 (ORG-06): the firm''s transfers with each matter''s authority review and newest ready export since the transfer. Read only.';
revoke all on function public.firm_transfers_overview(uuid) from public, anon;
grant execute on function public.firm_transfers_overview(uuid) to authenticated;
