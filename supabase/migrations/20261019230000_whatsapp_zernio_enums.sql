-- WhatsApp through Zernio (decided by Francis 2026-10-19: per-firm profile and own number,
-- consent required, no sensitive content in WhatsApp). Types only, in their own migration so the
-- next migration can use them. Additive only.
--
--   message_channel            how a matter message reached Casevoya: the portal (and the Sheet)
--                              or a WhatsApp message the client sent to the firm's number.
--   whatsapp_notice_channel    a person's notice preference: email, whatsapp or both.
--   whatsapp_consent_source    who recorded the WhatsApp consent: the client in the portal, or
--                              staff recording what the client told them.
--   whatsapp_account_status    the firm's number: pending (profile made, not connected yet),
--                              connected, disconnected.
--   whatsapp_delivery_status   one outbound WhatsApp send: sending, sent (Zernio accepted it),
--                              delivered, read, failed, skipped (nothing was sent).

create type public.message_channel as enum ('portal', 'whatsapp');

create type public.whatsapp_notice_channel as enum ('email', 'whatsapp', 'both');

create type public.whatsapp_consent_source as enum ('portal', 'staff');

create type public.whatsapp_account_status as enum ('pending', 'connected', 'disconnected');

create type public.whatsapp_delivery_status as enum ('sending', 'sent', 'delivered', 'read', 'failed', 'skipped');
