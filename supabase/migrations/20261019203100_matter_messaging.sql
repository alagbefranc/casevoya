-- Secure matter messaging between firm staff and a matter's clients (PRD OPS-04, OPS-05; TASKS
-- T034). Additive only.
--
-- Model
--   message_threads             one conversation on one matter with one fixed audience: the set of
--                               the matter's people who may read it (audience_key = their sorted
--                               ids). Staff on the matter always read client threads.
--   message_thread_people       that audience. A message to the applicant is not visible to the
--                               sponsor or a dependant unless they are in the thread's audience
--                               (family / household boundary). Being on the matter is not enough.
--   matter_messages             append-only messages. Body 1..4000 characters. requires_ack marks
--                               a critical instruction (staff only) that the client acknowledges.
--   matter_message_attachments  links to EXISTING documents (no new storage, storage schema
--                               untouched). Opening one goes through the existing
--                               authorize_document_download, which re-checks the reader.
--   matter_message_receipts     per reader: read_at (unread status) and acknowledged_at.
--   matter_staff_notes          staff-only notes on a matter. A separate table that no portal
--                               role can read (restrictive staff policy, like
--                               20261018010300_staff_only_matter_notes_intake.sql); never mixed
--                               with messages and never mailed.
--
-- Who reads
--   staff    firm owner, licensed consultant, case manager, assistant at staff assurance (aal2)
--            who can read the matter (owner, assigned, or creating consultant): every thread on
--            it. Finance users do not read case messages.
--   clients  a signed-in person who is in the thread's audience and still on the matter.
--
-- Writes only through security definer functions (search_path = ''):
--   send_matter_message, mark_message_thread_read, acknowledge_matter_message,
--   add_matter_staff_note. Each is audited without the message text.
--
-- Attachments: a document may be attached only when every reader in the audience could read it
-- (PRD OPS acceptance "A message addressed to an employer cannot include a document limited to the
-- applicant"): never a staff-only document; a subject-only or sensitive document only when the
-- audience is exactly its own person; an ordinary matter-shared document to anyone on the matter.
--
-- Rate limits: a client may send 10 messages in 10 minutes and 100 in a day; staff 60 in 10
-- minutes. Counted per sender from the messages table.
--
-- Email: a staff message queues outbox 'message.sent' (ids only). prepare_email_delivery maps it
-- to template 'message' (EX07, the approved generic "New message from {firm}" notice) for each
-- addressed person with an email, honouring "Email notices". The context is the firm name only:
-- no message text, no attachment name, no matter detail. claim_mail_events and
-- prepare_email_delivery are copied from their latest definitions
-- (20261019180200_scheduling_mail.sql and 20261019190000_booking_practice_pages.sql) with that
-- event added; nothing else in them changes.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.message_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  audience_key text not null check (length(audience_key) between 36 and 2000),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  last_message_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (matter_id, audience_key),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.message_threads is
  'One conversation on one matter with a fixed audience of the matter''s people. Staff on the matter read it; other participants do not.';

create index message_threads_org_idx on public.message_threads (organization_id);
create index message_threads_matter_org_idx on public.message_threads (matter_id, organization_id);
create index message_threads_created_by_idx on public.message_threads (created_by);
create index message_threads_org_last_idx on public.message_threads (organization_id, last_message_at desc);

create table public.message_thread_people (
  thread_id uuid not null,
  organization_id uuid not null references public.organizations (id),
  person_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (thread_id, person_id),
  foreign key (thread_id, organization_id) references public.message_threads (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.message_thread_people is 'The people a thread is addressed to. Fixed when the thread is created.';

create index message_thread_people_org_idx on public.message_thread_people (organization_id);
create index message_thread_people_thread_org_idx on public.message_thread_people (thread_id, organization_id);
create index message_thread_people_person_org_idx on public.message_thread_people (person_id, organization_id);

create table public.matter_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  thread_id uuid not null,
  matter_id uuid not null,
  author_user_id uuid not null references auth.users (id),
  author_kind text not null check (author_kind in ('staff', 'client')),
  author_person_id uuid,
  author_membership_id uuid,
  body text not null check (length(btrim(body)) between 1 and 4000),
  requires_ack boolean not null default false,
  -- The sender's name as shown to readers, copied when sent (portal readers cannot read staff
  -- profiles).
  author_name text not null check (length(btrim(author_name)) between 1 and 200),
  client_key text check (client_key is null or client_key ~ '^[A-Za-z0-9_-]{8,80}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (id, organization_id),
  unique (organization_id, author_user_id, client_key),
  check ((author_kind = 'client') = (author_person_id is not null)),
  check ((author_kind = 'staff') = (author_membership_id is not null)),
  check (not requires_ack or author_kind = 'staff'),
  foreign key (thread_id, organization_id) references public.message_threads (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (author_person_id, organization_id) references public.persons (id, organization_id),
  foreign key (author_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.matter_messages is
  'Append-only matter messages. The text never leaves the app: email notices are generic (EX07).';

create index matter_messages_org_idx on public.matter_messages (organization_id);
create index matter_messages_thread_org_idx on public.matter_messages (thread_id, organization_id, created_at);
create index matter_messages_matter_org_idx on public.matter_messages (matter_id, organization_id);
create index matter_messages_author_user_idx on public.matter_messages (author_user_id, created_at desc);
create index matter_messages_author_person_org_idx on public.matter_messages (author_person_id, organization_id);
create index matter_messages_author_membership_org_idx on public.matter_messages (author_membership_id, organization_id);
create index matter_messages_org_created_idx on public.matter_messages (organization_id, created_at desc);

create table public.matter_message_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  message_id uuid not null,
  document_id uuid not null,
  created_at timestamptz not null default now(),
  unique (message_id, document_id),
  foreign key (message_id, organization_id) references public.matter_messages (id, organization_id),
  foreign key (document_id, organization_id) references public.documents (id, organization_id)
);
comment on table public.matter_message_attachments is
  'A link from a message to an existing document. No file is copied; opening it re-checks the reader.';

create index matter_message_attachments_org_idx on public.matter_message_attachments (organization_id);
create index matter_message_attachments_message_org_idx on public.matter_message_attachments (message_id, organization_id);
create index matter_message_attachments_document_org_idx on public.matter_message_attachments (document_id, organization_id);

create table public.matter_message_receipts (
  message_id uuid not null,
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references auth.users (id),
  person_id uuid,
  read_at timestamptz not null default clock_timestamp(),
  acknowledged_at timestamptz,
  primary key (message_id, user_id),
  foreign key (message_id, organization_id) references public.matter_messages (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.matter_message_receipts is 'Who read a message, and who acknowledged a critical instruction.';

create index matter_message_receipts_org_idx on public.matter_message_receipts (organization_id);
create index matter_message_receipts_message_org_idx on public.matter_message_receipts (message_id, organization_id);
create index matter_message_receipts_user_idx on public.matter_message_receipts (user_id);
create index matter_message_receipts_person_org_idx on public.matter_message_receipts (person_id, organization_id);

create table public.matter_staff_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  author_user_id uuid not null references auth.users (id),
  author_membership_id uuid not null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default clock_timestamp(),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (author_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.matter_staff_notes is
  'Staff-only notes on a matter. Never visible to clients, never mailed, never mixed with matter_messages.';

create index matter_staff_notes_org_idx on public.matter_staff_notes (organization_id);
create index matter_staff_notes_matter_org_idx on public.matter_staff_notes (matter_id, organization_id, created_at);
create index matter_staff_notes_author_user_idx on public.matter_staff_notes (author_user_id);
create index matter_staff_notes_author_membership_org_idx on public.matter_staff_notes (author_membership_id, organization_id);

-- Messages, attachments, thread audiences and notes are append-only. Receipts change only through
-- the functions below (read_at and acknowledged_at once).
create function app.reject_message_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only (% rejected)', tg_table_name, tg_op using errcode = '42501';
end;
$$;
revoke all on function app.reject_message_change() from public;

create trigger matter_messages_append_only before update or delete on public.matter_messages
  for each row execute function app.reject_message_change();
create trigger matter_message_attachments_append_only before update or delete on public.matter_message_attachments
  for each row execute function app.reject_message_change();
create trigger message_thread_people_append_only before update or delete on public.message_thread_people
  for each row execute function app.reject_message_change();
create trigger matter_staff_notes_append_only before update or delete on public.matter_staff_notes
  for each row execute function app.reject_message_change();

-- ---------------------------------------------------------------------------
-- Read rules
-- ---------------------------------------------------------------------------

-- Staff who may read a matter's messages and notes: not finance users, at staff assurance.
create function app.message_staff_reads_matter(p_matter_id uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.in_active_org(p_org)
     and app.staff_mfa_satisfied()
     and app.has_org_role(p_org, array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[])
     and exists (
       select 1 from public.matters matter
       where matter.id = p_matter_id and matter.organization_id = p_org
     )
     and app.can_read_matter(p_matter_id);
$$;
revoke all on function app.message_staff_reads_matter(uuid, uuid) from public;
grant execute on function app.message_staff_reads_matter(uuid, uuid) to authenticated, service_role;

-- The caller's own person in a thread's audience, while that person is still on the matter.
create function app.message_thread_person_for_me(p_thread_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select person.id
  from public.message_threads thread
  join public.message_thread_people tp
    on tp.thread_id = thread.id
   and tp.organization_id = thread.organization_id
  join public.persons person
    on person.id = tp.person_id
   and person.organization_id = tp.organization_id
  where thread.id = p_thread_id
    and (select auth.uid()) is not null
    and person.user_id = (select auth.uid())
    and app.in_active_org(thread.organization_id)
    and exists (
      select 1 from public.matter_participants party
      where party.matter_id = thread.matter_id
        and party.organization_id = thread.organization_id
        and party.person_id = person.id
    )
  limit 1;
$$;
revoke all on function app.message_thread_person_for_me(uuid) from public;
grant execute on function app.message_thread_person_for_me(uuid) to authenticated, service_role;

create function app.can_read_message_thread(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.message_threads thread
    where thread.id = p_thread_id
      and (
        app.message_staff_reads_matter(thread.matter_id, thread.organization_id)
        or app.message_thread_person_for_me(thread.id) is not null
      )
  );
$$;
revoke all on function app.can_read_message_thread(uuid) from public;
grant execute on function app.can_read_message_thread(uuid) to authenticated, service_role;

alter table public.message_threads enable row level security;
alter table public.message_threads force row level security;
alter table public.message_thread_people enable row level security;
alter table public.message_thread_people force row level security;
alter table public.matter_messages enable row level security;
alter table public.matter_messages force row level security;
alter table public.matter_message_attachments enable row level security;
alter table public.matter_message_attachments force row level security;
alter table public.matter_message_receipts enable row level security;
alter table public.matter_message_receipts force row level security;
alter table public.matter_staff_notes enable row level security;
alter table public.matter_staff_notes force row level security;

revoke all on public.message_threads from public, anon, authenticated;
revoke all on public.message_thread_people from public, anon, authenticated;
revoke all on public.matter_messages from public, anon, authenticated;
revoke all on public.matter_message_attachments from public, anon, authenticated;
revoke all on public.matter_message_receipts from public, anon, authenticated;
revoke all on public.matter_staff_notes from public, anon, authenticated;
grant select on public.message_threads to authenticated;
grant select on public.message_thread_people to authenticated;
grant select on public.matter_messages to authenticated;
grant select on public.matter_message_attachments to authenticated;
grant select on public.matter_message_receipts to authenticated;
grant select on public.matter_staff_notes to authenticated;
grant select, insert, update on public.message_threads to service_role;
grant select, insert on public.message_thread_people to service_role;
grant select, insert on public.matter_messages to service_role;
grant select, insert on public.matter_message_attachments to service_role;
grant select, insert, update on public.matter_message_receipts to service_role;
grant select, insert on public.matter_staff_notes to service_role;

create policy message_threads_select on public.message_threads
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and app.can_read_message_thread(id));
create policy message_thread_people_select on public.message_thread_people
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and app.can_read_message_thread(thread_id));
create policy matter_messages_select on public.matter_messages
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and app.can_read_message_thread(thread_id));
create policy matter_message_attachments_select on public.matter_message_attachments
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.matter_messages message
      where message.id = message_id and app.can_read_message_thread(message.thread_id)
    )
  );
-- A reader sees their own receipts; staff on the matter see everyone's (read and acknowledged).
create policy matter_message_receipts_select on public.matter_message_receipts
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (
      user_id = (select auth.uid())
      or exists (
        select 1 from public.matter_messages message
        where message.id = message_id
          and app.message_staff_reads_matter(message.matter_id, message.organization_id)
      )
    )
  );
create policy matter_staff_notes_select on public.matter_staff_notes
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and app.message_staff_reads_matter(matter_id, organization_id)
  );
-- Belt and braces, as for the other staff-internal matter rows: no portal role, ever.
create policy matter_staff_notes_staff_only on public.matter_staff_notes
  as restrictive
  for select
  to authenticated
  using (
    (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

create function public.send_matter_message(
  p_organization_id uuid,
  p_matter_id uuid,
  p_thread_id uuid,
  p_person_ids uuid[],
  p_body text,
  p_requires_ack boolean default false,
  p_document_ids uuid[] default null,
  p_client_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  matter public.matters%rowtype;
  staff boolean;
  me uuid;
  membership uuid;
  thread public.message_threads%rowtype;
  people uuid[];
  key text;
  text_body text := btrim(coalesce(p_body, ''));
  existing public.matter_messages%rowtype;
  mid uuid;
  doc record;
  docs uuid[] := coalesce(p_document_ids, array[]::uuid[]);
  recent integer;
  daily integer;
begin
  if actor is null or app.in_active_org(p_organization_id) is distinct from true then
    raise exception 'message denied' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = p_matter_id and organization_id = p_organization_id;
  if matter.id is null then
    raise exception 'message denied' using errcode = '42501';
  end if;

  staff := app.message_staff_reads_matter(matter.id, matter.organization_id);
  if staff then
    select m.id into membership
    from public.memberships m
    where m.organization_id = matter.organization_id and m.user_id = actor and m.status = 'active'
      and m.role = any (array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[])
    order by m.created_at
    limit 1;
  else
    select person.id into me
    from public.persons person
    join public.matter_participants party
      on party.person_id = person.id
     and party.organization_id = person.organization_id
     and party.matter_id = matter.id
    where person.organization_id = matter.organization_id
      and person.user_id = actor
    limit 1;
    if me is null then
      raise exception 'message denied' using errcode = '42501';
    end if;
  end if;

  if length(text_body) < 1 or length(text_body) > 4000 then
    raise exception 'message text must be 1 to 4000 characters' using errcode = '22023';
  end if;
  if coalesce(p_requires_ack, false) and not staff then
    raise exception 'only staff can ask for an acknowledgement' using errcode = '42501';
  end if;
  if coalesce(array_length(docs, 1), 0) > 5 then
    raise exception 'attach at most 5 documents' using errcode = '22023';
  end if;

  -- A retried send returns the message it already made.
  if p_client_key is not null then
    select * into existing from public.matter_messages
    where organization_id = matter.organization_id and author_user_id = actor and client_key = p_client_key;
    if existing.id is not null then
      return jsonb_build_object('message_id', existing.id, 'thread_id', existing.thread_id, 'replayed', true);
    end if;
  end if;

  -- Rate limits (per sender).
  select count(*) filter (where created_at > clock_timestamp() - interval '10 minutes'),
         count(*) filter (where created_at > clock_timestamp() - interval '1 day')
    into recent, daily
  from public.matter_messages
  where author_user_id = actor
    and created_at > clock_timestamp() - interval '1 day';
  if (staff and recent >= 60) or (not staff and (recent >= 10 or daily >= 100)) then
    perform app.record_audit_event(matter.organization_id, 'message.rate_limited', 'public.matters', matter.id, 'denied',
      jsonb_build_object('author_kind', case when staff then 'staff' else 'client' end));
    raise exception 'message rate limit reached' using errcode = '54000';
  end if;

  if p_thread_id is not null then
    select * into thread from public.message_threads
    where id = p_thread_id and organization_id = matter.organization_id and matter_id = matter.id;
    if thread.id is null
       or (not staff and app.message_thread_person_for_me(thread.id) is distinct from me) then
      raise exception 'message denied' using errcode = '42501';
    end if;
  else
    if staff then
      select array_agg(distinct id order by id) into people from unnest(coalesce(p_person_ids, array[]::uuid[])) as id;
      if people is null or array_length(people, 1) < 1 or array_length(people, 1) > 20 then
        raise exception 'choose who can read this message' using errcode = '22023';
      end if;
      if exists (
        select 1 from unnest(people) as pid
        where not exists (
          select 1 from public.matter_participants party
          where party.matter_id = matter.id and party.organization_id = matter.organization_id and party.person_id = pid
        )
      ) then
        raise exception 'everyone in the audience must be on this matter' using errcode = '22023';
      end if;
    else
      -- A client starts a conversation with the firm only: just themselves.
      if p_person_ids is not null and p_person_ids is distinct from array[me] then
        raise exception 'clients write to the firm only' using errcode = '42501';
      end if;
      people := array[me];
    end if;
    key := array_to_string(people, ',');
    select * into thread from public.message_threads where matter_id = matter.id and audience_key = key;
    if thread.id is null then
      insert into public.message_threads (organization_id, matter_id, audience_key, is_sample, created_by)
      values (matter.organization_id, matter.id, key, matter.is_sample, actor)
      on conflict (matter_id, audience_key) do nothing
      returning * into thread;
      if thread.id is null then
        select * into thread from public.message_threads where matter_id = matter.id and audience_key = key;
      else
        insert into public.message_thread_people (thread_id, organization_id, person_id)
        select thread.id, thread.organization_id, pid from unnest(people) as pid;
      end if;
    end if;
  end if;

  select array_agg(tp.person_id order by tp.person_id) into people
  from public.message_thread_people tp where tp.thread_id = thread.id;

  -- Attachments: on this matter, readable by the sender, and by everyone in the audience.
  for doc in
    select d.id, d.person_id, d.audience, d.sensitivity
    from public.documents d
    where d.id = any (docs)
  loop
    if doc.audience = 'staff'
       or not exists (
         select 1 from public.document_matter_refs ref
         where ref.document_id = doc.id and ref.matter_id = matter.id and ref.removed_at is null
       )
       or app.can_read_document(doc.id) is distinct from true
       or exists (
         select 1 from unnest(people) as pid
         where pid is distinct from doc.person_id
           and not (doc.audience = 'matter' and doc.sensitivity = 'ordinary')
       ) then
      raise exception 'a document in this message is not shared with everyone who can read it' using errcode = '42501';
    end if;
  end loop;
  if (select count(*) from public.documents d where d.id = any (docs) and d.organization_id = matter.organization_id)
     <> (select count(distinct x) from unnest(docs) as x) then
    raise exception 'a document in this message is not shared with everyone who can read it' using errcode = '42501';
  end if;

  insert into public.matter_messages (
    organization_id, thread_id, matter_id, author_user_id, author_kind, author_person_id,
    author_membership_id, author_name, body, requires_ack, client_key
  ) values (
    matter.organization_id, thread.id, matter.id, actor, case when staff then 'staff' else 'client' end, me,
    membership,
    left(coalesce(
      case when staff
        then (select nullif(btrim(profile.display_name), '') from public.profiles profile where profile.id = actor)
        else (select person.display_name from public.persons person where person.id = me)
      end,
      case when staff then 'Staff' else 'Client' end
    ), 200),
    text_body, coalesce(p_requires_ack, false), p_client_key
  )
  returning id into mid;

  insert into public.matter_message_attachments (organization_id, message_id, document_id)
  select matter.organization_id, mid, x from (select distinct x from unnest(docs) as x) d;

  insert into public.matter_message_receipts (message_id, organization_id, user_id, person_id, read_at)
  values (mid, matter.organization_id, actor, me, clock_timestamp());

  update public.message_threads set last_message_at = clock_timestamp() where id = thread.id;

  -- HOOK(i18n/translate): a "Draft in French" helper (src/modules/i18n/translate.ts, another
  -- branch) prepares the text before this call. Nothing here translates; the stored body is
  -- exactly what the sender approved.

  if staff then
    perform app.enqueue_event(
      matter.organization_id, 'message', mid, 'message.sent',
      jsonb_build_object('message_id', mid, 'thread_id', thread.id, 'matter_id', matter.id),
      null, 'message.sent:' || mid::text, null
    );
  end if;

  perform app.record_audit_event(matter.organization_id, 'message.sent', 'public.matter_messages', mid, 'success',
    jsonb_build_object(
      'author_kind', case when staff then 'staff' else 'client' end,
      'thread_id', thread.id,
      'audience', coalesce(array_length(people, 1), 0),
      'attachments', coalesce(array_length(docs, 1), 0),
      'requires_ack', coalesce(p_requires_ack, false)
    ));
  return jsonb_build_object('message_id', mid, 'thread_id', thread.id, 'replayed', false);
end;
$$;

create function public.mark_message_thread_read(p_organization_id uuid, p_thread_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  thread public.message_threads%rowtype;
  me uuid;
  n integer;
begin
  select * into thread from public.message_threads where id = p_thread_id and organization_id = p_organization_id;
  if actor is null or thread.id is null or app.can_read_message_thread(thread.id) is distinct from true then
    raise exception 'message denied' using errcode = '42501';
  end if;
  me := app.message_thread_person_for_me(thread.id);
  insert into public.matter_message_receipts (message_id, organization_id, user_id, person_id, read_at)
  select message.id, message.organization_id, actor, me, clock_timestamp()
  from public.matter_messages message
  where message.thread_id = thread.id
    and message.author_user_id <> actor
  on conflict (message_id, user_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

create function public.acknowledge_matter_message(p_organization_id uuid, p_message_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  message public.matter_messages%rowtype;
  me uuid;
  acked timestamptz;
begin
  select * into message from public.matter_messages where id = p_message_id and organization_id = p_organization_id;
  if actor is null or message.id is null or app.in_active_org(message.organization_id) is distinct from true then
    raise exception 'message denied' using errcode = '42501';
  end if;
  me := app.message_thread_person_for_me(message.thread_id);
  if me is null then
    raise exception 'only someone the message is addressed to can acknowledge it' using errcode = '42501';
  end if;
  if not message.requires_ack then
    raise exception 'this message does not ask for an acknowledgement' using errcode = '22023';
  end if;
  insert into public.matter_message_receipts (message_id, organization_id, user_id, person_id, read_at, acknowledged_at)
  values (message.id, message.organization_id, actor, me, clock_timestamp(), clock_timestamp())
  on conflict (message_id, user_id) do update
    set acknowledged_at = coalesce(public.matter_message_receipts.acknowledged_at, excluded.acknowledged_at),
        person_id = coalesce(public.matter_message_receipts.person_id, excluded.person_id)
  returning acknowledged_at into acked;
  perform app.record_audit_event(message.organization_id, 'message.acknowledged', 'public.matter_messages', message.id, 'success',
    jsonb_build_object('person_id', me));
  return acked;
end;
$$;

create function public.add_matter_staff_note(p_organization_id uuid, p_matter_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  membership uuid;
  nid uuid;
  text_body text := btrim(coalesce(p_body, ''));
begin
  if actor is null or app.message_staff_reads_matter(p_matter_id, p_organization_id) is distinct from true then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  if length(text_body) < 1 or length(text_body) > 4000 then
    raise exception 'note text must be 1 to 4000 characters' using errcode = '22023';
  end if;
  select m.id into membership from public.memberships m
  where m.organization_id = p_organization_id and m.user_id = actor and m.status = 'active'
    and m.role = any (array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[])
  order by m.created_at limit 1;
  insert into public.matter_staff_notes (organization_id, matter_id, author_user_id, author_membership_id, body)
  values (p_organization_id, p_matter_id, actor, membership, text_body)
  returning id into nid;
  perform app.record_audit_event(p_organization_id, 'matter.staff_note_added', 'public.matter_staff_notes', nid, 'success', '{}'::jsonb);
  return nid;
end;
$$;

revoke all on function public.send_matter_message(uuid, uuid, uuid, uuid[], text, boolean, uuid[], text) from public, anon;
revoke all on function public.mark_message_thread_read(uuid, uuid) from public, anon;
revoke all on function public.acknowledge_matter_message(uuid, uuid) from public, anon;
revoke all on function public.add_matter_staff_note(uuid, uuid, text) from public, anon;
grant execute on function public.send_matter_message(uuid, uuid, uuid, uuid[], text, boolean, uuid[], text) to authenticated;
grant execute on function public.mark_message_thread_read(uuid, uuid) to authenticated;
grant execute on function public.acknowledge_matter_message(uuid, uuid) to authenticated;
grant execute on function public.add_matter_staff_note(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Mail: EX07 generic notice for a staff message
-- ---------------------------------------------------------------------------

create or replace function public.claim_mail_events(p_worker text, p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_worker is null or length(btrim(p_worker)) < 1 then
    raise exception 'worker name is required' using errcode = '22023';
  end if;

  with due as (
    select c.id
    from public.outbox_events c
    where c.event_type = any (array[
      'portal_invitation.email_requested',
      'staff_invitation.email_requested',
      'reminder.due',
      'agreement.sent',
      'agreement.executed',
      -- firm countersign: a staff signer's turn.
      'agreement.signer_turn',
      'document.request_created',
      'document.uploaded',
      'document.reviewed',
      -- email designs: invoice, payment and refund mail.
      'invoice.issued',
      'invoice.payment_failed',
      'invoice.refund_started',
      'invoice.refund_succeeded',
      -- scheduling: consultation booked, moved, cancelled.
      'booking.confirmed',
      'booking.rescheduled',
      'booking.cancelled',
      -- matter messaging: EX07 generic notice of a staff message.
      'message.sent'
    ])
      and (
        (c.status in ('pending', 'failed') and c.available_at <= clock_timestamp())
        or (c.status = 'processing' and c.locked_at < clock_timestamp() - interval '5 minutes')
      )
      -- sealed invitation link: wait for it, or send the linkless email after 10 minutes.
      and (
        c.event_type not in ('portal_invitation.email_requested', 'staff_invitation.email_requested')
        or c.payload ? 'sealed_link'
        or c.occurred_at < clock_timestamp() - interval '10 minutes'
      )
    order by c.available_at, c.occurred_at
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
    for update skip locked
  ),
  locked as (
    update public.outbox_events event
       set status = 'processing',
           locked_at = clock_timestamp(),
           locked_by = left(btrim(p_worker), 200),
           attempts = event.attempts + 1
     where event.id in (select due.id from due)
    returning event.id, event.organization_id, event.event_type, event.payload, event.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', locked.id,
    'organization_id', locked.organization_id,
    'event_type', locked.event_type,
    'payload', locked.payload,
    'attempts', locked.attempts
  )), '[]'::jsonb)
  into claimed
  from locked;
  return claimed;
end;
$$;

create or replace function public.prepare_email_delivery(
  p_event_id uuid,
  p_worker text,
  p_inbound_domain text default null,
  p_from_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event public.outbox_events%rowtype;
  firm_name text;
  firm_slug text;
  domain text;
  from_addr text;
  matter uuid;
  template public.email_template;
  critical boolean;
  reply text;
  messages jsonb;
  rec record;
  send_ok boolean;
  ctx jsonb;
  inviter text;
  payer uuid;
  payer_known boolean;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  select * into event from public.outbox_events where id = p_event_id;
  if event.id is null then
    raise exception 'mail event was not found' using errcode = '42501';
  end if;
  if event.status = 'published' then
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;
  if event.status is distinct from 'processing'
     or event.locked_by is distinct from left(btrim(coalesce(p_worker, '')), 200) then
    raise exception 'mail event is not claimed' using errcode = '42501';
  end if;

  domain := app.inbound_domain(p_inbound_domain);
  from_addr := lower(btrim(coalesce(
    nullif(p_from_address, ''),
    (select value ->> 'address' from public.product_settings where key = 'email.from_address'),
    'notices@casevoya.ca'
  )));
  if from_addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    from_addr := 'notices@casevoya.ca';
  end if;
  select display_name, slug into firm_name, firm_slug
  from public.organizations
  where id = event.organization_id;

  matter := null;
  if coalesce(event.payload ->> 'matter_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    matter := (event.payload ->> 'matter_id')::uuid;
  end if;

  if event.event_type = 'document.reviewed'
     and coalesce(event.payload ->> 'decision', '') is distinct from 'accepted' then
    perform app.mark_outbox_published(event.id, p_worker);
    perform app.record_audit_event(
      event.organization_id, 'email.skipped', 'public.outbox_events', event.id, 'success',
      jsonb_build_object('reason', 'review_not_accepted')
    );
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;

  template := case event.event_type
    when 'portal_invitation.email_requested' then 'invite'::public.email_template
    when 'staff_invitation.email_requested' then 'invite'::public.email_template
    when 'reminder.due' then 'reminder'::public.email_template
    when 'agreement.sent' then 'agreement'::public.email_template
    when 'agreement.executed' then 'signature'::public.email_template
    -- firm countersign: the staff signer's turn uses the agreement template, staff copy.
    when 'agreement.signer_turn' then 'agreement'::public.email_template
    when 'document.request_created' then 'document_request'::public.email_template
    when 'document.uploaded' then 'document_receipt'::public.email_template
    when 'document.reviewed' then 'document_receipt'::public.email_template
    -- email designs: invoice, payment and refund mail.
    when 'invoice.issued' then 'invoice'::public.email_template
    when 'invoice.payment_failed' then 'payment_failed'::public.email_template
    when 'invoice.refund_started' then 'refund_started'::public.email_template
    when 'invoice.refund_succeeded' then 'refund_complete'::public.email_template
    -- scheduling: EM16a / EM16b / EM16c.
    when 'booking.confirmed' then 'consultation_booked'::public.email_template
    when 'booking.rescheduled' then 'consultation_rescheduled'::public.email_template
    when 'booking.cancelled' then 'consultation_cancelled'::public.email_template
    -- matter messaging: EX07, the generic "New message" notice.
    when 'message.sent' then 'message'::public.email_template
    else null
  end;
  if template is null then
    raise exception 'event is not a mail event' using errcode = '22023';
  end if;

  critical := template in ('invite', 'agreement', 'signature', 'document_request', 'document_receipt');
  ctx := jsonb_build_object('firm', firm_name, 'template', template);

  -- sealed invitation link: the worker decrypts it; it stays well under the 2000-byte context cap.
  if event.event_type in ('portal_invitation.email_requested', 'staff_invitation.email_requested')
     and length(coalesce(event.payload ->> 'sealed_link', '')) between 1 and 1024 then
    ctx := ctx || jsonb_build_object(
      'sealed_link', event.payload ->> 'sealed_link',
      'invitation_id', event.payload ->> 'invitation_id'
    );
  end if;

  if event.event_type = 'portal_invitation.email_requested' then
    ctx := ctx || jsonb_build_object('kind', 'portal', 'role', event.payload ->> 'role');
    -- email designs: who invited them, for the heading.
    select left(nullif(btrim(profile.display_name), ''), 120) into inviter
    from public.portal_invitations inv
    join public.profiles profile on profile.id = inv.created_by
    where inv.id::text = event.payload ->> 'invitation_id'
      and inv.organization_id = event.organization_id;
    if inviter is not null then
      ctx := ctx || jsonb_build_object('inviter', inviter);
    end if;
    perform app.queue_email_delivery(
      event.id, event.organization_id, event.payload ->> 'recipient_email',
      template, matter, true, ctx, true
    );
  elsif event.event_type = 'staff_invitation.email_requested' then
    ctx := ctx || jsonb_build_object('kind', 'staff', 'role', event.payload ->> 'role');
    -- email designs: who invited them, for the heading.
    select left(nullif(btrim(profile.display_name), ''), 120) into inviter
    from public.invitations inv
    join public.profiles profile on profile.id = inv.created_by
    where inv.id::text = event.payload ->> 'invitation_id'
      and inv.organization_id = event.organization_id;
    if inviter is not null then
      ctx := ctx || jsonb_build_object('inviter', inviter);
    end if;
    perform app.queue_email_delivery(
      event.id, event.organization_id, event.payload ->> 'recipient_email',
      template, null, true, ctx, true
    );
  elsif event.event_type = 'reminder.due' then
    critical := coalesce(event.payload ->> 'reminder_kind', '') = 'immediate'
      or exists (
        select 1
        from public.deadlines deadline
        where deadline.id::text = event.payload ->> 'deadline_id'
          and deadline.kind in ('legal', 'correspondence')
      );
    ctx := ctx || jsonb_build_object(
      'reminder_kind', coalesce(event.payload ->> 'reminder_kind', 'routine'),
      'due_on', (
        select to_char(deadline.due_on, 'YYYY-MM-DD')
        from public.deadlines deadline
        where deadline.id::text = event.payload ->> 'deadline_id'
      )
    );
    for rec in
      select person.email,
             coalesce(pref.deadline_reminders, false) as deadline_reminders,
             pref.email_notices as email_notices
      from public.persons person
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = matter
       and party.organization_id = event.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where person.organization_id = event.organization_id
        and person.email is not null
        and matter is not null
    loop
      send_ok := coalesce(event.payload ->> 'reminder_kind', '') = 'immediate'
        or (rec.deadline_reminders and rec.email_notices is distinct from false);
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, critical, ctx, send_ok
      );
    end loop;
  elsif event.event_type in ('agreement.sent', 'agreement.executed') then
    ctx := ctx || jsonb_build_object('agreement_kind', (
      select agreement.kind
      from public.signature_envelopes envelope
      join public.agreements agreement on agreement.id = envelope.agreement_id
      where envelope.id::text = event.payload ->> 'envelope_id'
    ));
    for rec in
      select lower(coalesce(person.email, users.email)) as email,
             signer.person_id is null as staff
      from public.envelope_signers signer
      left join public.persons person on person.id = signer.person_id
      left join public.memberships membership on membership.id = signer.membership_id
      left join auth.users users on users.id = membership.user_id
      where signer.envelope_id::text = event.payload ->> 'envelope_id'
        and signer.organization_id = event.organization_id
        -- firm countersign: staff signers hear when it is their turn (agreement.signer_turn), not at send.
        and (event.event_type = 'agreement.executed' or signer.person_id is not null)
    loop
      -- email designs: a staff signer's executed copy links to the Sheet, not the portal.
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, true,
        case when rec.staff then ctx || jsonb_build_object('audience', 'staff') else ctx end,
        true
      );
    end loop;
  -- firm countersign: the staff signer whose turn it is, while it still is, gets the Sheet link.
  elsif event.event_type = 'agreement.signer_turn' then
    ctx := ctx || jsonb_build_object(
      'audience', 'staff',
      'agreement_kind', (
        select agreement.kind
        from public.signature_envelopes envelope
        join public.agreements agreement on agreement.id = envelope.agreement_id
        where envelope.id::text = event.payload ->> 'envelope_id'
      )
    );
    for rec in
      select lower(users.email) as email
      from public.envelope_signers signer
      join public.signature_envelopes envelope
        on envelope.id = signer.envelope_id
       and envelope.organization_id = signer.organization_id
      join public.memberships membership
        on membership.id = signer.membership_id
       and membership.organization_id = signer.organization_id
       and membership.status = 'active'
      join auth.users users on users.id = membership.user_id
      where signer.id::text = event.payload ->> 'signer_id'
        and signer.envelope_id::text = event.payload ->> 'envelope_id'
        and signer.organization_id = event.organization_id
        and signer.status = 'current'
        and envelope.status in ('sent', 'partially_signed')
        and envelope.expires_at > statement_timestamp()
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, true, ctx, true
      );
    end loop;
  elsif event.event_type = 'document.request_created' then
    -- email designs: the due date only; the request's purpose names the document and stays out of mail.
    ctx := ctx || jsonb_build_object('due_on', event.payload ->> 'due_on');
    perform app.queue_email_delivery(
      event.id, event.organization_id,
      (select person.email from public.persons person where person.id::text = event.payload ->> 'person_id'),
      template, matter, true, ctx, true
    );
  elsif event.event_type in ('document.uploaded', 'document.reviewed') then
    ctx := ctx || jsonb_build_object(
      'status', case when event.event_type = 'document.reviewed' then 'accepted' else 'received' end
    );
    perform app.queue_email_delivery(
      event.id, event.organization_id,
      (
        select person.email
        from public.documents doc
        join public.persons person on person.id = doc.person_id
        where doc.id::text = event.payload ->> 'document_id'
      ),
      template, matter, true, ctx, true
    );
  -- email designs: invoice, payment and refund mail to the payer, else the matter's applicants.
  elsif event.event_type in ('invoice.issued', 'invoice.payment_failed', 'invoice.refund_started', 'invoice.refund_succeeded') then
    ctx := ctx || coalesce((
      select jsonb_build_object(
        'invoice_id', invoice.id,
        'invoice_number', invoice.number,
        'due_on', to_char(invoice.due_on, 'YYYY-MM-DD')
      )
      from public.invoices invoice
      where invoice.id::text = event.payload ->> 'invoice_id'
        and invoice.organization_id = event.organization_id
    ), '{}'::jsonb);
    payer := null;
    if event.event_type <> 'invoice.issued' then
      select payment.created_by into payer
      from public.invoice_payments payment
      where payment.id::text = event.payload ->> 'payment_id'
        and payment.organization_id = event.organization_id;
    end if;
    payer_known := payer is not null and matter is not null and exists (
      select 1
      from public.persons person
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = matter
       and party.organization_id = event.organization_id
      where person.user_id = payer
        and person.organization_id = event.organization_id
        and person.email is not null
    );
    for rec in
      select lower(person.email) as email,
             bool_or(pref.email_notices is distinct from false) as email_notices
      from public.matter_participants party
      join public.persons person
        on person.id = party.person_id
       and person.organization_id = party.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where party.matter_id = matter
        and party.organization_id = event.organization_id
        and person.email is not null
        and matter is not null
        and case when payer_known then person.user_id = payer else party.role = 'applicant' end
      group by lower(person.email)
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, false, ctx, rec.email_notices
      );
    end loop;
  -- scheduling: the booking's primary attendee, with the time in their own zone. A booking that
  -- moved again or was cancelled since this event was queued is not mailed with a stale time.
  elsif event.event_type in ('booking.confirmed', 'booking.rescheduled', 'booking.cancelled') then
    for rec in
      select attendee.email,
             attendee.time_zone,
             booking.host_name,
             booking.status,
             booking.starts_at,
             booking.location_kind,
             booking.location_detail,
             booking.is_sample,
             -- booking mail: a portal button only for an attendee whose person can sign in.
             (person.id is not null and person.user_id is not null) as portal,
             pref.email_notices is distinct from false as email_notices
      from public.bookings booking
      join public.booking_attendees attendee
        on attendee.booking_id = booking.id
       and attendee.organization_id = booking.organization_id
       and attendee.role = 'primary'
      left join public.persons person
        on person.id = attendee.person_id
       and person.organization_id = attendee.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = attendee.person_id
      where booking.id::text = event.payload ->> 'booking_id'
        and booking.organization_id = event.organization_id
    loop
      ctx := ctx || jsonb_build_object(
        'starts_at', coalesce(event.payload ->> 'starts_at', to_char(rec.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
        'time_zone', rec.time_zone,
        'portal', rec.portal
      );
      if event.event_type = 'booking.confirmed' and rec.host_name is not null then
        ctx := ctx || jsonb_build_object('consultant_name', rec.host_name);
      end if;
      -- booking mail: how they meet; the address only for an in-person meeting, never a link.
      if event.event_type = 'booking.confirmed' then
        ctx := ctx || jsonb_build_object('location_kind', rec.location_kind);
        if rec.location_kind = 'in_person' and nullif(btrim(coalesce(rec.location_detail, '')), '') is not null then
          ctx := ctx || jsonb_build_object('address', left(btrim(rec.location_detail), 300));
        end if;
      end if;
      -- booking mail: without a portal, a cancellation points to the firm's booking page when the
      -- firm has a published free one this attendee can use (a practice one for a sample booking).
      if event.event_type = 'booking.cancelled' and not rec.portal and firm_slug is not null and exists (
        select 1 from public.booking_event_types et
        where et.organization_id = event.organization_id
          and et.is_published and et.archived_at is null and et.price_cents = 0
          and (not et.is_sample or rec.is_sample)
      ) then
        ctx := ctx || jsonb_build_object('booking_page', firm_slug);
      end if;
      send_ok := rec.email_notices and case event.event_type
        when 'booking.cancelled' then rec.status = 'cancelled'
        else rec.status = 'confirmed' and rec.starts_at = (event.payload ->> 'starts_at')::timestamptz
      end;
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, send_ok
      );
    end loop;
  -- matter messaging: each person the thread is addressed to, firm name only (never the text).
  -- A critical instruction (requires_ack) is a critical notice, so a bounce opens a staff task.
  elsif event.event_type = 'message.sent' then
    critical := coalesce((
      select message.requires_ack from public.matter_messages message
      where message.id::text = event.payload ->> 'message_id'
        and message.organization_id = event.organization_id
    ), false);
    for rec in
      select lower(person.email) as email,
             bool_or(pref.email_notices is distinct from false) as email_notices
      from public.matter_messages message
      join public.message_thread_people tp
        on tp.thread_id = message.thread_id
       and tp.organization_id = message.organization_id
      join public.persons person
        on person.id = tp.person_id
       and person.organization_id = tp.organization_id
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = message.matter_id
       and party.organization_id = message.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where message.id::text = event.payload ->> 'message_id'
        and message.organization_id = event.organization_id
        and person.email is not null
      group by lower(person.email)
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, critical, ctx, rec.email_notices
      );
    end loop;
  end if;

  if not exists (
    select 1 from public.email_deliveries delivery
    where delivery.outbox_event_id = event.id
      and delivery.status = 'sending'
  ) then
    perform app.mark_outbox_published(event.id, p_worker);
    -- sealed invitation link: nothing will be sent, so nothing needs it.
    perform app.scrub_invitation_link(event.id);
    perform app.record_audit_event(
      event.organization_id, 'email.skipped', 'public.outbox_events', event.id, 'success',
      jsonb_build_object('template', template, 'reason', 'no_recipient')
    );
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;

  reply := app.firm_reply_address(event.organization_id, matter, domain);
  select coalesce(jsonb_agg(jsonb_build_object(
    'delivery_id', delivery.id,
    'to', delivery.recipient_email,
    'from_address', from_addr,
    'from_name', firm_name,
    'reply_to_address', reply,
    'reply_to_name', firm_name,
    'template', delivery.template,
    'context', delivery.context
  )), '[]'::jsonb)
  into messages
  from public.email_deliveries delivery
  where delivery.outbox_event_id = event.id
    and delivery.status = 'sending';

  return jsonb_build_object('action', 'send', 'event_id', event.id, 'messages', messages);
end;
$$;

revoke all on function public.claim_mail_events(text, integer) from public, anon, authenticated;
revoke all on function public.prepare_email_delivery(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_mail_events(text, integer) to service_role;
grant execute on function public.prepare_email_delivery(uuid, text, text, text) to service_role;
