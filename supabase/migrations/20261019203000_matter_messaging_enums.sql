-- Secure matter messaging (PRD OPS-04, OPS-05; TASKS T034). Enum value only, in its own
-- migration: Postgres cannot use a value added by ALTER TYPE ... ADD VALUE in the transaction
-- that adds it, and the next migration's mail function uses it.
--
--   email_template 'message'  EX07 "New message" (docs/EMAIL-TEMPLATES.md): the approved generic
--                             notice. It carries the firm name only, never the message text.
-- Additive only.

alter type public.email_template add value if not exists 'message';
