-- Security review round 3 (follow-up to 20261031014000): email attachments are completed only
-- through public.complete_verified_email_upload (the server measures the stored object and checks
-- the content type). The header-only completion is no longer an entry point. Kept as its own
-- migration so it can be applied after the app that no longer calls it is deployed.
revoke execute on function public.complete_email_upload(uuid, integer, text, text) from public, anon, authenticated, service_role;

-- Follow-up to 20261031013000 / 20261031018000 (refund reservations, dispute evidence): the app now
-- releases and links reservations and records dispute evidence through the server-only
-- service_* functions, bound to the signed-in staff member, so the signed-in forms are revoked.
revoke execute on function public.release_invoice_refund_reservation(uuid) from authenticated;
revoke execute on function public.link_invoice_refund_reservation(uuid, text) from authenticated;
revoke execute on function app.release_invoice_refund_reservation(uuid) from authenticated;
revoke execute on function app.link_invoice_refund_reservation(uuid, text) from authenticated;
revoke execute on function public.record_dispute_evidence(uuid, text, text, text, integer, text, boolean, boolean) from authenticated;
revoke execute on function app.record_dispute_evidence(uuid, text, text, text, integer, text, boolean, boolean) from authenticated;

-- Follow-up to 20261031017000 (practice pages need staff MFA): the app now names the visitor's
-- session assurance, so the 2-argument staff check (no assurance) no longer treats anyone as staff.
create or replace function app.public_viewer_is_staff(p_org uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.public_viewer_is_staff(p_org, p_viewer, null::text);
$$;
revoke all on function app.public_viewer_is_staff(uuid, uuid) from public, anon, authenticated;
