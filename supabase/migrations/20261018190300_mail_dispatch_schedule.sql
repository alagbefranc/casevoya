-- Outbound mail had no scheduler: POST /api/email/dispatch drains the mail outbox, but nothing
-- called it, so invitations, reminders and document notices stayed pending.
--
-- pg_cron runs app.kick_mail_dispatch() every minute; it POSTs to the dispatch endpoint with
-- pg_net. The endpoint URL and its bearer secret are read from Supabase Vault at run time
-- (secrets 'email_dispatch_url' and 'email_dispatch_secret', created outside migrations so no
-- secret is in the repo). Without both secrets the kick does nothing.
-- Where pg_cron or pg_net is not available (local test databases), only the function is created.

create or replace function app.kick_mail_dispatch()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'email_dispatch_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'email_dispatch_secret';
  if url is null or secret is null or url !~ '^https://' then
    return;
  end if;
  perform net.http_post(
    url := url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;
revoke all on function app.kick_mail_dispatch() from public;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    perform cron.schedule('casevoya-mail-dispatch', '* * * * *', 'select app.kick_mail_dispatch()');
  end if;
end;
$$;
