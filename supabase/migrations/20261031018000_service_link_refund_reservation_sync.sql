-- Security review round 3: keeps the server-only refund-reservation link (20261031013000) in step
-- with the signed-in link as changed in 20261031017000: a released reservation is not linked, a
-- refund id names one reservation, and a linked hold lasts at most 7 days.
create or replace function public.service_link_invoice_refund_reservation(p_reservation_id uuid, p_actor uuid, p_refund_id text)
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
  if app.request_is_server_capture() is distinct from true then
    raise exception 'only the server links a refund reservation' using errcode = '42501';
  end if;
  select * into held from public.invoice_refund_reservations where id = p_reservation_id;
  if held.id is null or p_actor is null or held.requested_by is distinct from p_actor then
    raise exception 'billing access denied' using errcode = '42501';
  end if;
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
  -- Link (20261031017000): not after it was released, and a refund id names one reservation.
  if held.status = 'released' then
    raise exception 'refund reservation was released' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.invoice_refund_reservations other
    where other.refund_id = refund_key and other.id <> held.id
  ) then
    raise exception 'refund belongs to another payment' using errcode = '42501';
  end if;
  select * into recorded from public.invoice_refunds where refund_id = refund_key;
  if recorded.id is not null then
    if recorded.payment_id <> held.payment_id then
      raise exception 'refund belongs to another payment' using errcode = '42501';
    end if;
    update public.invoice_refund_reservations
    set status = 'consumed', refund_id = refund_key, invoice_refund_id = recorded.id, updated_at = now()
    where id = held.id;
    return;
  end if;
  update public.invoice_refund_reservations
  set status = 'linked', refund_id = refund_key, expires_at = now() + interval '7 days', updated_at = now()
  where id = held.id;
end;
$function$;
revoke all on function public.service_link_invoice_refund_reservation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.service_link_invoice_refund_reservation(uuid, uuid, text) to service_role;
