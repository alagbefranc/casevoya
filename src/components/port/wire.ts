"use client";

import { useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
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

export function usePortActions(page: string, token?: string) {
  const ctx = useRef<Ctx | null>(null);
  const enrolled = useRef<string | null>(null);

  return useCallback(
    async (event: PortEvent): Promise<PortResult> => {
      if (!ctx.current) ctx.current = await getAuthContext();
      const session = ctx.current;

      if (event.type === "step") {
        if (page === "mfa" && event.step === 2 && session.signedIn && !session.factorId && !enrolled.current) {
          const started = await enrollAuthenticator();
          if (started) {
            enrolled.current = started.factorId;
            const key = event.root.querySelector(".key b");
            if (key) key.textContent = started.secret.replace(/(.{4})/g, "$1 ").trim();
            const svg = event.root.querySelector(".qr svg");
            if (svg) {
              const img = document.createElement("img");
              img.src = started.qr;
              img.alt = "QR code for your authenticator app";
              img.width = 132;
              img.height = 132;
              svg.replaceWith(img);
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
          return issueRecoveryCodes();
        }
        if (page === "mfa" && session.factorId && (event.then === "/sheet" || event.then.startsWith("/sheet/matter"))) {
          const verified = await verifyTotpCode(session.factorId, event.code);
          if (!verified || verified.ok === false) return verified;
          const next = new URLSearchParams(location.search).get("next") || event.then;
          return { ok: true, href: next };
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
        return { ok: true, href: new URLSearchParams(location.search).get("next") || "/app" };
      }
      if (page === "mfa" && event.step === 5 && el.dataset.href === "/sheet") {
        const redeemed = await redeemRecovery(val(event.root, "rc"));
        if (!redeemed || redeemed.ok === false) return redeemed;
        return { ok: true, href: new URLSearchParams(location.search).get("next") || "/app" };
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
        return createTrialFirm(pending);
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
      if (page === "setup" && el.hasAttribute("data-next") && event.step < 7) {
        const panel = event.root.querySelector<HTMLElement>(`[data-step="${event.step}"]`);
        const fields: Record<string, string | boolean> = {};
        panel?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea").forEach((input) => {
          if (!input.id) return;
          fields[input.id] = input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input.value;
        });
        const brand = document.getElementById("prev")?.style.getPropertyValue("--brand");
        if (brand) fields.brand = brand.trim();
        const years = document.querySelector("#retS .v")?.textContent;
        if (years) fields.retention_years = years;
        return saveSetupStep(event.step, fields);
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
