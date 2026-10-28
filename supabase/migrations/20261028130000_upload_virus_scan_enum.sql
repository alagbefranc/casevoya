-- #263-B virus scanning for uploads: the upload state for a file the virus scanner could not
-- check after every retry. Nobody can open it (every read path requires 'clean'); Casevoya keeps
-- trying it slowly and staff are told. Its own migration: a new enum value can't be used in the
-- transaction that adds it.
-- Additive only.

alter type public.document_upload_state add value if not exists 'scan_failed';
