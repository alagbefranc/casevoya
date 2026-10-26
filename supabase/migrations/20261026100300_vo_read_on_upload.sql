-- DOC-05 (#178): an optional per-firm switch, "Read documents on upload" (off by default). When it is
-- on, a matter's new uploads are read by Vo the next time a staff member who may use Vo opens the
-- matter's Documents tab, under that person's own access, so every Vo switch, category switch,
-- sample-mode rule and rate limit in public.begin_vo_document_review still applies. Readings stay
-- proposals until a person accepts them.
--
-- A no-op on current main. Renumbered 2026-10-26 from 20261025000000_vo_read_on_upload.sql (which,
-- per 20261025240200's header, already ran on the live project). Main fully covers it:
-- 20261025240200_vo_settings_keep_read_on_upload.sql adds vo_settings.read_on_upload when it's
-- missing (same definition and comment) and defines public.set_vo_settings with both read_on_upload
-- and AI-01's letter_drafts. So this file does not redefine set_vo_settings (an older body would drop
-- letter_drafts) and only repeats the column with "if not exists", which changes nothing.

alter table public.vo_settings add column if not exists read_on_upload boolean not null default false;
