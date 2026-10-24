-- OPS-06 inbound email capture: matter inbound addresses, File to matter with per-file choices,
-- and a follow-up task for every critical bounce (Delivery problems).
--
-- Added:
--   inbound_inbox_items.file_audience / skipped_at / skipped_by: what staff chose for each file
--     when they filed its email (save as client-visible or staff only, or leave out).
--   email_deliveries.follow_up_task_id: the staff follow-up task a critical bounce opened or joined.
--   public.matter_inbound_address(matter, domain): the matter's inbound address for staff who can
--     read the matter (creates its 128-bit random plus-tag on first use, via app.firm_reply_address).
--   public.file_inbound_email_to_matter(email, matter, person, files): files the email through
--     public.file_inbound_email (unchanged) and records each file's choice, in one transaction.
-- Redefined (latest definitions copied, only the noted change):
--   public.assign_unsorted_email_file (latest: 20261019200000_inbound_triage.sql): refuses a file
--     staff left out, and the document's audience is the file's choice ('subject' when none was
--     made, as before).
--   public.finish_email_delivery (latest: 20261018190100_invitation_email_link_mail_worker.sql):
--     a critical bounce on a matter joins the firm's already-open follow-up task instead of being
--     recorded nowhere, the task is recorded on the delivery (follow_up_task_id), and the
--     email.bounced audit entry names it. Everything else is unchanged (a task still needs a
--     matter, so a critical bounce with no matter still gets none).
-- Filing never gives the sender access: nothing here touches memberships, persons or grants.
-- Additive only.

alter table public.inbound_inbox_items
  add column file_audience public.document_audience,
  add column skipped_at timestamptz,
  add column skipped_by uuid references auth.users (id);
comment on column public.inbound_inbox_items.file_audience is
  'Who may see the document this file becomes, chosen when staff filed its email (subject: the client; staff: firm staff only). Null: subject.';
comment on column public.inbound_inbox_items.skipped_at is
  'Set when staff filed the email but left this file out of the matter''s documents. It is never copied.';
create index inbound_inbox_items_skipped_by_idx on public.inbound_inbox_items (skipped_by);

alter table public.email_deliveries
  add column follow_up_task_id uuid,
  add constraint email_deliveries_follow_up_task_fk
    foreign key (follow_up_task_id, organization_id) references public.tasks (id, organization_id);
comment on column public.email_deliveries.follow_up_task_id is
  'The staff follow-up task opened (or already open) when this critical notice bounced.';
create index email_deliveries_follow_up_task_org_fk_idx on public.email_deliveries (follow_up_task_id, organization_id);

-- The matter's inbound address (slug+token@domain) for staff who can read the matter.
create function public.matter_inbound_address(p_matter_id uuid, p_domain text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  address text;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null
     or matter.organization_id is distinct from (select app.current_organization_id())
     or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'matter address denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  address := app.firm_reply_address(matter.organization_id, matter.id, p_domain);
  return jsonb_build_object('address', address, 'matter_tag', strpos(address, '+') > 0);
end;
$$;
revoke all on function public.matter_inbound_address(uuid, text) from public, anon;
grant execute on function public.matter_inbound_address(uuid, text) to authenticated, service_role;

-- File to matter (Email to triage): file the email, then record for each of its files whether it
-- goes to the matter's Documents and who may see it. p_files: [{item_id, save, audience}], with
-- audience 'subject' (the client can see it) or 'staff' (firm staff only). Files not listed keep
-- the default (saved, client can see it).
create function public.file_inbound_email_to_matter(
  p_email_id uuid,
  p_matter_id uuid,
  p_person_id uuid,
  p_files jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  filed jsonb;
  choice jsonb;
  chosen_item uuid;
  keep_file boolean;
  chosen_audience text;
  saved_count integer := 0;
  skipped_count integer := 0;
  items jsonb;
begin
  if p_files is null or jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) > 20 then
    raise exception 'choose what happens to each file' using errcode = '22023';
  end if;
  -- Every access, role, step-up, matter and person check is public.file_inbound_email's.
  filed := public.file_inbound_email(p_email_id, p_matter_id, p_person_id);

  for choice in select value from jsonb_array_elements(p_files) loop
    if jsonb_typeof(choice) is distinct from 'object'
       or coalesce(choice ->> 'item_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'choose what happens to each file' using errcode = '22023';
    end if;
    chosen_item := (choice ->> 'item_id')::uuid;
    keep_file := (choice -> 'save') is distinct from 'false'::jsonb;
    chosen_audience := coalesce(choice ->> 'audience', 'subject');
    if keep_file and chosen_audience not in ('subject', 'staff') then
      raise exception 'choose who may see each file' using errcode = '22023';
    end if;
    update public.inbound_inbox_items
       set file_audience = case when keep_file then chosen_audience::public.document_audience else null end,
           skipped_at = case when keep_file then null else statement_timestamp() end,
           skipped_by = case when keep_file then null else (select auth.uid()) end
     where id = chosen_item
       and inbound_email_id = p_email_id
       and assigned_version_id is null;
    if not found then
      raise exception 'that file is not on this email' using errcode = '42501';
    end if;
    if keep_file then
      saved_count := saved_count + 1;
    else
      skipped_count := skipped_count + 1;
    end if;
  end loop;

  select coalesce(jsonb_agg(item.id order by item.created_at), '[]'::jsonb) into items
  from public.inbound_inbox_items item
  where item.inbound_email_id = p_email_id
    and item.upload_state = 'clean'
    and item.assigned_version_id is null
    and item.skipped_at is null;

  perform app.record_audit_event(
    (select email.organization_id from public.inbound_emails email where email.id = p_email_id),
    'email.files_chosen', 'public.inbound_emails', p_email_id, 'success',
    jsonb_build_object('saved', saved_count, 'left_out', skipped_count)
  );
  return filed || jsonb_build_object('items', items);
end;
$$;
revoke all on function public.file_inbound_email_to_matter(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.file_inbound_email_to_matter(uuid, uuid, uuid, jsonb) to authenticated, service_role;

create or replace function public.assign_unsorted_email_file(
  p_item_id uuid,
  p_matter_id uuid,
  p_person_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.inbound_inbox_items%rowtype;
  email public.inbound_emails%rowtype;
  intent jsonb;
begin
  select * into item from public.inbound_inbox_items where id = p_item_id;
  if item.id is null or app.can_read_inbound_email(item.inbound_email_id) is distinct from true then
    raise exception 'inbox file was not found' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    item.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    true
  );
  select * into email from public.inbound_emails where id = item.inbound_email_id;
  if email.triage_state = 'dismissed' then
    raise exception 'inbox file was dismissed' using errcode = '42501';
  end if;
  if email.triage_state = 'filed'
     and (email.matter_id is distinct from p_matter_id or email.person_id is distinct from p_person_id) then
    raise exception 'inbox file belongs to its filed matter' using errcode = '42501';
  end if;
  -- OPS-06: a file staff left out when filing never becomes a document.
  if item.skipped_at is not null then
    raise exception 'inbox file was left out' using errcode = '42501';
  end if;
  if item.upload_state is distinct from 'clean' then
    raise exception 'only a clean inbox file can be assigned' using errcode = '42501';
  end if;
  -- A copy that never finished (its upload authorization expired, or the check failed) may be retried.
  if item.assigned_version_id is not null and not exists (
    select 1
    from public.document_versions version
    where version.id = item.assigned_version_id
      and (
        version.upload_state = 'failed'
        or (version.upload_state = 'uploading' and version.intent_expires_at <= statement_timestamp())
      )
  ) then
    raise exception 'inbox file is already assigned' using errcode = '42501';
  end if;
  -- OPS-06: the audience staff chose when filing (client or staff only); 'subject' as before otherwise.
  intent := app.create_upload_intent(
    p_matter_id, p_person_id, item.filename, item.byte_size, 'Email attachment',
    'ordinary'::public.document_sensitivity, coalesce(item.file_audience, 'subject'::public.document_audience),
    null, null, null
  );
  update public.inbound_inbox_items
     set assigned_version_id = (intent ->> 'version_id')::uuid
   where id = item.id;
  perform app.record_audit_event(
    item.organization_id, 'email.attachment_assigned', 'public.inbound_inbox_items', item.id, 'success',
    jsonb_build_object(
      'version_id', intent ->> 'version_id',
      'matter_id', p_matter_id,
      'audience', coalesce(item.file_audience, 'subject'::public.document_audience)
    )
  );
  return intent || jsonb_build_object('source_storage_key', item.storage_key, 'inbox_item_id', item.id);
end;
$$;

create or replace function public.finish_email_delivery(
  p_delivery_id uuid,
  p_worker text,
  p_outcome text,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.email_deliveries%rowtype;
  event public.outbox_events%rowtype;
  owner uuid;
  next_status public.email_delivery_status;
  follow_up uuid;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('sent', 'queued', 'bounced', 'suppressed', 'retry', 'terminal_failure') then
    raise exception 'delivery outcome is invalid' using errcode = '22023';
  end if;
  select * into delivery from public.email_deliveries where id = p_delivery_id for update;
  if delivery.id is null then
    raise exception 'delivery was not found' using errcode = '42501';
  end if;
  select * into event from public.outbox_events where id = delivery.outbox_event_id;
  if event.status = 'published' or delivery.status in ('sent', 'queued', 'bounced', 'suppressed', 'skipped') then
    return;
  end if;
  if event.locked_by is distinct from left(btrim(coalesce(p_worker, '')), 200) then
    raise exception 'mail event is not claimed' using errcode = '42501';
  end if;

  if p_outcome = 'retry' then
    update public.email_deliveries
       set status = 'failed', last_error = left(coalesce(p_error, 'retry'), 500)
     where id = delivery.id;
    perform app.mark_outbox_failed(event.id, p_worker, coalesce(p_error, 'retry'), 8);
    -- sealed invitation link: a dead-lettered event will not be retried on its own.
    if exists (
      select 1 from public.outbox_events dead
      where dead.id = event.id and dead.status = 'dead_lettered'
    ) then
      perform app.scrub_invitation_link(event.id);
    end if;
    perform app.record_audit_event(
      delivery.organization_id, 'email.failed', 'public.email_deliveries', delivery.id, 'failure',
      jsonb_build_object('template', delivery.template, 'retry', true)
    );
    return;
  end if;
  if p_outcome = 'terminal_failure' then
    update public.email_deliveries
       set status = 'failed', last_error = left(coalesce(p_error, 'rejected'), 500)
     where id = delivery.id;
    perform app.mark_outbox_failed(event.id, p_worker, coalesce(p_error, 'rejected'), 1);
    -- sealed invitation link: a terminal failure is final.
    perform app.scrub_invitation_link(event.id);
    perform app.record_audit_event(
      delivery.organization_id, 'email.failed', 'public.email_deliveries', delivery.id, 'failure',
      jsonb_build_object('template', delivery.template, 'retry', false)
    );
    return;
  end if;

  next_status := p_outcome::public.email_delivery_status;
  update public.email_deliveries
     set status = next_status,
         provider_message_id = left(nullif(btrim(coalesce(p_provider_message_id, '')), ''), 200),
         last_error = case when p_outcome = 'bounced' then left(coalesce(p_error, 'bounced'), 500) else null end
   where id = delivery.id;
  -- sealed invitation link: sent, queued, bounced and suppressed are final.
  perform app.scrub_invitation_link(event.id);

  if p_outcome = 'bounced' then
    insert into public.email_suppressions (organization_id, recipient_email, reason)
    values (delivery.organization_id, delivery.recipient_email, 'hard_bounce')
    on conflict (organization_id, recipient_email) do nothing;
    -- OPS-06: every critical bounce on a matter gets a staff follow-up. The firm has at most one
    -- open follow-up task (tasks_email_delivery_failure_open_uidx); a later bounce joins it instead
    -- of being recorded nowhere. The delivery records which task follows it up. A task needs a
    -- matter (tasks_check), so a critical bounce with no matter has none; Delivery problems says so.
    if delivery.critical and delivery.matter_id is not null then
      select task.id into follow_up
      from public.tasks task
      where task.organization_id = delivery.organization_id
        and task.task_key = 'email_delivery_failure'
        and task.status in ('open', 'blocked')
      limit 1;
      if follow_up is null then
        select membership.id into owner
        from public.memberships membership
        where membership.organization_id = delivery.organization_id
          and membership.role = 'firm_owner'
          and membership.status = 'active'
        order by membership.created_at
        limit 1;
        if owner is not null then
          insert into public.tasks (
            organization_id, matter_id, audience, title, priority, status,
            owner_membership_id, task_key, due_timezone, checklist
          ) values (
            delivery.organization_id, delivery.matter_id, 'internal',
            'Email was not delivered', 'critical', 'open',
            owner, 'email_delivery_failure', 'America/Toronto', '[]'::jsonb
          )
          on conflict (organization_id) where task_key = 'email_delivery_failure' and status in ('open', 'blocked')
          do nothing
          returning id into follow_up;
          if follow_up is not null then
            insert into public.task_events (organization_id, task_id, event_kind, to_status)
            values (delivery.organization_id, follow_up, 'created', 'open'::public.task_status);
          end if;
        end if;
      end if;
      if follow_up is not null then
        update public.email_deliveries
           set follow_up_task_id = follow_up
         where id = delivery.id;
      end if;
    end if;
  end if;

  perform app.record_audit_event(
    delivery.organization_id,
    case p_outcome
      when 'sent' then 'email.sent'
      when 'queued' then 'email.sent'
      when 'bounced' then 'email.bounced'
      else 'email.suppressed'
    end,
    'public.email_deliveries',
    delivery.id,
    case when p_outcome in ('sent', 'queued') then 'success' when p_outcome = 'bounced' then 'failure' else 'denied' end,
    jsonb_build_object(
      'template', delivery.template,
      'recipient_email', delivery.recipient_email,
      'provider_message_id', left(coalesce(p_provider_message_id, ''), 200),
      'follow_up_task_id', follow_up
    )
  );

  if not exists (
    select 1
    from public.email_deliveries pending
    where pending.outbox_event_id = event.id
      and pending.status in ('pending', 'sending', 'failed')
  ) then
    perform app.mark_outbox_published(event.id, p_worker);
  end if;
end;
$$;
revoke all on function public.finish_email_delivery(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_email_delivery(uuid, text, text, text, text) to service_role;
