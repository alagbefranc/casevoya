-- Matter reply addresses could exceed the 64-character local-part limit: a firm slug of 32+
-- characters plus '+' and the 32-character matter token. Cloudflare Email Sending refused
-- every portal invitation for such a firm (email.sending.error.email.invalid).
-- app.firm_reply_address is copied from 20261017200200_inbound_email.sql (its only
-- definition); the only change falls back to the firm address when the result is too long.

create or replace function app.firm_reply_address(p_org uuid, p_matter uuid, p_domain text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  slug text;
  token text;
  domain text := app.inbound_domain(p_domain);
begin
  select organizations.slug into slug from public.organizations where id = p_org;
  if slug is null then
    raise exception 'firm was not found' using errcode = '42501';
  end if;
  if p_matter is null then
    return slug || '@' || domain;
  end if;
  insert into public.matter_reply_addresses (organization_id, matter_id, token)
  values (p_org, p_matter, encode(extensions.gen_random_bytes(16), 'hex'))
  on conflict (organization_id, matter_id) do nothing;
  select reply.token into token
  from public.matter_reply_addresses reply
  where reply.organization_id = p_org
    and reply.matter_id = p_matter;
  -- An address's local part may be at most 64 characters (RFC 5321); Cloudflare refuses longer
  -- ones. A long firm slug plus the 32-character matter token can pass that, so such a firm's
  -- matter mail replies to the firm address instead (inbound mail still reaches the firm).
  if length(slug) + 1 + length(token) > 64 then
    return slug || '@' || domain;
  end if;
  return slug || '+' || token || '@' || domain;
end;
$$;
revoke all on function app.firm_reply_address(uuid, uuid, text) from public;
