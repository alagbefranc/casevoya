-- #302: signed-URL lifetime was chosen by the caller.
--
-- Before: storage.objects SELECT on the private "documents" bucket (documents_object_select)
-- allowed a signed-in user to read or sign an object when app.can_read_storage_object(name) was
-- true: the uploader during its 900 s upload intent (no scan), or anyone with an unexpired
-- document_download_grants row. Supabase signed URLs are self-contained and the caller picks
-- expiresIn, so one audited 120 s grant could mint a link valid for a year that survives
-- revocation, unlinking and quarantine.
--
-- After: no signed-in user (staff or client) can read or sign a documents object at all. The app
-- server calls public.authorize_document_download as the person (unchanged: role, matter scope,
-- clean file, fresh second factor, audit row) and then signs or downloads with the service role,
-- for a lifetime it chooses (120 s for a download link, 60 s for Vo's one read). Uploads are
-- unchanged (documents_object_insert and signed upload URLs); nothing reads an object back.
--
-- documents_object_select stays (the migration role does not own storage.objects), and now
-- always denies. The function keeps its signature and grants (create or replace).
create or replace function app.can_read_storage_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- #302: no reads for signed-in users; the server reads with the service role after
  -- public.authorize_document_download.
  select false and p_name is not null;
$$;

comment on function app.can_read_storage_object(text) is
  '#302: always false. Signed-in users never read or sign documents objects; the app server does, with the service role, after public.authorize_document_download.';
