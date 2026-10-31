"use client";

import { useCallback, useRef } from "react";
import { safeRedirect } from "@/lib/auth/redirect";
import { recoveryCodesShown } from "@/lib/auth/mfa-step";
import { createClient } from "@/lib/supabase/client";
import {
  acceptPortalInvitation,
  previewPortalInvitation,
  savePortalInvitationDraft,
} from "@/modules/portal-invitations/actions";
import { PORTAL_RATE_LIMITED, portalPreviewProblem } from "@/modules/portal-invitations/errors";
import type { PortalAcceptPayload, PortalShareSection } from "@/modules/portal-invitations/types";
import {
  createTrialFirm,
  enrollAuthenticator,
  confirmPortalInvite,
  continuePortalInvite,
  getAuthContext,
  issueRecoveryCodes,
  joinPortalInvite,
  joinStaffInvite,
  resendPortalInviteCode,
  previewStaffInvite,
  redeemRecovery,
  requestMfaReset,
  saveSetupStep,
  sendRecoveryEmail,
  signInWithPassword,
  signUpForTrial,
  updatePassword,
  verifyEmailCode,
  verifyTotpCode,
} from "@/app/auth/port-actions";
import { toast2 } from "./kit";
import { writeInviteBadge } from "./invite-badge";
import { showSignupEmail } from "./signup-email";
import type { PortEvent, PortResult } from "./use-port";

type Ctx = Awaited<ReturnType<typeof getAuthContext>>;

/** What the start-trial screen keeps until the firm is created (after email and two-step). */
type PendingTrial = { firmName?: string; sampleMode?: boolean; licenceNumber?: string; licenceClass?: string };

function val(root: ParentNode, id: string) {
  return (root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.value ?? "").trim();
}

function checked(root: ParentNode, id: string) {
  return Boolean(root.querySelector<HTMLInputElement>(`#${id}`)?.checked);
}

type InvitePreview = {
  status?: string;
  invitee?: { display_name?: string; email?: string };
  organization?: { display_name?: string; default_locale?: string };
  policies?: { portal_terms?: { id?: string } | null; privacy_notice?: { id?: string } | null };
};

function asPreview(value: unknown): InvitePreview | null {
  return value && typeof value === "object" ? (value as InvitePreview) : null;
}

/**
 * Creates the firm the start-trial screen kept in sessionStorage, once two-step is on. Null when
 * nothing is pending. Storage is cleared once the firm exists.
 */
async function createPendingTrialFirm(): Promise<PortResult> {
  const raw = sessionStorage.getItem("cv-trial");
  if (!raw) return null;
  let pending: PendingTrial = {};
  try {
    pending = JSON.parse(raw) as PendingTrial;
  } catch {
    sessionStorage.removeItem("cv-trial");
    return null;
  }
  if (!pending.firmName) return null;
  const created = await createTrialFirm({
    firmName: pending.firmName,
    sampleMode: Boolean(pending.sampleMode),
    licenceNumber: pending.licenceNumber,
    licenceClass: pending.licenceClass,
  });
  if (created?.ok && created.href === "/setup") sessionStorage.removeItem("cv-trial");
  return created;
}

function mfaDestination() {
  return safeRedirect(new URLSearchParams(location.search).get("next"));
}

function portalLocale(root: ParentNode): "en-CA" | "fr-CA" {
  const french = [...root.querySelectorAll<HTMLElement>(".seg[aria-label='Language'] button")].find(
    (button) => button.getAttribute("aria-pressed") === "true" && /fran/i.test(button.textContent || ""),
  );
  return french ? "fr-CA" : "en-CA";
}

/** Presses the firm's default language (ORG-01) on the invite's Language switch; the client can still change it. */
function presetPortalLocale(root: ParentNode, locale: string | undefined) {
  if (locale !== "fr-CA" && locale !== "en-CA") return;
  root.querySelectorAll<HTMLElement>(".seg[aria-label='Language']").forEach((seg) => {
    seg.querySelectorAll<HTMLElement>("button").forEach((button) => {
      const french = /fran/i.test(button.textContent || "");
      button.setAttribute("aria-pressed", String(french === (locale === "fr-CA")));
    });
  });
}

function portalAcceptPayload(root: HTMLElement, preview: InvitePreview, page: string): PortalAcceptPayload | { error: string } {
  const terms = preview.policies?.portal_terms?.id;
  const privacy = preview.policies?.privacy_notice?.id;
  if (!terms || !privacy) return { error: "The firm hasn’t published the current terms and privacy notice." };
  const shares: PortalShareSection[] = [];
  if (checked(root, "o2")) shares.push("passport_bio");
  if (checked(root, "o3")) shares.push("school_transcript");
  return {
    portal_terms_id: terms,
    privacy_notice_id: privacy,
    locale: portalLocale(root),
    // Only what the person ticked on this screen. A screen without the box records no consent.
    email_notices: checked(root, "c1"),
    sms_notices: checked(root, "c2"),
    deadline_reminders: checked(root, "c3"),
    processing_consent: checked(root, "o1"),
    shares: page === "accept-family" ? shares : undefined,
  };
}

const PORTAL_ACCEPT = new Set(["accept-client", "accept-family", "accept-sponsor"]);

/** The portal accept screens' sign-in step (the last step before Done, or the last step). */
function portalSignInStep(page: string) {
  return page === "accept-sponsor" ? 2 : 3;
}

type SignInPart = "password" | "passkey" | "code" | "none";

/** Shows one part of the sign-in step (markup/portal-sign-in.tsx). "none": already signed in as the invitee. */
function showSignIn(root: ParentNode, part: SignInPart) {
  root.querySelectorAll<HTMLElement>("[data-signin]").forEach((block) => {
    block.hidden = block.dataset.signin !== part;
  });
  const methods = root.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Sign-in method"]');
  if (methods) methods.hidden = part === "code" || part === "none";
}

function signInPart(root: ParentNode): SignInPart {
  const shown = [...root.querySelectorAll<HTMLElement>("[data-signin]")].find((block) => !block.hidden);
  return (shown?.dataset.signin as SignInPart | undefined) ?? "none";
}

/** "Create a password" for a new sign-in, or the password of an existing Casevoya sign-in. */
function setExistingAccount(root: ParentNode, existing: boolean) {
  const field = root.querySelector<HTMLElement>('[data-signin="password"] .fld');
  const input = field?.querySelector<HTMLInputElement>("input");
  if (!field || !input) return;
  field.dataset.existing = existing ? "1" : "";
  const message = existing ? "Enter your Casevoya password" : "Choose a password that meets all three rules";
  field.dataset.req = message;
  if (existing) delete field.dataset.min;
  else field.dataset.min = "12";
  field.classList.remove("err");
  const label = field.querySelector("label");
  if (label) label.textContent = existing ? "Your Casevoya password" : "Create a password";
  const error = field.querySelector(".emsg span");
  if (error) error.textContent = message;
  input.autocomplete = existing ? "current-password" : "new-password";
  const rules = field.querySelector<HTMLElement>(".rules");
  if (rules) rules.style.display = existing ? "none" : "";
  const toggle = root.querySelector<HTMLElement>("[data-signin-mode]");
  if (toggle) toggle.textContent = existing ? "New to Casevoya? Create a password" : "Already have a Casevoya sign-in? Sign in";
}

function bindPortalSignIn(root: HTMLElement) {
  if (root.dataset.signinBound === "1") return;
  root.dataset.signinBound = "1";
  const methods = root.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Sign-in method"]');
  methods?.addEventListener("pick", (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (signInPart(root) === "code" || signInPart(root) === "none") return;
    showSignIn(root, detail === "passkey" ? "passkey" : "password");
  });
  root.querySelector<HTMLElement>("[data-signin-mode]")?.addEventListener("click", (event) => {
    event.preventDefault();
    const field = root.querySelector<HTMLElement>('[data-signin="password"] .fld');
    setExistingAccount(root, field?.dataset.existing !== "1");
    root.querySelector<HTMLInputElement>("#ppw")?.focus();
  });
}

/** The password typed on the portal sign-in step (still in the hidden field on the code step). Not trimmed. */
function portalPassword(root: ParentNode) {
  return root.querySelector<HTMLInputElement>("#ppw")?.value ?? "";
}

/**
 * Leaves the code step once the invitation was accepted without the code (the email was confirmed
 * through its link): the Done step on accept-client, the portal elsewhere (use-port's `port-go`).
 */
function leaveCodeStep(root: HTMLElement, page: string, firstRequest: { purpose: string } | null | undefined) {
  if (page === "accept-client") {
    showFirstRequest(root, firstRequest);
    const then = root.querySelector<HTMLElement>('[data-signin="code"] .otp')?.dataset.then || "#4";
    root.dispatchEvent(new CustomEvent("port-go", { detail: then }));
    return;
  }
  root.dispatchEvent(new CustomEvent("port-go", { detail: "/portal" }));
}

/**
 * While the code step is up, notices a session started by the email's link in another tab of
 * this browser (/auth/confirm sets the auth cookies, which every tab shares) and moves on, so the
 * person isn't left waiting for a code they'll never type. Checks every few seconds and when the
 * tab comes back into focus; only reads the local session (no request) until there is one.
 */
function watchForLinkSession(root: HTMLElement, invitedEmail: string | undefined, onSession: () => Promise<"done" | "stop" | "retry">) {
  if (root.dataset.linkWatch === "1") return;
  root.dataset.linkWatch = "1";
  const supabase = createClient();
  let busy = false;
  // A session that the server still can't use (e.g. accepting failed) is tried a few times, not forever.
  let tries = 0;
  const stop = () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", check);
    delete root.dataset.linkWatch;
  };
  async function check() {
    if (!root.isConnected || signInPart(root) !== "code") {
      stop();
      return;
    }
    if (busy || document.visibilityState === "hidden") return;
    busy = true;
    try {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email?.trim().toLowerCase();
      if (!email || (invitedEmail && email !== invitedEmail)) return;
      tries += 1;
      const outcome = await onSession();
      if (outcome === "retry" && tries >= 3) {
        // The quiet tries showed nothing; say once that it needs the person now.
        toast2("We couldn’t finish signing you in", {
          kind: "bad",
          sub: "Enter the six-digit code, or choose “I used the email link” to try again.",
        });
      }
      if (outcome !== "retry" || tries >= 3) stop();
    } catch {
      // A failed check is tried again on the next tick.
    } finally {
      busy = false;
    }
  }
  const timer = window.setInterval(() => void check(), 4000);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", check);
}

/** The Done step's first task: the person's real first open request, or nothing. */
function showFirstRequest(root: ParentNode, request: { purpose: string } | null | undefined) {
  const card = root.querySelector<HTMLElement>("[data-first-request]");
  if (!card) return;
  const title = card.querySelector("h2");
  if (request?.purpose && title) {
    title.textContent = request.purpose;
    card.style.display = "";
  } else {
    card.style.display = "none";
  }
}

export function usePortActions(page: string, token?: string) {
  const ctx = useRef<Ctx | null>(null);
  const enrolled = useRef<string | null>(null);
  const invite = useRef<InvitePreview | null>(null);
  // Whether this page load has opened the invitation yet (the one read that counts toward its limit).
  const opened = useRef(false);

  return useCallback(
    async (event: PortEvent): Promise<PortResult> => {
      if (!ctx.current) ctx.current = await getAuthContext();
      const session = ctx.current;

      /**
       * The invitation, read once and kept. Only the first read of this page load is an open
       * (counted toward the invitation's rate limit); steps and retries reuse it or re-read
       * without counting. A rate-limited read is not kept, so a later try reads it again.
       */
      const loadInvite = async (): Promise<{ preview: InvitePreview | null } | { error: string }> => {
        if (invite.current) return { preview: invite.current };
        if (!token) return { error: "This invitation could not be opened." };
        const read = await previewPortalInvitation(token, !opened.current);
        if ("error" in read) return { error: read.error ?? "This invitation could not be opened." };
        opened.current = true;
        const preview = asPreview(read.preview);
        if (preview?.status === "rate_limited") return { error: PORTAL_RATE_LIMITED };
        invite.current = preview;
        return { preview };
      };

      /**
       * Whether this invitation was already accepted by the person signed in here. The email's
       * link opens a second tab of the accept screen, and the first tab's watcher (or the other
       * tab) can accept before this one does; the invitation is then used, but they're in. Re-reads
       * the invitation and the session. The invited email is known only while the invitation was
       * open (the preview drops it after); when it is, the session must be that email.
       */
      const acceptedHere = async (): Promise<boolean> => {
        if (!token) return false;
        const known = invite.current?.invitee?.email?.trim().toLowerCase();
        const opened = await previewPortalInvitation(token);
        if ("error" in opened || asPreview(opened.preview)?.status !== "consumed") return false;
        ctx.current = await getAuthContext();
        const email = ctx.current.email?.trim().toLowerCase();
        return ctx.current.signedIn && Boolean(email) && (!known || email === known);
      };

      /**
       * The code step's way on when the email was confirmed through its link (see
       * continuePortalInvite). `quiet`: the watcher found a session; nothing is shown on failure.
       */
      const continueFromLink = async (root: HTMLElement, quiet: boolean): Promise<"done" | "stop" | "retry"> => {
        if (!token) return "stop";
        const loaded = await loadInvite();
        if ("error" in loaded) {
          if (!quiet) toast2(loaded.error, { kind: "bad" });
          return "retry";
        }
        const preview = loaded.preview;
        if (!preview || preview.status !== "open") {
          if (await acceptedHere()) {
            leaveCodeStep(root, page, null);
            return "done";
          }
          if (!quiet) toast2(portalPreviewProblem(preview?.status), { kind: "bad" });
          return "stop";
        }
        const draft = portalAcceptPayload(root, preview, page);
        if ("error" in draft) {
          if (!quiet) toast2(draft.error, { kind: "bad" });
          return "stop";
        }
        const joined = await continuePortalInvite({ token, password: quiet ? "" : portalPassword(root), payload: draft });
        if (!joined || joined.ok === false) {
          if (await acceptedHere()) {
            leaveCodeStep(root, page, null);
            return "done";
          }
          if (!quiet) toast2(joined?.message ?? "That didn’t work. Try again.", { kind: "bad" });
          // A session for someone else won't become the invitee's by waiting.
          return joined?.reason === "elsewhere" ? "stop" : "retry";
        }
        ctx.current = null;
        leaveCodeStep(root, page, "firstRequest" in joined ? joined.firstRequest : null);
        return "done";
      };

      const bindLinkConfirmed = (root: HTMLElement) => {
        const link = root.querySelector<HTMLElement>("[data-link-confirmed]");
        if (!link || link.dataset.bound === "1") return;
        link.dataset.bound = "1";
        link.addEventListener("click", (click) => {
          click.preventDefault();
          if (link.getAttribute("aria-disabled") === "true") return;
          link.setAttribute("aria-disabled", "true");
          void continueFromLink(root, false).finally(() => link.removeAttribute("aria-disabled"));
        });
      };

      const showCodeStep = (root: HTMLElement) => {
        showSignIn(root, "code");
        bindLinkConfirmed(root);
        const invited = invite.current?.invitee?.email?.trim().toLowerCase();
        watchForLinkSession(root, invited, () => continueFromLink(root, true));
      };

      if (event.type === "step") {
        if (page === "mfa" && event.step === 2 && !enrolled.current) {
          const preset = event.root.querySelector<HTMLElement>("[data-factor]")?.dataset.factor;
          if (preset) {
            enrolled.current = preset;
          } else if (session.signedIn && !session.factorId) {
            // A failed request must not leave "Preparing your setup code…" up for good.
            const started = await enrollAuthenticator().catch(() => null);
            const status = event.root.querySelector<HTMLElement>(".qr [role=status]");
            if (started) {
              // The action sets the pending-setup cookie, so Next re-renders /mfa and the server
              // draws the QR and key. Changing React's DOM here breaks that re-render.
              enrolled.current = started.factorId;
            } else if (status) {
              status.textContent = "Setup couldn’t start. Reload this page to try again.";
            }
          }
        }
        // Never an empty recovery-codes list (issue #261): only a verified authenticator code fills it.
        if (page === "mfa" && event.step === 3 && !recoveryCodesShown(event.root)) {
          event.root.dispatchEvent(new CustomEvent("port-go", { detail: "#2" }));
        }
        if (page === "start-trial" && event.step === 1) showSignupEmail(event.root);
        if (page === "setup" && event.step === 0 && session.assured) {
          // Normally made before /setup opened (the two-step "Continue setup"). If not, this page
          // rendered without the firm, so it reloads once to show the firm name and saved answers.
          const created = await createPendingTrialFirm();
          if (created && created.ok === false) return created;
          if (created?.ok && created.href === "/setup" && !val(event.root, "dn")) location.reload();
        }
        if ((page === "accept-client" || page === "accept-family" || page === "accept-sponsor") && token && event.step === 0) {
          if (!invite.current) {
            const loaded = await loadInvite();
            if ("error" in loaded) return { ok: false, message: loaded.error };
            presetPortalLocale(event.root, loaded.preview?.organization?.default_locale);
          }
          const preview = invite.current;
          const heading = event.root.querySelector("h1");
          const first = preview?.invitee?.display_name?.split(" ")[0];
          const firm = preview?.organization?.display_name;
          if (heading && first && firm && preview?.status === "open") {
            heading.textContent = `Hi ${first}, welcome to your portal`;
          }
          if (preview?.status && preview.status !== "open") {
            // Opened from the email's link after the other tab accepted: they're in already.
            if (await acceptedHere()) event.root.dispatchEvent(new CustomEvent("port-go", { detail: "/portal" }));
            return { ok: false, message: portalPreviewProblem(preview.status) };
          }
        }
        if (PORTAL_ACCEPT.has(page) && token) {
          bindPortalSignIn(event.root);
          bindLinkConfirmed(event.root);
          if (event.step === portalSignInStep(page) && signInPart(event.root) !== "code") {
            await loadInvite();
            const invited = invite.current?.invitee?.email?.trim().toLowerCase();
            // Already signed in as the invited person: nothing to create, Continue accepts.
            if (session.signedIn && invited && session.email?.trim().toLowerCase() === invited) showSignIn(event.root, "none");
          }
        }
        if (page === "accept-staff" && token && session.configured) {
          const preview = await previewStaffInvite(token);
          if (preview?.email) {
            const email = event.root.querySelector<HTMLInputElement>("#sem");
            if (email) email.value = preview.email;
            const badge = event.root.querySelector(".inv .meta .bd.ok");
            if (badge) writeInviteBadge(badge, preview.email);
          }
          if (preview?.organization_name) {
            const heading = event.root.querySelector("h1");
            if (heading) heading.textContent = `Join ${preview.organization_name}`;
          }
          if (preview?.status === "expired" || preview?.status === "used") {
            event.root.querySelectorAll<HTMLElement>("[data-show]").forEach((alert) => {
              alert.style.display = alert.dataset.show === preview.status ? "flex" : "none";
            });
            const form = event.root.querySelector<HTMLElement>("[data-form]");
            if (form) form.style.display = "none";
          }
        }
        return null;
      }

      if (event.type === "resend") {
        if (PORTAL_ACCEPT.has(page) && token && session.configured) {
          const preview = invite.current;
          const draft = preview && preview.status === "open" ? portalAcceptPayload(event.root, preview, page) : null;
          const sent = await resendPortalInviteCode(token, {
            password: portalPassword(event.root),
            payload: draft && !("error" in draft) ? draft : undefined,
          });
          if (sent && sent.ok === false) return sent;
          if (sent && !sent.confirm) {
            // Already confirmed through the email's link: signed in and accepted instead.
            ctx.current = null;
            leaveCodeStep(event.root, page, sent.firstRequest);
            return { ok: true, message: "Your email is already confirmed. You’re in." };
          }
          return sent ? { ok: true } : null;
        }
        return null;
      }

      if (event.type === "otp") {
        if (PORTAL_ACCEPT.has(page) && token) {
          if (!session.configured) return null;
          const loaded = await loadInvite();
          if ("error" in loaded) return { ok: false, message: loaded.error };
          const preview = loaded.preview;
          if (!preview || preview.status !== "open") {
            if (await acceptedHere()) return { ok: true, href: "/portal" };
            return { ok: false, message: portalPreviewProblem(preview?.status) };
          }
          const draft = portalAcceptPayload(event.root, preview, page);
          if ("error" in draft) return { ok: false, message: draft.error };
          const confirmed = await confirmPortalInvite({ token, code: event.code, payload: draft, password: portalPassword(event.root) });
          if (!confirmed || confirmed.ok === false) {
            if (await acceptedHere()) return { ok: true, href: "/portal" };
            return confirmed;
          }
          ctx.current = null;
          if (page === "accept-client") {
            showFirstRequest(event.root, "firstRequest" in confirmed ? confirmed.firstRequest : null);
            return { ok: true };
          }
          return { ok: true, href: "/portal" };
        }
        if (!session.configured || !session.signedIn && page !== "start-trial" && page !== "recovery") return null;
        if (page === "recovery" && event.then === "#2") {
          return verifyEmailCode(val(event.root, "rem"), event.code, "recovery");
        }
        if (page === "start-trial" && event.then === "#2") {
          return verifyEmailCode(val(event.root, "wem"), event.code, "signup");
        }
        if (page === "mfa" && event.then === "#3" && enrolled.current) {
          const verified = await verifyTotpCode(enrolled.current, event.code);
          if (!verified || verified.ok === false) return verified;
          const issued = await issueRecoveryCodes();
          if (issued && issued.ok && issued.codes?.length) return issued;
          // Two-step is on now, but the person has no way back in without codes. Say so; entering a new code retries.
          return {
            ok: false,
            message: "Two-step sign-in is on, but your recovery codes weren’t created. Enter the next code to try again.",
          };
        }
        if (page === "mfa" && session.factorId && !event.then.startsWith("#")) {
          const verified = await verifyTotpCode(session.factorId, event.code);
          if (!verified || verified.ok === false) return verified;
          return { ok: true, href: mfaDestination() };
        }
        return null;
      }

      const el = event.el;
      if (page === "sign-in" && el.dataset.href === "/mfa") {
        const next = safeRedirect(new URLSearchParams(location.search).get("next"));
        return signInWithPassword(val(event.root, "em"), val(event.root, "pw"), next);
      }
      if (page === "sign-in" && el.dataset.go === "1" && session.configured) {
        const supabase = createClient();
        const { error } = await supabase.auth.signInWithPasskey();
        if (error) return { ok: false, message: "That passkey was not accepted." };
        ctx.current = await getAuthContext();
        return { ok: true };
      }
      if (page === "sign-in" && el.dataset.href === "/sheet" && session.signedIn) {
        return { ok: true, href: "/app" };
      }
      if (page === "mfa" && el.textContent?.includes("Passkey on this device") && session.configured) {
        const supabase = createClient();
        const { error } = await supabase.auth.signInWithPasskey();
        if (error) return { ok: false, message: "That passkey was not accepted." };
        return { ok: true, href: mfaDestination() };
      }
      if (page === "mfa" && event.step === 5 && el.dataset.href === "/sheet") {
        const redeemed = await redeemRecovery(val(event.root, "rc"));
        if (!redeemed || redeemed.ok === false) return redeemed;
        return { ok: true, href: mfaDestination() };
      }
      if (page === "mfa" && el.dataset.href?.startsWith("/sheet")) {
        const destination = mfaDestination();
        // A new sign-up's firm is made now, signed in with two-step, so /setup opens with it.
        if (destination.split(/[?#]/)[0] === "/setup") {
          const created = await createPendingTrialFirm();
          if (created && created.ok === false) return created;
          if (created?.ok && created.href && created.href !== "/setup") return created;
        }
        return { ok: true, href: destination };
      }
      if (page === "start-trial" && el.hasAttribute("data-next") && event.step === 0) {
        return signUpForTrial({
          name: val(event.root, "nm"),
          email: val(event.root, "wem"),
          password: val(event.root, "tpw"),
        });
      }
      if (page === "start-trial" && el.dataset.href === "/setup") {
        const mode = event.root.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.dataset.v;
        const pending: Required<PendingTrial> = {
          firmName: val(event.root, "firm"),
          sampleMode: mode !== "pilot",
          // The setup screen's licence number and class, asked for at sign-up (2026-10-19).
          licenceNumber: val(event.root, "lno"),
          licenceClass: event.root.querySelector<HTMLSelectElement>("#cl")?.value ?? "",
        };
        sessionStorage.setItem("cv-trial", JSON.stringify(pending));
        // "Explore with sample data" opens the optional tour when setup is done.
        sessionStorage.setItem("cv-tour", pending.sampleMode ? "1" : "0");
        const created = await createTrialFirm(pending);
        // Created now (already fully signed in): /setup must not create it again from storage.
        if (created?.ok && created.href === "/setup") sessionStorage.removeItem("cv-trial");
        return created;
      }
      if (page === "recovery" && el.hasAttribute("data-next") && event.step === 0) {
        return sendRecoveryEmail(val(event.root, "rem"));
      }
      if (page === "recovery" && el.hasAttribute("data-next") && event.step === 2) {
        return updatePassword(val(event.root, "np"), checked(event.root, "outall"));
      }
      if (page === "recovery" && el.dataset.go === "5") {
        return requestMfaReset(val(event.root, "why"));
      }
      if (page === "setup" && el.hasAttribute("data-next") && event.step <= 7) {
        const panel = event.root.querySelector<HTMLElement>(`[data-step="${event.step}"]`);
        const fields: Record<string, string | boolean> = {};
        panel?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea").forEach((input) => {
          if (!input.id) return;
          fields[input.id] = input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input.value;
        });
        // The colour shown in the preview: a picked or saved one sets --brand; otherwise the pressed
        // swatch (the first by default), so saving without picking keeps what the person sees.
        const swatches = document.getElementById("sw");
        const brand =
          document.getElementById("prev")?.style.getPropertyValue("--brand").trim() ||
          swatches?.querySelector<HTMLElement>('button[aria-pressed="true"]')?.dataset.c ||
          swatches?.querySelector<HTMLElement>("button[data-c]")?.dataset.c;
        if (brand) fields.brand = brand.trim();
        const years = document.querySelector("#retS .v")?.textContent;
        if (years) fields.retention_years = years;
        fields.tour = sessionStorage.getItem("cv-tour") === "1";
        return saveSetupStep(event.step, fields);
      }
      if ((page === "accept-client" || page === "accept-family" || page === "accept-sponsor") && token && el.hasAttribute("data-next")) {
        const loaded = await loadInvite();
        if ("error" in loaded) return { ok: false, message: loaded.error };
        const preview = loaded.preview;
        if (!preview || preview.status !== "open") {
          if (await acceptedHere()) return { ok: true, href: "/portal" };
          return { ok: false, message: portalPreviewProblem(preview?.status) };
        }
        const draft = portalAcceptPayload(event.root, preview, page);
        if ("error" in draft) return { ok: false, message: draft.error };
        const saved = await savePortalInvitationDraft(token, { ...draft, step: event.step });
        if ("error" in saved) {
          // The other tab may have accepted since this one read the invitation.
          if (await acceptedHere()) return { ok: true, href: "/portal" };
          return { ok: false, message: saved.error ?? "That draft could not be saved." };
        }
        const finishing =
          (page === "accept-client" && event.step === 3) ||
          (page === "accept-family" && event.step === 3) ||
          (page === "accept-sponsor" && event.step === 2);
        if (!finishing) return null;
        const part = signInPart(event.root);
        if (part === "passkey") {
          return { ok: false, message: "Passkeys are coming to Casevoya. Choose “Create a password” for now." };
        }
        let firstRequest: { purpose: string } | null = null;
        if (part === "code") {
          // Continue on the code step: maybe the email was confirmed through its link.
          const joined = await continuePortalInvite({ token, password: portalPassword(event.root), payload: draft });
          if (!joined || joined.ok === false) {
            if (await acceptedHere()) return { ok: true, href: "/portal" };
            // The specific reason (wrong password, another account, still unconfirmed with both ways on).
            return { ok: false, message: joined?.message ?? "Enter the six-digit code we emailed you, or use the link in that email, then choose “I used the email link”." };
          }
          firstRequest = "firstRequest" in joined ? joined.firstRequest : null;
          ctx.current = null;
        } else if (part === "none" && session.signedIn) {
          const accepted = await acceptPortalInvitation(token, draft);
          if ("error" in accepted) return { ok: false, message: accepted.error ?? "That invitation could not be accepted." };
        } else {
          const existing =
            event.root.querySelector<HTMLElement>('[data-signin="password"] .fld')?.dataset.existing === "1";
          const joined = await joinPortalInvite({
            token,
            mode: existing ? "existing" : "create",
            // Not trimmed: spaces are part of a password.
            password: event.root.querySelector<HTMLInputElement>("#ppw")?.value ?? "",
            payload: draft,
          });
          if (!joined) return null;
          if (joined.ok === false) return joined;
          if (joined.confirm) {
            showCodeStep(event.root);
            event.root.querySelector<HTMLInputElement>('[data-signin="code"] .otp input')?.focus();
            // A code sent earlier still works; no new one went out (a new one would replace it).
            if (joined.reused) {
              return { ok: true, stay: true, message: "Enter the six-digit code we already emailed you. Need another? Choose “Send a new code”." };
            }
            return { ok: true, stay: true, message: "Check your email for a six-digit code." };
          }
          firstRequest = joined.firstRequest;
          ctx.current = null;
        }
        if (page === "accept-client") {
          showFirstRequest(event.root, firstRequest);
          return null;
        }
        return { ok: true, href: "/portal" };
      }
      if (page === "accept-staff" && token && el.dataset.href?.startsWith("/mfa")) {
        return joinStaffInvite({
          token,
          name: val(event.root, "sn"),
          email: val(event.root, "sem"),
          password: val(event.root, "spw"),
        });
      }
      return null;
    },
    [page, token],
  );
}
