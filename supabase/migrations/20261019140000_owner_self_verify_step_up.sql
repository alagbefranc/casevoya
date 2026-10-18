-- The firm owner verifying a deposit they recorded themselves needs a fresh step-up.
--
-- Decided by Francis: the "Verified by owner (own entry)" path is held to the same rule as the
-- owner approving their own earned-fee transfer (app.approve_client_transfer): the owner confirms
-- with their authenticator after the deposit was recorded, within the usual 15 minutes. A step-up
-- taken before the deposit was recorded does not count.
--
-- Everyone else is unchanged: a second person (another finance user on the matter, or the owner
-- verifying someone else's entry) verifies without a step-up, and the recorder who is not the firm
-- owner is still refused.
--
-- Replaces app.verify_client_deposit from 20261019130000_client_funds_controls.sql; the body is
-- that definition plus the step-up check in the owner's own-entry branch. Additive only.

create or replace function app.verify_client_deposit(p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.client_fund_entries%rowtype;
  actor uuid := (select auth.uid());
  owner_self boolean := false;
begin
  select * into entry from public.client_fund_entries where id = p_entry_id;
  perform app.require_client_funds_access(entry.matter_id, false);
  perform 1 from public.client_fund_ledgers where id = entry.ledger_id for update;
  select * into entry from public.client_fund_entries where id = p_entry_id for update;
  if entry.kind <> 'deposit' or entry.status <> 'pending_verification' then
    raise exception 'only a deposit pending verification can be verified' using errcode = '22023';
  end if;
  if entry.requested_by = actor then
    if app.has_org_role(entry.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
      raise exception 'the person who recorded a deposit cannot verify it' using errcode = '42501';
    end if;
    -- Same rule as the owner approving their own transfer: a step-up taken after the deposit was
    -- recorded, and no older than 15 minutes.
    if app.mfa_step_up_satisfied(least(interval '15 minutes', statement_timestamp() - date_trunc('second', entry.created_at)))
       is distinct from true then
      raise exception 'step-up is required: verifying your own deposit needs a step-up after it was recorded' using errcode = '42501';
    end if;
    owner_self := true;
  end if;
  update public.client_fund_entries
  set status = 'verified', verified_by = actor, verified_at = clock_timestamp(), verified_by_owner_self = owner_self
  where id = entry.id;
  perform app.record_audit_event(
    entry.organization_id,
    case when owner_self then 'client_funds.deposit_verified_owner_self' else 'client_funds.deposit_verified' end,
    'public.client_fund_entries', entry.id, 'success',
    jsonb_build_object('amount_cents', entry.amount_cents, 'recorded_by', entry.requested_by, 'verified_by_owner_self', owner_self)
  );
  perform app.issue_client_fund_receipt(entry.id);
  return entry.id;
end;
$$;
revoke all on function app.verify_client_deposit(uuid) from public;
grant execute on function app.verify_client_deposit(uuid) to authenticated;
