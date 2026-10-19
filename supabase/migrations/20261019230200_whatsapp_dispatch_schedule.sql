-- WhatsApp through Zernio: the scheduler for POST /api/whatsapp/dispatch, the same way mail is
-- drained (20261018190300_mail_dispatch_schedule.sql). pg_cron runs app.kick_whatsapp_dispatch()
-- every minute; it POSTs with pg_net to the WhatsApp endpoint next to the mail one, with the mail
-- dispatch bearer. Both come from the Vault secrets the mail kick already reads
-- ('email_dispatch_url', 'email_dispatch_secret'), so nothing new is stored. Without them, or
-- where pg_cron or pg_net is not available (local test databases), it does nothing.
-- The endpoint itself answers 503 until ZERNIO_API_KEY is set, so nothing is sent before go-live.
-- Additive only.

create function app.kick_whatsapp_dispatch()
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
  if url is null or secret is null or url !~ '^https://[^/]+/api/email/dispatch$' then
    return;
  end if;
  perform net.http_post(
    url := regexp_replace(url, '/api/email/dispatch$', '/api/whatsapp/dispatch'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;
revoke all on function app.kick_whatsapp_dispatch() from public;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    perform cron.schedule('casevoya-whatsapp-dispatch', '* * * * *', 'select app.kick_whatsapp_dispatch()');
  end if;
end;
$$;
