/**
 * The abuse limit on invitation links or invites (`rate_limited`, or a preview whose status is
 * `rate_limited`). Says to wait, so it never reads like a dead invitation.
 */
export const PORTAL_RATE_LIMITED = "Too many tries. Please wait a few minutes and try again.";

/** Why an invitation preview that isn't open can't go on: too many tries for now, or a closed invitation. */
export function portalPreviewProblem(status: unknown): string {
  return status === "rate_limited" ? PORTAL_RATE_LIMITED : "This invitation can no longer be used.";
}

/**
 * User-facing copy for the `error` codes the portal invitation functions return
 * (public.create_portal_invitation and friends). Never passes a database message through.
 */
export function portalError(code: string | undefined): string {
  switch (code) {
    case "real_client_invitations_locked":
      return "Real client invitations stay locked until the firm finishes sample proofs, a good-standing licence check, and an active trial or subscription.";
    case "minor_cannot_hold_login":
      return "A minor cannot hold their own login. Invite a guardian instead.";
    case "date_of_birth_required":
      return "Record a date of birth before sending this invitation.";
    case "guardian_subject_required":
    case "guardian_subject_not_minor":
      return "A guardian invitation needs the minor they act for.";
    case "rate_limited":
      return PORTAL_RATE_LIMITED;
    case "confirmed_email_required":
      return "Confirm the invited email before accepting.";
    case "portal_terms_required":
    case "privacy_notice_required":
      return "The current terms and privacy notice have to be accepted.";
    case "processing_consent_required":
      return "Processing consent is required for this invitation.";
    case "contact_phone_required":
      return "Add a phone number before choosing text reminders.";
    case "invitation_cannot_be_accepted":
      return "This invitation can no longer be used.";
    case "invalid_email":
      return "Enter a valid email address.";
    case "invalid_role":
      return "Choose a portal role.";
    case "email_does_not_match_person":
      return "Use the email already on this person’s record.";
    case "not_a_participant":
      return "They aren’t on this matter in that role. Choose the role they hold on the file.";
    case "sample_mismatch":
      return "A sample person can only be invited to a sample matter.";
    default:
      return "That action could not be completed.";
  }
}
