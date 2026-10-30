-- Security review round 3 (follow-up to 20261031014000): email attachments are completed only
-- through public.complete_verified_email_upload (the server measures the stored object and checks
-- the content type). The header-only completion is no longer an entry point. Kept as its own
-- migration so it can be applied after the app that no longer calls it is deployed.
revoke execute on function public.complete_email_upload(uuid, integer, text, text) from public, anon, authenticated, service_role;
