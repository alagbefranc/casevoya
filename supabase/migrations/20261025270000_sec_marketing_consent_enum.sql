-- SEC-05 (gap #184): marketing is its own consent purpose, separate from core processing, the
-- optional AI and the notice channels. A new enum value goes in its own migration so the next one
-- can use it. Additive only.

alter type public.consent_purpose add value if not exists 'marketing';
