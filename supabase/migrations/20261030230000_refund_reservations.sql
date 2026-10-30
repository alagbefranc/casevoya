-- Card refunds reserve their amount before Stripe is called (FIN-13).
--
-- The refundable cap (app.payment_refundable_cents, latest 20261030160000) counts recorded refunds
-- only, and a refund is recorded after Stripe answers. Now the server first reserves the amount:
--
--   app.reserve_invoice_refund          locks the invoice, then the payment (the order
--                                       app.record_invoice_refund and app.apply_stripe_reversal_event
--                                       use), and admits the amount only if it fits the refundable
--                                       cap less the other active reservations. One reservation per
--                                       (firm, idempotency key); the same key is Stripe's Idempotency-Key.
--   app.link_invoice_refund_reservation after Stripe answers: ties the reservation to the Stripe refund id.
--   app.release_invoice_refund_reservation  after Stripe refuses: frees the amount.
--
-- A reservation is active while 'linked', or 'pending' and not expired (15 minutes, so an
-- interrupted request does not hold the amount forever). When the refund row is recorded (by
-- app.record_invoice_refund or by Stripe's event in app.apply_stripe_reversal_event), a trigger on
-- invoice_refunds marks the matching reservation 'consumed' (matched by Stripe refund id or by the
-- idempotency key), so the amount is counted once: by the refund row.
--
-- app.record_invoice_refund (latest 20261030160000) is copied unchanged except that it checks the
-- cap less the other active reservations, and refuses a key whose reservation is for another
-- payment, amount or refund. Additive only.

create table if not exists public.invoice_refund_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  invoice_id uuid not null,
  payment_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 99999999999),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  idempotency_key text not null check (length(idempotency_key) between 8 and 180),
  status text not null default 'pending' check (status in ('pending', 'linked', 'consumed', 'released')),
  refund_id text unique check (refund_id is null or refund_id ~ '^(re|pyr)_[A-Za-z0-9]{6,250}$'),
  invoice_refund_id uuid,
  expires_at timestamptz not null,
  requested_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  check (status <> 'linked' or refund_id is not null),
  check (status <> 'consumed' or invoice_refund_id is not null),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id),
  foreign key (payment_id, organization_id) references public.invoice_payments (id, organization_id),
  foreign key (invoice_refund_id, organization_id) references public.invoice_refunds (id, organization_id)
);
comment on table public.invoice_refund_reservations is
  'A card refund amount held between the cap check and Stripe''s answer (FIN-13). Server functions only.';

create index if not exists invoice_refund_reservations_invoice_org_fk_idx on public.invoice_refund_reservations (invoice_id, organization_id);
create index if not exists invoice_refund_reservations_payment_org_fk_idx on public.invoice_refund_reservations (payment_id, organization_id);
create index if not exists invoice_refund_reservations_refund_org_fk_idx on public.invoice_refund_reservations (invoice_refund_id, organization_id);
create index if not exists invoice_refund_reservations_requested_by_idx on public.invoice_refund_reservations (requested_by);

revoke all on table public.invoice_refund_reservations from public, anon, authenticated, service_role;
alter table public.invoice_refund_reservations enable row level security;
alter table public.invoice_refund_reservations force row level security;

create trigger invoice_refund_reservations_no_delete before delete on public.invoice_refund_reservations
  for each row execute function app.reject_governed_delete();

-- The refundable cap less active reservations, other than p_exclude_reservation.
create or replace function app.payment_reservable_cents(p_payment_id uuid, p_exclude_reservation uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    least(
      payment.amount_received_cents - coalesce((
        select sum(refund.amount_cents)
        from public.invoice_refunds refund
        where refund.payment_id = payment.id
          and refund.status in ('pending', 'requires_action', 'succeeded')
      ), 0) - coalesce((
        select sum(held.amount_cents)
        from public.invoice_refund_reservations held
        where held.payment_id = payment.id
          and held.id is distinct from p_exclude_reservation
          and (held.status = 'linked' or (held.status = 'pending' and held.expires_at > now()))
      ), 0),
      invoice.paid_cents - invoice.refunded_cents - coalesce((
        select sum(refund.amount_cents)
        from public.invoice_refunds refund
        where refund.invoice_id = invoice.id
          and refund.status in ('pending', 'requires_action')
      ), 0) - coalesce((
        select sum(held.amount_cents)
        from public.invoice_refund_reservations held
        where held.invoice_id = invoice.id
          and held.id is distinct from p_exclude_reservation
          and (held.status = 'linked' or (held.status = 'pending' and held.expires_at > now()))
      ), 0)
    ),
    0
  )::bigint
  from public.invoice_payments payment
  join public.invoices invoice on invoice.id = payment.invoice_id
  where payment.id = p_payment_id;
$$;
revoke all on function app.payment_reservable_cents(uuid, uuid) from public, anon, authenticated;

-- A recorded refund consumes its reservation (by Stripe refund id, or by the idempotency key).
create or replace function app.consume_invoice_refund_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.invoice_refund_reservations held
  set status = 'consumed',
      refund_id = coalesce(held.refund_id, new.refund_id),
      invoice_refund_id = new.id,
      updated_at = now()
  where held.payment_id = new.payment_id
    and held.status <> 'consumed'
    and (
      held.refund_id = new.refund_id
      or (held.refund_id is null and new.idempotency_key is not null
          and held.organization_id = new.organization_id and held.idempotency_key = new.idempotency_key)
    );
  return null;
end;
$function$;
revoke all on function app.consume_invoice_refund_reservation() from public, anon, authenticated;

create trigger invoice_refunds_consume_reservation after insert or update of idempotency_key on public.invoice_refunds
  for each row execute function app.consume_invoice_refund_reservation();

create or replace function app.reserve_invoice_refund(p_payment_id uuid, p_amount_cents bigint, p_currency text, p_livemode boolean, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payment public.invoice_payments%rowtype;
  existing public.invoice_refund_reservations%rowtype;
  key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  rid uuid;
begin
  payment := app.require_refund_access(p_payment_id);
  -- Same lock order as app.record_invoice_refund: invoice, then payment.
  perform 1 from public.invoices where id = payment.invoice_id for update;
  select * into payment from public.invoice_payments where id = payment.id for update;
  if p_livemode is null or payment.livemode is distinct from p_livemode then
    raise exception 'this payment was made in the other Stripe mode' using errcode = '22023';
  end if;
  if key is null or length(key) not between 8 and 180 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  if payment.status <> 'succeeded' or payment.amount_received_cents <= 0 then
    raise exception 'only a received card payment can be refunded' using errcode = '22023';
  end if;
  if upper(btrim(coalesce(p_currency, ''))) <> payment.currency then
    raise exception 'refund currency does not match the payment' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'refund amount must be positive' using errcode = '22023';
  end if;

  select * into existing from public.invoice_refund_reservations
  where organization_id = payment.organization_id and idempotency_key = key
  for update;
  if existing.id is not null then
    if existing.payment_id <> payment.id then
      raise exception 'idempotency key was used for another refund' using errcode = '23505';
    end if;
    if existing.status in ('linked', 'consumed') then
      -- Stripe already answered this key; a retry gets the same refund back.
      if existing.amount_cents <> p_amount_cents then
        raise exception 'idempotency key was used for another refund' using errcode = '23505';
      end if;
      return existing.id;
    end if;
    if existing.status = 'pending' and existing.expires_at > now() then
      raise exception 'refund is already in progress' using errcode = '55000';
    end if;
  end if;

  if p_amount_cents > app.payment_reservable_cents(payment.id, existing.id) then
    raise exception 'refund exceeds the amount received' using errcode = '22023';
  end if;

  if existing.id is not null then
    -- A released or expired reservation of this key is held again.
    update public.invoice_refund_reservations
    set amount_cents = p_amount_cents,
        status = 'pending',
        expires_at = now() + interval '15 minutes',
        requested_by = (select auth.uid()),
        updated_at = now()
    where id = existing.id;
    return existing.id;
  end if;

  insert into public.invoice_refund_reservations (
    organization_id, invoice_id, payment_id, amount_cents, currency, idempotency_key, status, expires_at, requested_by
  ) values (
    payment.organization_id, payment.invoice_id, payment.id, p_amount_cents, payment.currency, key, 'pending',
    now() + interval '15 minutes', (select auth.uid())
  )
  returning id into rid;
  return rid;
end;
$function$;
revoke all on function app.reserve_invoice_refund(uuid, bigint, text, boolean, text) from public, anon;
grant execute on function app.reserve_invoice_refund(uuid, bigint, text, boolean, text) to authenticated;

create or replace function app.link_invoice_refund_reservation(p_reservation_id uuid, p_refund_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  held public.invoice_refund_reservations%rowtype;
  recorded public.invoice_refunds%rowtype;
  refund_key text := btrim(coalesce(p_refund_id, ''));
begin
  select * into held from public.invoice_refund_reservations where id = p_reservation_id;
  if held.id is null then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  perform app.require_refund_access(held.payment_id);
  if refund_key !~ '^(re|pyr)_[A-Za-z0-9]{6,250}$' then
    raise exception 'stripe refund id is invalid' using errcode = '22023';
  end if;
  perform 1 from public.invoices where id = held.invoice_id for update;
  select * into held from public.invoice_refund_reservations where id = p_reservation_id for update;
  if held.refund_id is not null then
    if held.refund_id <> refund_key then
      raise exception 'refund belongs to another payment' using errcode = '42501';
    end if;
    return;
  end if;
  if held.status = 'consumed' then
    return;
  end if;
  select * into recorded from public.invoice_refunds where refund_id = refund_key;
  if recorded.id is not null then
    if recorded.payment_id <> held.payment_id then
      raise exception 'refund belongs to another payment' using errcode = '42501';
    end if;
    -- Stripe's event recorded it first: the refund row already counts it.
    update public.invoice_refund_reservations
    set status = 'consumed', refund_id = refund_key, invoice_refund_id = recorded.id, updated_at = now()
    where id = held.id;
    return;
  end if;
  update public.invoice_refund_reservations
  set status = 'linked', refund_id = refund_key, updated_at = now()
  where id = held.id;
end;
$function$;
revoke all on function app.link_invoice_refund_reservation(uuid, text) from public, anon;
grant execute on function app.link_invoice_refund_reservation(uuid, text) to authenticated;

create or replace function app.release_invoice_refund_reservation(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  held public.invoice_refund_reservations%rowtype;
begin
  select * into held from public.invoice_refund_reservations where id = p_reservation_id;
  if held.id is null then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
  perform app.require_refund_access(held.payment_id);
  -- Only a reservation Stripe has not answered with a refund is freed.
  update public.invoice_refund_reservations
  set status = 'released', updated_at = now()
  where id = held.id and status = 'pending' and refund_id is null;
end;
$function$;
revoke all on function app.release_invoice_refund_reservation(uuid) from public, anon;
grant execute on function app.release_invoice_refund_reservation(uuid) to authenticated;

create or replace function app.record_invoice_refund(p_payment_id uuid, p_refund_id text, p_amount_cents bigint, p_currency text, p_reason text, p_livemode boolean, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payment public.invoice_payments%rowtype;
  existing public.invoice_refunds%rowtype;
  held public.invoice_refund_reservations%rowtype;
  refund_key text := btrim(coalesce(p_refund_id, ''));
  key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  refund_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  next_number integer;
  rid uuid;
begin
  payment := app.require_refund_access(p_payment_id);
  -- One refund decision at a time per invoice (then payment), so two requests cannot both pass
  -- the limit, and a credit move on the invoice cannot interleave with the check.
  perform 1 from public.invoices where id = payment.invoice_id for update;
  select * into payment from public.invoice_payments where id = payment.id for update;
  if p_livemode is null or payment.livemode is distinct from p_livemode then
    raise exception 'this payment was made in the other Stripe mode' using errcode = '22023';
  end if;
  if refund_key !~ '^(re|pyr)_[A-Za-z0-9]{6,250}$' then
    raise exception 'stripe refund id is invalid' using errcode = '22023';
  end if;
  if key is not null and length(key) not between 8 and 180 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  if refund_reason is not null and refund_reason not in ('duplicate', 'fraudulent', 'requested_by_customer') then
    raise exception 'refund reason is not one Stripe accepts' using errcode = '22023';
  end if;

  select * into existing from public.invoice_refunds where refund_id = refund_key;
  if existing.id is not null then
    if existing.payment_id <> payment.id then
      raise exception 'refund belongs to another payment' using errcode = '42501';
    end if;
    -- The webhook may have recorded it first; keep who asked and why.
    if existing.requested_by is null then
      update public.invoice_refunds
      set requested_by = (select auth.uid()),
          reason = coalesce(existing.reason, refund_reason),
          idempotency_key = coalesce(existing.idempotency_key, key)
      where id = existing.id;
    end if;
    return existing.id;
  end if;
  if key is not null then
    select * into existing from public.invoice_refunds where organization_id = payment.organization_id and idempotency_key = key;
    if existing.id is not null then
      raise exception 'idempotency key was used for another refund' using errcode = '23505';
    end if;
  end if;

  -- New: this refund's own reservation (by Stripe refund id, else by key) is not counted against it.
  select * into held from public.invoice_refund_reservations where refund_id = refund_key for update;
  if held.id is null and key is not null then
    select * into held from public.invoice_refund_reservations
    where organization_id = payment.organization_id and idempotency_key = key
    for update;
  end if;
  if held.id is not null and (
       held.payment_id <> payment.id
       or held.amount_cents <> p_amount_cents
       or (held.refund_id is not null and held.refund_id <> refund_key)
     ) then
    raise exception 'idempotency key was used for another refund' using errcode = '23505';
  end if;

  if payment.status <> 'succeeded' or payment.amount_received_cents <= 0 then
    raise exception 'only a received card payment can be refunded' using errcode = '22023';
  end if;
  if upper(btrim(coalesce(p_currency, ''))) <> payment.currency then
    raise exception 'refund currency does not match the payment' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'refund amount must be positive' using errcode = '22023';
  end if;
  if p_amount_cents > app.payment_reservable_cents(payment.id, held.id) then
    raise exception 'refund exceeds the amount received' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('casevoya.refund_number:' || payment.organization_id::text, 0));
  select coalesce(max(substring(refund.number from 4)::integer), 0) + 1 into next_number
  from public.invoice_refunds refund
  where refund.organization_id = payment.organization_id;

  insert into public.invoice_refunds (
    organization_id, invoice_id, payment_id, number, refund_id, connected_account_id,
    amount_cents, currency, reason, status, livemode, idempotency_key, requested_by
  ) values (
    payment.organization_id, payment.invoice_id, payment.id, 'RF-' || lpad(next_number::text, 4, '0'), refund_key,
    payment.connected_account_id, p_amount_cents, payment.currency, refund_reason, 'pending', p_livemode, key, (select auth.uid())
  )
  returning id into rid;
  perform app.record_audit_event(
    payment.organization_id, 'invoice.refund_requested', 'public.invoice_refunds', rid, 'success',
    jsonb_build_object('invoice_id', payment.invoice_id, 'payment_id', payment.id, 'amount_cents', p_amount_cents, 'currency', payment.currency)
  );
  return rid;
end;
$function$;
revoke all on function app.record_invoice_refund(uuid, text, bigint, text, text, boolean, text) from public;
grant execute on function app.record_invoice_refund(uuid, text, bigint, text, text, boolean, text) to authenticated;

-- Public wrappers; the database checks the caller.
create or replace function public.reserve_invoice_refund(p_payment_id uuid, p_amount_cents bigint, p_currency text, p_livemode boolean, p_idempotency_key text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.reserve_invoice_refund(p_payment_id, p_amount_cents, p_currency, p_livemode, p_idempotency_key); $$;

create or replace function public.link_invoice_refund_reservation(p_reservation_id uuid, p_refund_id text)
returns void language sql security invoker set search_path = ''
as $$ select app.link_invoice_refund_reservation(p_reservation_id, p_refund_id); $$;

create or replace function public.release_invoice_refund_reservation(p_reservation_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select app.release_invoice_refund_reservation(p_reservation_id); $$;

revoke all on function public.reserve_invoice_refund(uuid, bigint, text, boolean, text) from public, anon;
revoke all on function public.link_invoice_refund_reservation(uuid, text) from public, anon;
revoke all on function public.release_invoice_refund_reservation(uuid) from public, anon;
grant execute on function public.reserve_invoice_refund(uuid, bigint, text, boolean, text) to authenticated;
grant execute on function public.link_invoice_refund_reservation(uuid, text) to authenticated;
grant execute on function public.release_invoice_refund_reservation(uuid) to authenticated;
