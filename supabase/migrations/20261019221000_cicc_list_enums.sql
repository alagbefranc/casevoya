-- Licence at sign-up and the CICC register list (decision 2026-10-19, approved by Francis).
--
-- Enum values in their own migration (they cannot be used in the transaction that adds them).
-- needs_review: the CICC list check could not confirm the licence (number not on the imported
-- list, the name does not match loosely, or the list's status is not one we recognise). It is a
-- recorded check result that does not change the credential's status and does not lock anyone.
--
-- consultant_credentials.verification_method and credential_checks.method are text columns with a
-- check constraint, not enums; their new value cicc_list is added in the next migration.

alter type public.licence_check_result add value if not exists 'needs_review';
