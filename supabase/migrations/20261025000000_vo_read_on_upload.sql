-- DOC-05 (#178): an optional per-firm switch, "Read documents on upload" (off by default). When it is
-- on, a matter's new uploads are read by Vo the next time a staff member who may use Vo opens the
-- matter's Documents tab, under that person's own access, so every Vo switch, category switch,
-- sample-mode rule and rate limit in public.begin_vo_document_review still applies. Readings stay
-- proposals until a person accepts them.
--
-- Changed table:
--   public.vo_settings      + read_on_upload boolean not null default false (if it isn't there yet).
--
-- public.set_vo_settings is not redefined here. 20261025240200_vo_settings_keep_read_on_upload.sql
-- (#227, applied to prod) defines it with both read_on_upload and AI-01's letter_drafts, and sorts
-- after this file, so redefining it here could only reintroduce an older body without letter_drafts.
-- That migration also adds this column when it's missing, so the two are safe in either order.

alter table public.vo_settings add column if not exists read_on_upload boolean not null default false;
comment on column public.vo_settings.read_on_upload is
  'DOC-05: Vo reads new uploads when staff open the matter''s Documents tab. Off by default; every other Vo switch still applies.';
