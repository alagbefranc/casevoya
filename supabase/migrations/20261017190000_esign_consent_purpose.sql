-- T022 electronic-signature consent purpose.
-- A new enum label cannot be used until the statement that adds it commits,
-- so this file only adds the label. The agreement migration inserts rows that use it.
-- Additive only.

alter type public.consent_purpose add value if not exists 'electronic_signature';
