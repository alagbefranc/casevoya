-- Security M1: the outbound and inbound email migrations granted SELECT to
-- authenticated but never revoked Supabase's default privileges, so on the hosted
-- project anon and authenticated still hold ALL (including TRUNCATE, which row
-- level security does not filter) on these seven tables.
--
-- Revoke everything from the API roles, then restore only the SELECT that the
-- existing *_select policies (to authenticated) were written for. Workers write
-- through service_role functions, which are unaffected.
-- Additive only.

revoke all on table public.email_deliveries from anon, authenticated;
revoke all on table public.email_suppressions from anon, authenticated;
revoke all on table public.matter_reply_addresses from anon, authenticated;
revoke all on table public.inbound_emails from anon, authenticated;
revoke all on table public.inbound_inbox_items from anon, authenticated;
revoke all on table public.inbound_attachment_files from anon, authenticated;
revoke all on table public.email_inbound_windows from anon, authenticated;

grant select on table public.email_deliveries to authenticated;
grant select on table public.email_suppressions to authenticated;
grant select on table public.matter_reply_addresses to authenticated;
grant select on table public.inbound_emails to authenticated;
grant select on table public.inbound_inbox_items to authenticated;
grant select on table public.inbound_attachment_files to authenticated;
grant select on table public.email_inbound_windows to authenticated;
