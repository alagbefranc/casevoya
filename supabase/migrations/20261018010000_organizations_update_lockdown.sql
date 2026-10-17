-- Security H1: a firm owner could PATCH public.organizations directly and set
-- verification_status = 'verified', sample_mode = false, or forge DPA and terms
-- acceptance, skipping set_sample_mode / sync_firm_verification / save_firm_setup.
--
-- The application never updates organizations directly (src/ only selects). Every
-- writer is a SECURITY DEFINER function (save_firm_setup, set_sample_mode,
-- sync_firm_verification, set_quiet_hours, set_document_upload_limit, ...), which
-- runs as the function owner and needs no table grant. So the table UPDATE grant is
-- removed entirely. The existing owner UPDATE policies stay in place but no longer
-- matter while authenticated has no UPDATE privilege.
--
-- Defence in depth: a BEFORE UPDATE trigger refuses changes to status, sample-mode,
-- acceptance, and upload-limit columns when the session role is an API role
-- (authenticated or anon), so a future re-grant cannot reopen the hole.
-- Additive only.

revoke update on table public.organizations from anon, authenticated;

create function app.guard_organization_protected_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Invoker on purpose: inside a SECURITY DEFINER function current_user is the
  -- function owner, so gated functions keep working. Direct API sessions are refused.
  if current_user in ('authenticated', 'anon')
     and (
       new.verification_status is distinct from old.verification_status
       or new.sample_mode is distinct from old.sample_mode
       or new.dpa_accepted_at is distinct from old.dpa_accepted_at
       or new.dpa_version is distinct from old.dpa_version
       or new.subscription_terms_accepted_at is distinct from old.subscription_terms_accepted_at
       or new.subscription_terms_version is distinct from old.subscription_terms_version
       or new.document_max_bytes is distinct from old.document_max_bytes
     ) then
    raise exception 'organization status, acceptance, and limits go through the firm setup functions'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
-- Trigger functions are not checked for EXECUTE when they fire, so no role needs a grant.
revoke all on function app.guard_organization_protected_columns() from public;

create trigger organizations_protected_columns before update on public.organizations
  for each row execute function app.guard_organization_protected_columns();

comment on function app.guard_organization_protected_columns() is
  'Refuses direct API-role changes to verification_status, sample_mode, DPA/terms acceptance, and document_max_bytes. Definer functions are unaffected.';
