-- Stage-entry evidence is written only by the workflows that prove it.
--
-- 1. public.matter_stage_evidence: authenticated keeps SELECT (matter readers) but loses INSERT.
--    Every legitimate row is written inside a SECURITY DEFINER workflow (engagement, e-sign,
--    intake assignment, submission receipt, decision letter, decision confirmation, closure).
--    The insert policy is kept (the migration checker forbids dropping policies) but no longer
--    admits any row.
-- 2. app.transition_matter_stage and its invoker wrappers (public.transition_matter_stage,
--    public.attempt_matter_stage_transition) are no longer callable by authenticated.
--    Staff move stages through public.override_matter_stage (licensed / owner, step-up, recorded
--    override) and close through public.close_matter; both are definer functions that call
--    app.transition_matter_stage as the owner. service_role keeps execute.
-- 3. app.override_matter_stage refuses 'closed': closing goes through public.close_matter, which
--    checks open client funds and unpaid invoices and records the closure and retention date.

revoke insert on table public.matter_stage_evidence from authenticated, anon;

alter policy matter_stage_evidence_insert on public.matter_stage_evidence
  with check (false);

revoke execute on function public.transition_matter_stage(uuid, public.matter_stage, integer, text)
  from public, anon, authenticated;
revoke execute on function app.transition_matter_stage(uuid, public.matter_stage, integer, text)
  from public, anon, authenticated;
-- Invoker wrapper over app.transition_matter_stage with the same reach; not used by the app.
revoke execute on function public.attempt_matter_stage_transition(uuid, public.matter_stage, integer, text)
  from public, anon, authenticated;
grant execute on function public.transition_matter_stage(uuid, public.matter_stage, integer, text) to service_role;
grant execute on function app.transition_matter_stage(uuid, public.matter_stage, integer, text) to service_role;
grant execute on function public.attempt_matter_stage_transition(uuid, public.matter_stage, integer, text) to service_role;

-- app.override_matter_stage(uuid,public.matter_stage,integer,text), last defined in
-- 20261018100000_owner_licence_gates.sql. One change: a target of 'closed' is refused.
create or replace function app.override_matter_stage(
  p_matter_id uuid,
  p_to_stage public.matter_stage,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  permitted public.org_role;
  override_id uuid;
  new_version integer;
  blocked public.credential_status;
begin
  if p_to_stage = 'closed' then
    raise exception 'a matter is closed through close_matter, not a stage override' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a stage change needs a reason' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'matter stage change denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant']::public.org_role[],
    true
  );
  if app.matter_stage_is_regulated(matter.stage, p_to_stage) then
    perform app.require_licensed_staff(matter.organization_id, true);
    permitted := 'licensed_consultant';
  elsif app.has_org_role(matter.organization_id, array['licensed_consultant']::public.org_role[]) then
    permitted := 'licensed_consultant';
  else
    permitted := 'firm_owner';
  end if;

  insert into public.matter_stage_overrides (
    organization_id, matter_id, from_stage, to_stage, reason, permitted_role, actor_user_id
  ) values (
    matter.organization_id,
    matter.id,
    matter.stage,
    p_to_stage,
    btrim(p_reason),
    permitted,
    (select auth.uid())
  )
  returning id into override_id;

  insert into app.matter_stage_override_nonce (matter_id, txid, override_id)
  values (matter.id, txid_current(), override_id)
  on conflict (matter_id) do update
    set txid = excluded.txid, override_id = excluded.override_id;

  new_version := app.transition_matter_stage(p_matter_id, p_to_stage, p_expected_version, p_reason);
  return jsonb_build_object('ok', true, 'version', new_version, 'override_id', override_id, 'permitted_role', permitted);
exception
  when insufficient_privilege then
    if sqlerrm ilike '%licence blocks%' then
      blocked := app.actor_licence_block_status(matter.organization_id);
      perform app.record_audit_event(
        matter.organization_id,
        'licence.regulated_action_blocked',
        'public.matters',
        p_matter_id,
        'denied',
        jsonb_build_object('action', 'matter.stage_override', 'to_stage', p_to_stage, 'credential_status', blocked)
      );
      return jsonb_build_object('ok', false, 'blocked', 'licence', 'credential_status', blocked);
    end if;
    raise;
end;
$$;
revoke all on function app.override_matter_stage(uuid, public.matter_stage, integer, text) from public, anon;
grant execute on function app.override_matter_stage(uuid, public.matter_stage, integer, text) to authenticated, service_role;
