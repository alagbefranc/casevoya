"use client";

import { useCallback, useRef } from "react";
import { safeNext } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/client";
import {
  acceptPortalInvitation,
  previewPortalInvitation,
  savePortalInvitationDraft,
} from "@/modules/portal-invitations/actions";
import type { PortalAcceptPayload, PortalShareSection } from "@/modules/portal-invitations/types";
import {
  createTrialFirm,
  enrollAuthenticator,
  getAuthContext,
  issueRecoveryCodes,
  joinStaffInvite,
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
import type { PortEvent, PortResult } from "./use-port";

type Ctx = Awaited<ReturnType<typeof getAuthContext>>;

function val(root: ParentNode, id: string) {
  return (root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.value ?? "").trim();
}

function checked(root: ParentNode, id: string) {
  return Boolean(root.querySelector<HTMLInputElement>(`#${id}`)?.checked);
}

type InvitePreview = {
  status?: string;
  invitee?: { display_name?: string };
  organization?: { display_name?: string };
  policies?: { portal_terms?: { id?: string } | null; privacy_notice?: { id?: string } | null };
};

function asPreview(value: unknown): InvitePreview | null {
  return value && typeof value === "object" ? (value as InvitePreview) : null;
}

function mfaDestination() {
  return safeNext(new URLSearchParams(location.search).get("next"));
}

function portalLocale(root: ParentNode): "en-CA" | "fr-CA" {
  const french = [...root.querySelectorAll<HTMLElement>(".seg[aria-label='Language'] button")].find(
    (button) => button.getAttribute("aria-pressed") === "true" && /fran/i.test(button.textContent || ""),
  );
  return french ? "fr-CA" : "en-CA";
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

export function usePortActions(page: string, token?: string) {
  const ctx = useRef<Ctx | null>(null);
  const enrolled = useRef<string | null>(null);
  const invite = useRef<InvitePreview | null>(null);

  return useCallback(
    async (event: PortEvent): Promise<PortResult> => {
      if (!ctx.current) ctx.current = await getAuthContext();
      const session = ctx.current;

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
        if (page === "setup" && event.step === 0 && session.assured) {
          const raw = sessionStorage.getItem("cv-trial");
          if (raw) {
            let pending: { firmName?: string; sampleMode?: boolean } = {};
            try {
              pending = JSON.parse(raw) as { firmName?: string; sampleMode?: boolean };
            } catch {
              sessionStorage.removeItem("cv-trial");
            }
            if (pending.firmName) {
              const created = await createTrialFirm({
                firmName: pending.firmName,
                sampleMode: Boolean(pending.sampleMode),
              });
              if (created?.ok && created.href === "/setup") sessionStorage.removeItem("cv-trial");
              if (created && created.ok === false) return created;
            }
          }
        }
        if ((page === "accept-client" || page === "accept-family" || page === "accept-sponsor") && token && event.step === 0) {
          if (!invite.current) {
            const opened = await previewPortalInvitation(token);
            if ("error" in opened) return { ok: false, message: opened.error ?? "This invitation could not be opened." };
            invite.current = asPreview(opened.preview);
          }
          const preview = invite.current;
          const heading = event.root.querySelector("h1");
          const first = preview?.invitee?.display_name?.split(" ")[0];
          const firm = preview?.organization?.display_name;
          if (heading && first && firm && preview?.status === "open") {
            heading.textContent = `Hi ${first}, welcome to your portal`;
          }
          if (preview?.status && preview.status !== "open") {
            return { ok: false, message: "This invitation can no longer be used." };
          }
        }
        if (page === "accept-staff" && token && session.configured) {
          const preview = await previewStaffInvite(token);
          if (preview?.email) {
            const email = event.root.querySelector<HTMLInputElement>("#sem");
            if (email) email.value = preview.email;
            const badge = event.root.querySelector(".inv .meta .bd.ok");
            if (badge) badge.innerHTML = `<i></i>For ${preview.email}`;
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

      if (event.type === "otp") {
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
        const next = new URLSearchParams(location.search).get("next") || "/app";
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
        return { ok: true, href: mfaDestination() };
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
        const pending = { firmName: val(event.root, "firm"), sampleMode: mode !== "pilot" };
        sessionStorage.setItem("cv-trial", JSON.stringify(pending));
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
        const pending = sessionStorage.getItem("cv-trial");
        if (pending) {
          try {
            const trial = JSON.parse(pending) as { sampleMode?: boolean };
            fields.sample_mode = trial.sampleMode !== false;
          } catch {
            sessionStorage.removeItem("cv-trial");
          }
        }
        return saveSetupStep(event.step, fields);
      }
      if ((page === "accept-client" || page === "accept-family" || page === "accept-sponsor") && token && el.hasAttribute("data-next")) {
        if (!invite.current) {
          const opened = await previewPortalInvitation(token);
          if ("error" in opened) return { ok: false, message: opened.error ?? "This invitation could not be opened." };
          invite.current = asPreview(opened.preview);
        }
        const preview = invite.current;
        if (!preview || preview.status !== "open") return { ok: false, message: "This invitation can no longer be used." };
        const draft = portalAcceptPayload(event.root, preview, page);
        if ("error" in draft) return { ok: false, message: draft.error };
        const saved = await savePortalInvitationDraft(token, { ...draft, step: event.step });
        if ("error" in saved) return { ok: false, message: saved.error ?? "That draft could not be saved." };
        const finishing =
          (page === "accept-client" && event.step === 3) ||
          (page === "accept-family" && event.step === 3) ||
          (page === "accept-sponsor" && event.step === 2);
        if (!finishing) return null;
        const accepted = await acceptPortalInvitation(token, draft);
        if ("error" in accepted) return { ok: false, message: accepted.error ?? "That invitation could not be accepted." };
        if (page === "accept-client") return null;
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
