"use client";

import { useEffect, useLayoutEffect, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { toast2 } from "@/components/port/kit";
import { dialogId, withoutDialog } from "@/modules/sheet/matter-wire";
import { withoutNew } from "@/modules/sheet/new-matter";
import { sheetStateCopy } from "@/modules/sheet/present";
import { INVITE_DIALOG } from "@/modules/sheet/staff-present";
import {
  prefillAgreementTerms,
  reopenAgreementDialogs,
  reopenCountersign,
  runApproveTemplate,
  runCountersign,
  runNewAgreement,
  runNewTemplate,
} from "./agreement-acts";
import { openRefund, reopenInvoiceDialog, reopenRefundDialog, runNewInvoice, runRefund } from "./finance-acts";
import {
  openFunds,
  openReview,
  openVerify,
  reopenFundsDialog,
  runApprove,
  runBankTransfer,
  runClientAccount,
  runCorrection,
  runDecline,
  runDeposit,
  runRefundToClient,
  runReject,
  runTransfer,
  runVerify,
  syncFundsLedger,
} from "./funds-acts";
import {
  copyLink,
  openAvailability,
  openBooking,
  openBookingType,
  runAvailability,
  runBookingSubmit,
  runBookingType,
  runOutcome,
  syncBookTimes,
} from "./booking-acts";
import {
  openCreditReview,
  reopenCorrectionsDialog,
  runCreditDecline,
  runCreditDraft,
  runCreditIssue,
  runRecDiscard,
  runRecPrepare,
  runRecSign,
  runVoid,
} from "./corrections-acts";
import { openDocReview, reopenDocReview, runDocFile, runDocReview } from "./documents-acts";
import { restoreDocRequest, runDocRequest } from "./doc-request-act";
import { runInboxDismiss, runInboxFile, runInboxMove } from "./inbox-acts";
import { runInboxCompose, runInboxReply } from "./inbox-reply-acts";
import { bindGovControls } from "./gov-acts";
import {
  openRedaction,
  reopenComplianceDialog,
  runComplaintNew,
  runComplaintStep,
  runComplianceSettings,
  runPrivacyClose,
  runPrivacyNew,
  runPrivacyStep,
  runRedaction,
} from "./compliance-acts";
import { runMatterAct } from "./matter-acts";
import { runNewMatter } from "./new-matter-act";
import { markAllNotificationsRead, openNotification } from "./notification-acts";
import { wireLead, wirePipeline } from "./pipeline-acts";
import { runNewTask, syncNewTask } from "./new-task-act";
import { runReportExport } from "./report-acts";
import { runExportAct } from "./export-acts";
import { runMigrationAct } from "./migration-acts";
import { inviteFromEdit, openPersonEdit, runPersonEdit } from "./person-edit-act";
import { openPortalInvite, reopenPortalInvite, runPortalInvite } from "./portal-invite-act";
import { policyDialogId, restorePolicyDraft, runPublishPolicy } from "./portal-policy-act";
import { POLICY_KINDS, policyKindForDialog } from "@/modules/portal-policies/defaults";
import { restoreStaffInvite, runStaffInvite, runStaffResend, runStaffRevoke } from "./staff-invite-act";
import { reopenGrantDialog, runGrantCreate } from "./grants-acts";
import { mountIntakeBuilder } from "./intake-builder-acts";
import { runVoAsk, runVoDiscard, runVoSetting, runVoUseful } from "./vo-acts";
import { runVoDocAccept, runVoDocDiscard, runVoDocReject, runVoRead } from "./vo-doc-acts";
import { mountRetentionSlider, runRetentionSave } from "./retention-act";
import { openLicenceReport, reopenLicenceDialog, runLicenceAdd, runLicenceReport, runReassign, syncReassign } from "./licence-acts";
import {
  mountIntegrations,
  runComposioEnable,
  runComposioSwitch,
  runIntConnect,
  runIntDisconnect,
  runIntSync,
  runNotifPref,
  runQuietHours,
  runWaConnect,
  runWaDisconnect,
} from "./settings-integrations-acts";
import { reopenFirmDialog, runFirmSave } from "./settings-firm-acts";
import { bindOffboardHold, mountMember, mountOffboard, reopenStaffAdmin, runContinuitySave, runMemberAct } from "./settings-staff-admin-acts";

const ASSET = "/assets/icons-coreui/sprite.svg";
const NEW_MATTER = "/sheet/matters?new=1";

function icon(name: string, cls = ""): string {
  return `<svg class="ic ${cls}" aria-hidden="true"><use href="${ASSET}#i-${name}"/></svg>`;
}

function art(name: string, px: number) {
  return `<span class="art" style="--a:${px}px" aria-hidden="true"><img src="/assets/generated/b2/${name}-160@1x.webp" srcset="/assets/generated/b2/${name}-160@2x.webp 2x" width="${px}" height="${px}" alt="" loading="lazy" decoding="async"></span>`;
}

/** The Client funds dialogs' submit buttons. */
const FUNDS_SUBMIT =
  "[data-funds-deposit], [data-funds-verify], [data-funds-reject], [data-funds-approve], [data-funds-decline], [data-funds-transfer], [data-funds-refund], [data-funds-correct], [data-funds-account], [data-funds-bank]";

function runFundsSubmit(button: HTMLElement, router: Parameters<typeof runDeposit>[1]): Promise<void> {
  const data = button.dataset;
  if ("fundsDeposit" in data) return runDeposit(button, router);
  if ("fundsVerify" in data) return runVerify(button, router);
  if ("fundsReject" in data) return runReject(button, router);
  if ("fundsApprove" in data) return runApprove(button, router);
  if ("fundsDecline" in data) return runDecline(button, router);
  if ("fundsTransfer" in data) return runTransfer(button, router);
  if ("fundsRefund" in data) return runRefundToClient(button, router);
  if ("fundsCorrect" in data) return runCorrection(button, router);
  if ("fundsBank" in data) return runBankTransfer(button, router);
  return runClientAccount(button, router);
}

/** The single-invoice tab's credit note and void submits, and the Reconciliation tab's. */
const CORRECTIONS_SUBMIT = "[data-cn-submit], [data-cn-issue], [data-cn-decline], [data-void-submit], [data-rec-prepare], [data-rec-sign], [data-rec-discard]";

function runCorrectionsSubmit(button: HTMLElement, router: Parameters<typeof runDeposit>[1]): Promise<void> {
  const data = button.dataset;
  if ("cnSubmit" in data) return runCreditDraft(button, router);
  if ("cnIssue" in data) return runCreditIssue(button, router);
  if ("cnDecline" in data) return runCreditDecline(button, router);
  if ("voidSubmit" in data) return runVoid(button, router);
  if ("recPrepare" in data) return runRecPrepare(button, router);
  if ("recSign" in data) return runRecSign(button, router);
  return runRecDiscard(button, router);
}

/** How long "Hold to revoke" must be held. */
const HOLD_MS = 900;

const FILTER_TOKEN: Record<string, string> = {
  Mine: "mine",
  Overdue: "overdue",
  Blocked: "blocked",
  "High priority": "high",
  Applicants: "applicant",
  Sponsors: "sponsor",
  Dependants: "dependant",
  Leads: "lead",
  Waiting: "waiting",
  Executed: "executed",
  Quotes: "quote",
  "Declined, voided, expired": "closed",
  Draft: "draft",
  Issued: "issued",
  "Partially paid": "partial",
  Paid: "paid",
  "Voided or credited": "closed",
  Unassigned: "unassigned",
  Money: "money",
  Government: "government",
  "Awaiting review": "review",
  Quarantined: "quarantined",
  "Expiring soon": "expiring",
  // Vo and AI > Run log.
  Accepted: "accepted",
  Edited: "edited",
  Rejected: "rejected",
  Abstained: "abstained",
};
/** Pages whose `.fp-bar` chips and search filter real rows by their `data-f` tokens. */
const FILTER_PAGES = new Set(["tasks", "clients", "agreements", "finance", "documents", "queue", "ai"]);

export function useSheet(ref: RefObject<HTMLElement | null>, page: string) {
  const router = useRouter();
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const ac = new AbortController();
    const listen = { signal: ac.signal };

    const side = root.querySelector<HTMLElement>("#side");
    const scrim = root.querySelector<HTMLElement>("#scrimd");
    const shut = () => {
      side?.classList.remove("open");
      scrim?.classList.remove("on");
    };
    root.querySelector("#mOpen")?.addEventListener("click", () => {
      side?.classList.add("open");
      scrim?.classList.add("on");
    }, listen);
    root.querySelector("#mClose")?.addEventListener("click", shut, listen);
    scrim?.addEventListener("click", shut, listen);
    // Government status, Submissions and Decisions (T036 to T039): `data-gov` controls and file picks.
    bindGovControls(root, router, listen);

    root.querySelectorAll<HTMLButtonElement>(".grp>button").forEach((button) => {
      button.addEventListener("click", () => {
        const group = button.parentElement;
        group?.classList.toggle("shut");
        button.setAttribute("aria-expanded", String(!group?.classList.contains("shut")));
      }, listen);
    });

    const place = () => {
      const underline = root.querySelector<HTMLElement>(".tabs .ul");
      const current = root.querySelector<HTMLElement>(".tabs button.on");
      if (!underline || !current) return;
      underline.style.left = `${current.offsetLeft}px`;
      underline.style.width = `${current.offsetWidth}px`;
    };
    place();
    root.querySelectorAll<HTMLButtonElement>(".tabs button[data-t]").forEach((button) => {
      button.addEventListener("click", () => {
        const url = new URL(window.location.href);
        url.searchParams.set("tab", button.dataset.t || "");
        router.replace(`${url.pathname}${url.search}`);
      }, listen);
    });

    const openDialog = (id: string) => {
      const dialog = root.querySelector<HTMLDialogElement>(`#${CSS.escape(id)}`);
      if (dialog && !dialog.open) dialog.showModal();
    };
    const closeDialog = (id: string) => {
      const dialog = root.querySelector<HTMLDialogElement>(`#${CSS.escape(id)}`);
      dialog?.close();
    };

    // The Tasks page's filter chips (All, Mine, Overdue, Blocked, High priority) and the Clients
    // page's (All, Applicants, Sponsors, Dependants, Leads), with search, narrow the real rows by
    // their `data-f` tokens and text, and keep "N of M shown" true where the page has it.
    // The Team queue's bar is the Designer's plain `.bar`, and its rows are the `#ql` list items.
    const filters = FILTER_PAGES.has(page) ? root.querySelector<HTMLElement>(page === "queue" ? "#content > .bar" : ".fp-bar") : null;
    const applyFilters = () => {
      if (!filters) return;
      const q = (filters.querySelector("input")?.value ?? "").trim().toLowerCase();
      const token = FILTER_TOKEN[filters.querySelector(".fchip.on")?.textContent?.trim() ?? ""] ?? "";
      const rows = [...root.querySelectorAll<HTMLElement>(page === "queue" ? "#ql .li" : ".t tbody tr")];
      let shown = 0;
      for (const row of rows) {
        const flags = (row.dataset.f ?? "").split(" ");
        const hide = (Boolean(q) && !row.textContent.toLowerCase().includes(q)) || (Boolean(token) && !flags.includes(token));
        row.hidden = hide;
        if (!hide) shown++;
      }
      const count = root.querySelector<HTMLElement>("#content > p.sr");
      if (count) count.textContent = `${shown} of ${rows.length} shown`;
      const none = shown === 0 && rows.length > 0;
      root.querySelector<HTMLElement>("#content > .tw")?.toggleAttribute("hidden", none);
      root.querySelector<HTMLElement>("#content > .fp-fe")?.toggleAttribute("hidden", !none);
    };

    root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      // Every "New matter" entry point: the dialog on the Matters page, or the Matters page with it open.
      const create = target.closest<HTMLElement>(`#newB, a[href="${NEW_MATTER}"], a.add`);
      if (create && root.contains(create) && (!create.matches("a.add") || create.textContent.trim() === "New matter")) {
        event.preventDefault();
        // The licence-suspended home pauses New: the database refuses a new matter anyway.
        if (create.getAttribute("aria-disabled") === "true") {
          toast2(create.getAttribute("title") || "Paused", { kind: "warn", sub: "Your licence check needs to confirm good standing first." });
          return;
        }
        if (root.querySelector("#dlgNew")) openDialog("dlgNew");
        else window.location.assign(NEW_MATTER);
        return;
      }
      const save = target.closest<HTMLElement>("[data-new-matter]");
      if (save && root.contains(save)) {
        event.preventDefault();
        if (save.getAttribute("aria-busy") === "true") return;
        save.setAttribute("aria-busy", "true");
        void runNewMatter(save, router).finally(() => save.removeAttribute("aria-busy"));
        return;
      }
      // The Agreements page. Each control is keyed by its own data attribute, so the Matters and
      // Clients pages' New matter dialog (#dlgNew) never answers here, nor these there.
      const agreement = target.closest<HTMLElement>("[data-new-agreement]");
      if (agreement && root.contains(agreement)) {
        event.preventDefault();
        if (agreement.getAttribute("aria-busy") === "true" || agreement.hasAttribute("disabled")) return;
        agreement.setAttribute("aria-busy", "true");
        void runNewAgreement(agreement, router).finally(() => agreement.removeAttribute("aria-busy"));
        return;
      }
      // The Finance page's New invoice.
      const invoice = target.closest<HTMLElement>("[data-new-invoice]");
      if (invoice && root.contains(invoice)) {
        event.preventDefault();
        if (invoice.getAttribute("aria-busy") === "true" || invoice.hasAttribute("disabled")) return;
        invoice.setAttribute("aria-busy", "true");
        void runNewInvoice(invoice, router).finally(() => invoice.removeAttribute("aria-busy"));
        return;
      }
      // The Payments tab: a row's Refund fills and opens #dlgRefund; its Refund button asks Stripe.
      const refundOpen = target.closest<HTMLElement>("[data-refund-open]");
      if (refundOpen && root.contains(refundOpen)) {
        event.preventDefault();
        openRefund(refundOpen, root, openDialog);
        return;
      }
      const refund = target.closest<HTMLElement>("[data-refund-submit]");
      if (refund && root.contains(refund)) {
        event.preventDefault();
        if (refund.getAttribute("aria-busy") === "true" || refund.hasAttribute("disabled")) return;
        refund.setAttribute("aria-busy", "true");
        void runRefund(refund, router).finally(() => refund.removeAttribute("aria-busy"));
        return;
      }
      // The Client funds tab: openers fill and open its dialogs; each submit is keyed by its own attribute.
      const fundsOpener = target.closest<HTMLElement>("[data-funds-open], [data-funds-verify-open], [data-funds-review]");
      if (fundsOpener && root.contains(fundsOpener)) {
        event.preventDefault();
        if (fundsOpener.hasAttribute("data-funds-open")) openFunds(fundsOpener, root, openDialog);
        else if (fundsOpener.hasAttribute("data-funds-verify-open")) openVerify(fundsOpener, root, openDialog);
        else openReview(fundsOpener, root, openDialog);
        return;
      }
      const fundsSubmit = target.closest<HTMLElement>(FUNDS_SUBMIT);
      if (fundsSubmit && root.contains(fundsSubmit)) {
        event.preventDefault();
        if (fundsSubmit.getAttribute("aria-busy") === "true" || fundsSubmit.hasAttribute("disabled")) return;
        fundsSubmit.setAttribute("aria-busy", "true");
        void runFundsSubmit(fundsSubmit, router).finally(() => fundsSubmit.removeAttribute("aria-busy"));
        return;
      }
      // One invoice's credit notes and void, and the Reconciliation tab: a draft's Review fills
      // #dlgCNR; each submit is keyed by its own attribute.
      const creditReview = target.closest<HTMLElement>("[data-cn-review]");
      if (creditReview && root.contains(creditReview)) {
        event.preventDefault();
        openCreditReview(creditReview, root, openDialog);
        return;
      }
      const correction = target.closest<HTMLElement>(CORRECTIONS_SUBMIT);
      if (correction && root.contains(correction)) {
        event.preventDefault();
        if (correction.getAttribute("aria-busy") === "true" || correction.hasAttribute("disabled")) return;
        correction.setAttribute("aria-busy", "true");
        void runCorrectionsSubmit(correction, router).finally(() => correction.removeAttribute("aria-busy"));
        return;
      }
      // Countersign: the signed-in consultant signs an envelope where it is their turn.
      const countersign = target.closest<HTMLElement>("[data-countersign]");
      if (countersign && root.contains(countersign)) {
        event.preventDefault();
        if (countersign.getAttribute("aria-busy") === "true") return;
        countersign.setAttribute("aria-busy", "true");
        void runCountersign(countersign, router).finally(() => countersign.removeAttribute("aria-busy"));
        return;
      }
      const template = target.closest<HTMLElement>("[data-new-template]");
      if (template && root.contains(template)) {
        event.preventDefault();
        if (template.getAttribute("aria-busy") === "true") return;
        template.setAttribute("aria-busy", "true");
        void runNewTemplate(template, router).finally(() => template.removeAttribute("aria-busy"));
        return;
      }
      const approve = target.closest<HTMLElement>("[data-approve-template]");
      if (approve && root.contains(approve)) {
        event.preventDefault();
        if (approve.getAttribute("aria-busy") === "true") return;
        approve.setAttribute("aria-busy", "true");
        void runApproveTemplate(approve, router).finally(() => approve.removeAttribute("aria-busy"));
        return;
      }
      // Settings > Firm, Offices, Branding, Language and time: the dialogs' Save and Remove office.
      const firmSave = target.closest<HTMLElement>("[data-firm-save]");
      if (firmSave && root.contains(firmSave)) {
        event.preventDefault();
        if (firmSave.getAttribute("aria-busy") === "true") return;
        firmSave.setAttribute("aria-busy", "true");
        void runFirmSave(firmSave, router).finally(() => firmSave.removeAttribute("aria-busy"));
        return;
      }
      // Settings > Team and seats: Change role or access (role, suspend) and the continuity contact.
      const staffAdmin = target.closest<HTMLElement>("[data-member-act], [data-continuity-save]");
      if (staffAdmin && root.contains(staffAdmin)) {
        event.preventDefault();
        if (staffAdmin.getAttribute("aria-busy") === "true") return;
        staffAdmin.setAttribute("aria-busy", "true");
        const run = staffAdmin.hasAttribute("data-member-act") ? runMemberAct(staffAdmin, router) : runContinuitySave(staffAdmin, router);
        void run.finally(() => staffAdmin.removeAttribute("aria-busy"));
        return;
      }
      // Licences: Add a licence and Report a change; the licence-suspended home's Reassign work.
      const licence = target.closest<HTMLElement>("[data-licence-add], [data-licence-report], [data-licence-send], [data-reassign-from]");
      if (licence && root.contains(licence)) {
        event.preventDefault();
        if (licence.dataset.licenceAdd === "open") return openDialog("dlgAdd");
        if (licence.hasAttribute("data-licence-report")) return openLicenceReport(licence, root, openDialog);
        if (licence.getAttribute("aria-busy") === "true") return;
        licence.setAttribute("aria-busy", "true");
        const run = licence.hasAttribute("data-licence-add")
          ? runLicenceAdd(licence, router)
          : licence.hasAttribute("data-licence-send")
            ? runLicenceReport(licence, router)
            : runReassign(licence, router);
        void run.finally(() => licence.removeAttribute("aria-busy"));
        return;
      }
      // Access grants: Create grant saves through the database (New grant opens #dlgG by data-dlg).
      const grantCreate = target.closest<HTMLElement>("[data-grant-create]");
      if (grantCreate && root.contains(grantCreate)) {
        event.preventDefault();
        if (grantCreate.getAttribute("aria-busy") === "true") return;
        grantCreate.setAttribute("aria-busy", "true");
        void runGrantCreate(grantCreate, router).finally(() => grantCreate.removeAttribute("aria-busy"));
        return;
      }
      // The Staff tab: Invite staff opens the Designer's dialog; Send, Resend and revoke go to the database.
      if (target.closest("#invB") && root.querySelector("#dlgS [data-org]")) {
        event.preventDefault();
        openDialog("dlgS");
        return;
      }
      const invite = target.closest<HTMLElement>("#dlgS [data-org]");
      if (invite && root.contains(invite)) {
        event.preventDefault();
        if (invite.getAttribute("aria-busy") === "true") return;
        invite.setAttribute("aria-busy", "true");
        void runStaffInvite(invite, router).finally(() => invite.removeAttribute("aria-busy"));
        return;
      }
      const invitation = target.closest<HTMLElement>("[data-invitation]");
      if (invitation && root.contains(invitation)) {
        event.preventDefault();
        if (invitation.getAttribute("aria-busy") === "true") return;
        // Revoking needs a press and hold (pointer or keyboard, below); a click alone does not revoke.
        if (invitation.hasAttribute("data-hold")) return;
        invitation.setAttribute("aria-busy", "true");
        void runStaffResend(invitation, root, router).finally(() => invitation.removeAttribute("aria-busy"));
        return;
      }
      const task = target.closest<HTMLElement>("[data-new-task]");
      if (task && root.contains(task)) {
        event.preventDefault();
        if (task.getAttribute("aria-busy") === "true") return;
        task.setAttribute("aria-busy", "true");
        void runNewTask(task, router).finally(() => task.removeAttribute("aria-busy"));
        return;
      }
      // Reports > Export, and the Client-file exports page (start, cancel, download, closure, legal hold).
      const reportExport = target.closest<HTMLElement>("[data-report-export]");
      if (reportExport && root.contains(reportExport)) {
        event.preventDefault();
        if (reportExport.getAttribute("aria-busy") === "true" || reportExport.hasAttribute("disabled")) return;
        reportExport.setAttribute("aria-busy", "true");
        void runReportExport(reportExport).finally(() => reportExport.removeAttribute("aria-busy"));
        return;
      }
      const exportAct = target.closest<HTMLElement>("[data-export-act]");
      if (exportAct && root.contains(exportAct)) {
        event.preventDefault();
        if (exportAct.getAttribute("aria-busy") === "true" || exportAct.hasAttribute("disabled")) return;
        exportAct.setAttribute("aria-busy", "true");
        void runExportAct(exportAct, root, router).finally(() => exportAct.removeAttribute("aria-busy"));
        return;
      }
      // Migration import (T044): upload, mapping and preview, duplicate decisions, sign-off, rollback.
      const migrationAct = target.closest<HTMLElement>("[data-mig-act]");
      if (migrationAct && root.contains(migrationAct)) {
        event.preventDefault();
        if (migrationAct.getAttribute("aria-busy") === "true" || migrationAct.hasAttribute("disabled")) return;
        migrationAct.setAttribute("aria-busy", "true");
        void runMigrationAct(migrationAct, root, router).finally(() => migrationAct.removeAttribute("aria-busy"));
        return;
      }
      const palette = target.closest<HTMLElement>("[data-palette]");
      if (palette && root.contains(palette)) {
        event.preventDefault();
        openPalette(root, (href) => router.push(href));
        return;
      }
      // Edit details: opened from a person (Clients page person tab, a matter People card), saved through RLS.
      const editOpen = target.closest<HTMLElement>("[data-edit-open]");
      if (editOpen && root.contains(editOpen)) {
        event.preventDefault();
        openPersonEdit(editOpen, root);
        return;
      }
      const editInvite = target.closest<HTMLElement>("[data-edit-invite]");
      if (editInvite && root.contains(editInvite)) {
        event.preventDefault();
        inviteFromEdit(editInvite, root);
        return;
      }
      const editSave = target.closest<HTMLElement>("[data-person-save]");
      if (editSave && root.contains(editSave)) {
        event.preventDefault();
        if (editSave.getAttribute("aria-busy") === "true") return;
        editSave.setAttribute("aria-busy", "true");
        void runPersonEdit(editSave, router).finally(() => editSave.removeAttribute("aria-busy"));
        return;
      }
      const portalInvite = target.closest<HTMLElement>("[data-invite-open]");
      if (portalInvite && root.contains(portalInvite)) {
        event.preventDefault();
        openPortalInvite(portalInvite, root);
        return;
      }
      const send = target.closest<HTMLElement>("[data-invite]");
      if (send && root.contains(send)) {
        event.preventDefault();
        if (send.getAttribute("aria-busy") === "true") return;
        send.setAttribute("aria-busy", "true");
        void runPortalInvite(send, router).finally(() => send.removeAttribute("aria-busy"));
        return;
      }
      // Settings > Client portal: Publish saves a new version of the terms or privacy notice.
      const policy = target.closest<HTMLElement>("[data-policy][data-org]");
      if (policy && root.contains(policy)) {
        event.preventDefault();
        if (policy.getAttribute("aria-busy") === "true") return;
        policy.setAttribute("aria-busy", "true");
        void runPublishPolicy(policy, router).finally(() => policy.removeAttribute("aria-busy"));
        return;
      }
      // Consultations: row actions, the booking dialogs, working hours and booking types.
      const bookingOpen = target.closest<HTMLElement>("[data-booking-open]");
      if (bookingOpen && root.contains(bookingOpen)) {
        event.preventDefault();
        void openBooking(bookingOpen, root, openDialog);
        return;
      }
      const busyRun = (button: HTMLElement, run: () => Promise<void>) => {
        if (button.getAttribute("aria-busy") === "true") return;
        button.setAttribute("aria-busy", "true");
        void run().finally(() => button.removeAttribute("aria-busy"));
      };
      // Settings > Retention (firm owner): Save stores the slider's period as a new policy version.
      const retentionSave = target.closest<HTMLElement>("[data-retention-save]");
      if (retentionSave && root.contains(retentionSave)) {
        event.preventDefault();
        busyRun(retentionSave, () => runRetentionSave(retentionSave, router));
        return;
      }
      const bookingSubmit = target.closest<HTMLElement>("[data-booking-submit]");
      if (bookingSubmit && root.contains(bookingSubmit)) {
        event.preventDefault();
        busyRun(bookingSubmit, () => runBookingSubmit(bookingSubmit, router));
        return;
      }
      const outcome = target.closest<HTMLElement>("[data-booking-outcome]");
      if (outcome && root.contains(outcome)) {
        event.preventDefault();
        busyRun(outcome, () => runOutcome(outcome, router));
        return;
      }
      const availOpen = target.closest<HTMLElement>("[data-avail-open]");
      if (availOpen && root.contains(availOpen)) {
        event.preventDefault();
        openAvailability(availOpen, root, openDialog);
        return;
      }
      const availSubmit = target.closest<HTMLElement>("[data-avail-submit]");
      if (availSubmit && root.contains(availSubmit)) {
        event.preventDefault();
        busyRun(availSubmit, () => runAvailability(availSubmit, router));
        return;
      }
      const typeOpen = target.closest<HTMLElement>("[data-type-open]");
      if (typeOpen && root.contains(typeOpen)) {
        event.preventDefault();
        openBookingType(typeOpen, root, openDialog);
        return;
      }
      const typeSubmit = target.closest<HTMLElement>("[data-type-submit]");
      if (typeSubmit && root.contains(typeSubmit)) {
        event.preventDefault();
        busyRun(typeSubmit, () => runBookingType(typeSubmit, router));
        return;
      }
      // Notifications: a row is marked read and opens its record; Mark all read marks every row.
      const notification = target.closest<HTMLElement>("[data-notif]");
      if (notification && root.contains(notification)) {
        event.preventDefault();
        void openNotification(notification, root.querySelector<HTMLElement>("#mar")?.dataset.org ?? "", router);
        return;
      }
      const markAll = target.closest<HTMLElement>("#mar[data-org]");
      if (markAll && root.contains(markAll)) {
        event.preventDefault();
        busyRun(markAll, () => markAllNotificationsRead(markAll, router));
        return;
      }
      // Documents: a To review link opens the review dialog; Save review and Open file go to the database.
      const docReview = target.closest<HTMLElement>("[data-doc-review]");
      if (docReview && root.contains(docReview) && root.querySelector("#dlgDocRev")) {
        event.preventDefault();
        openDocReview(docReview, root, openDialog);
        return;
      }
      const docSubmit = target.closest<HTMLElement>("[data-doc-review-submit]");
      if (docSubmit && root.contains(docSubmit)) {
        event.preventDefault();
        busyRun(docSubmit, () => runDocReview(docSubmit, router));
        return;
      }
      // The matter page's Request a document: Send request goes to public.create_document_request.
      const docRequest = target.closest<HTMLElement>("[data-doc-request]");
      if (docRequest && root.contains(docRequest)) {
        event.preventDefault();
        busyRun(docRequest, () => runDocRequest(docRequest, router));
        return;
      }
      const docFile = target.closest<HTMLElement>("[data-doc-file]");
      if (docFile && root.contains(docFile)) {
        event.preventDefault();
        busyRun(docFile, () => runDocFile(docFile));
        return;
      }
      // Inbox, Email to triage: file to a person, move a filed email's files, or dismiss.
      const inboxFile = target.closest<HTMLElement>("[data-inbox-file]");
      if (inboxFile && root.contains(inboxFile)) {
        event.preventDefault();
        busyRun(inboxFile, () => runInboxFile(inboxFile, router));
        return;
      }
      const inboxMove = target.closest<HTMLElement>("[data-inbox-move]");
      if (inboxMove && root.contains(inboxMove)) {
        event.preventDefault();
        busyRun(inboxMove, () => runInboxMove(inboxMove, router));
        return;
      }
      const inboxDismiss = target.closest<HTMLElement>("[data-inbox-dismiss]");
      if (inboxDismiss && root.contains(inboxDismiss)) {
        event.preventDefault();
        busyRun(inboxDismiss, () => runInboxDismiss(inboxDismiss, router));
        return;
      }
      // Inbox, Conversations and New message: send a reply or a new email to a person on a matter.
      const inboxReply = target.closest<HTMLElement>("[data-inbox-reply]");
      if (inboxReply && root.contains(inboxReply)) {
        event.preventDefault();
        busyRun(inboxReply, () => runInboxReply(inboxReply, root, router));
        return;
      }
      const inboxCompose = target.closest<HTMLElement>("[data-inbox-compose]");
      if (inboxCompose && root.contains(inboxCompose)) {
        event.preventDefault();
        busyRun(inboxCompose, () => runInboxCompose(inboxCompose, root, router));
        return;
      }
      // Compliance: privacy requests, the complaints register and their settings.
      const redactionOpen = target.closest<HTMLElement>("[data-redaction-new], [data-redaction-edit]");
      if (redactionOpen && root.contains(redactionOpen)) {
        event.preventDefault();
        openRedaction(redactionOpen, root, openDialog);
        return;
      }
      const compliance = target.closest<HTMLElement>(
        "[data-privacy-new], [data-privacy-step], [data-privacy-redaction], [data-privacy-close], [data-complaint-new], [data-complaint-step], [data-compliance-settings]",
      );
      if (compliance && root.contains(compliance)) {
        event.preventDefault();
        const data = compliance.dataset;
        const run =
          data.privacyNew !== undefined
            ? runPrivacyNew
            : data.privacyStep !== undefined
              ? runPrivacyStep
              : data.privacyRedaction !== undefined
                ? runRedaction
                : data.privacyClose !== undefined
                  ? runPrivacyClose
                  : data.complaintNew !== undefined
                    ? runComplaintNew
                    : data.complaintStep !== undefined
                      ? runComplaintStep
                      : runComplianceSettings;
        busyRun(compliance, () => run(compliance, router));
        return;
      }
      // Vo document reading: Read with Vo, the review panel's Accept ticked / Reject the rest, and
      // Reject on a reading's card.
      const voDoc = target.closest<HTMLElement>("[data-vo-read], [data-vo-doc-accept], [data-vo-doc-reject], [data-vo-doc-discard]");
      if (voDoc && root.contains(voDoc)) {
        event.preventDefault();
        const run = voDoc.hasAttribute("data-vo-read")
          ? () => runVoRead(voDoc, router)
          : voDoc.hasAttribute("data-vo-doc-accept")
            ? () => runVoDocAccept(voDoc, router)
            : voDoc.hasAttribute("data-vo-doc-reject")
              ? () => runVoDocReject(voDoc, router)
              : () => runVoDocDiscard(voDoc, router);
        busyRun(voDoc, run);
        return;
      }
      // Vo drafts and Vo and AI: Reject, the owner's switches, "useful?" votes and Ask Vo.
      const vo = target.closest<HTMLElement>("[data-vo-discard], .k2-sw[data-vo-setting], [data-vo-useful], [data-vo-ask]");
      if (vo && root.contains(vo)) {
        event.preventDefault();
        const run = vo.hasAttribute("data-vo-discard")
          ? () => runVoDiscard(vo, router)
          : vo.hasAttribute("data-vo-setting")
            ? () => runVoSetting(vo, router)
            : vo.hasAttribute("data-vo-useful")
              ? () => runVoUseful(vo, router)
              : () => runVoAsk(vo);
        busyRun(vo, run);
        return;
      }
      // Settings > Integrations and Notifications: connected accounts, connections, busy times,
      // the person's own email switches and the firm's quiet hours.
      const setting = target.closest<HTMLElement>(
        ".k2-sw[data-composio], [data-composio-enable], [data-int-connect], [data-int-disconnect], [data-int-sync], .k2-sw[data-notif-pref], .k2-sw[data-quiet], [data-wa-connect], [data-wa-disconnect]",
      );
      if (setting && root.contains(setting)) {
        event.preventDefault();
        if (setting.hasAttribute("disabled")) return;
        const data = setting.dataset;
        const run =
          data.waConnect !== undefined
            ? () => runWaConnect(setting)
            : data.waDisconnect !== undefined
              ? () => runWaDisconnect(setting, router)
              : data.composio !== undefined
            ? () => runComposioSwitch(setting, openDialog, router)
            : data.composioEnable !== undefined
              ? () => runComposioEnable(setting, router)
              : data.intConnect !== undefined
                ? () => runIntConnect(setting)
                : data.intDisconnect !== undefined
                  ? () => runIntDisconnect(setting, router)
                  : data.intSync !== undefined
                    ? () => runIntSync(setting, router)
                    : data.notifPref !== undefined
                      ? () => runNotifPref(setting, router)
                      : () => runQuietHours(setting, router);
        busyRun(setting, run);
        return;
      }
      const nav = target.closest<HTMLElement>("[data-nav]");
      if (nav?.dataset.nav?.startsWith("/sheet/") && root.contains(nav)) {
        event.preventDefault();
        router.push(nav.dataset.nav);
        return;
      }
      const copy = target.closest<HTMLElement>("[data-copy]");
      if (copy && root.contains(copy)) void copyLink(copy);
      const act = target.closest<HTMLElement>("[data-act]");
      if (act && root.contains(act)) {
        event.preventDefault();
        if (act.getAttribute("aria-busy") === "true") return;
        act.setAttribute("aria-busy", "true");
        void runMatterAct(act, root, router).finally(() => act.removeAttribute("aria-busy"));
        return;
      }
      const opener = target.closest<HTMLElement>("[data-open], [data-dlg], [data-stage], [data-letter], [data-hold]");
      if (opener) {
        event.preventDefault();
        const id =
          opener.dataset.open ||
          opener.dataset.dlg ||
          (opener.hasAttribute("data-stage") ? "dStage" : opener.hasAttribute("data-letter") ? "dLetter" : "dHold");
        openDialog(id);
      }
      const closer = target.closest<HTMLElement>("[data-close], [data-x]");
      if (closer) {
        event.preventDefault();
        const dialog = closer.closest("dialog");
        if (closer.dataset.close) closeDialog(closer.dataset.close);
        else dialog?.close();
      }
      const toast = target.closest<HTMLElement>("[data-toast]");
      if (toast?.dataset.toast) {
        event.preventDefault();
        toast2(toast.dataset.toast, { kind: toast.dataset.toastKind || "", sub: toast.dataset.toastSub || "" });
      }
      const check = target.closest<HTMLElement>("[data-toggle-on], .ck");
      if (check && root.contains(check)) {
        event.preventDefault();
        event.stopPropagation();
        check.classList.toggle("on");
        check.setAttribute("aria-checked", String(check.classList.contains("on")));
        check.closest("li")?.classList.toggle("on", check.classList.contains("on"));
        check.closest("tr")?.classList.toggle("sel", check.classList.contains("on"));
      }
      const tab = target.closest<HTMLElement>("[data-goto-tab]");
      if (tab?.dataset.gotoTab) {
        event.preventDefault();
        const url = new URL(window.location.href);
        url.searchParams.set("tab", tab.dataset.gotoTab);
        router.replace(`${url.pathname}${url.search}`);
      }
      if (target.closest("[data-clear-search]")) {
        event.preventDefault();
        const url = new URL(window.location.href);
        url.searchParams.delete("state");
        router.replace(`${url.pathname}${url.search}`);
      }
      const bell = target.closest<HTMLElement>(".k2-bell");
      if (bell) bell.setAttribute("aria-pressed", String(bell.getAttribute("aria-pressed") !== "true"));
      const sw = target.closest<HTMLElement>(".k2-sw");
      if (sw) sw.setAttribute("aria-checked", String(sw.getAttribute("aria-checked") !== "true"));
      const fuse = target.closest<HTMLElement>(".k2-fb-idle, .k2-fb-undo");
      if (fuse) armFuse(fuse);
      const rubber = target.closest<HTMLElement>(".k2-rsw");
      const rubberButton = target.closest("button");
      if (rubber && rubberButton && rubber.contains(rubberButton)) {
        rubber.querySelectorAll("button").forEach((item) => item.setAttribute("aria-checked", String(item === rubberButton)));
        const mine = /Mine/.test(rubberButton.textContent || "");
        root.querySelectorAll<HTMLElement>("tbody tr").forEach((row) => {
          row.hidden = mine && !row.hasAttribute("data-mine");
        });
      }
      if (filters) {
        const chip = target.closest<HTMLElement>(".fchip");
        if (chip && filters.contains(chip)) {
          event.preventDefault();
          filters.querySelectorAll<HTMLElement>(".fchip").forEach((item) => {
            item.classList.toggle("on", item === chip);
            item.setAttribute("aria-pressed", String(item === chip));
          });
          applyFilters();
        }
        if (target.closest(".fp-fe button")) {
          event.preventDefault();
          const input = filters.querySelector("input");
          if (input) input.value = "";
          filters.querySelectorAll<HTMLElement>(".fchip").forEach((item, index) => {
            item.classList.toggle("on", index === 0);
            item.setAttribute("aria-pressed", String(index === 0));
          });
          applyFilters();
        }
      }
      const row = target.closest<HTMLElement>("tr[data-href], #ql .li[data-href]");
      if (row?.dataset.href && root.contains(row) && !target.closest("a, button, .ck")) {
        router.push(row.dataset.href);
      }
    }, listen);

    // The Intake form builder: select, rename, switches, add fields, autosave and publish.
    mountIntakeBuilder(root, router, ac.signal);
    // Back from a Composio Connect Link on Settings > Integrations.
    if (page === "settings") mountIntegrations(root, router);
    // Settings > Team and seats: the Offboard dialog's hold and previews, Change role or access, and
    // ?dlg=dlgOff|dlgMem|dlgCont (back from step-up); closing one of them drops ?dlg.
    if (page === "settings" && root.querySelector("#dlgOff [data-offboard], #dlgMem, [data-continuity-save]")) {
      bindOffboardHold(root, router, ac.signal);
      mountOffboard(root, ac.signal);
      mountMember(root, ac.signal);
      window.setTimeout(() => reopenStaffAdmin(root, openDialog), 300);
      root.querySelectorAll<HTMLDialogElement>("dialog#dlgOff, dialog#dlgMem, dialog#dlgCont").forEach((dialog) => {
        dialog.addEventListener("close", () => {
          if (new URLSearchParams(window.location.search).has("dlg")) router.replace(withoutDialog(window.location.pathname, window.location.search));
        }, listen);
      });
    }

    // "Hold to revoke" on a pending staff invitation: held for HOLD_MS, then revoked.
    let hold: number | undefined;
    const release = () => {
      window.clearTimeout(hold);
      hold = undefined;
    };
    const press = (event: Event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-invitation][data-hold]");
      if (!button || !root.contains(button) || button.getAttribute("aria-busy") === "true") return;
      if (event instanceof KeyboardEvent && (event.repeat || (event.key !== "Enter" && event.key !== " "))) return;
      event.preventDefault();
      release();
      hold = window.setTimeout(() => {
        hold = undefined;
        button.setAttribute("aria-busy", "true");
        void runStaffRevoke(button, root, router).finally(() => button.removeAttribute("aria-busy"));
      }, HOLD_MS);
    };
    root.addEventListener("pointerdown", press, listen);
    root.addEventListener("keydown", press, listen);
    for (const type of ["pointerup", "pointerout", "pointercancel", "keyup"]) root.addEventListener(type, release, listen);

    root.querySelectorAll<HTMLInputElement>('.bar input').forEach((input) => {
      if (filters?.contains(input)) {
        const preset = new URLSearchParams(window.location.search).get("q");
        if (preset && !input.value) input.value = preset;
        input.addEventListener("input", applyFilters, listen);
        applyFilters();
        return;
      }
      const apply = () => {
        const q = input.value.trim().toLowerCase();
        root.querySelectorAll<HTMLElement>(".t tbody tr").forEach((row) => {
          row.hidden = Boolean(q) && !row.textContent.toLowerCase().includes(q);
        });
      };
      const preset = new URLSearchParams(window.location.search).get("q");
      if (preset && !input.value) input.value = preset;
      input.addEventListener("input", apply, listen);
      apply();
    });

    root.querySelectorAll("form").forEach((form) => {
      if (form.getAttribute("data-live") === "1") return;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        toast2("This form isn’t connected yet", { kind: "warn", sub: "Nothing was saved." });
      }, listen);
    });

    const params = new URLSearchParams(window.location.search);
    const dialogParam = params.get("dlg");
    const dialog = dialogId(dialogParam);
    if (dialog) window.setTimeout(() => openDialog(dialog), 300);
    if (dialogParam === "request") restoreDocRequest(root);
    if (dialogParam === "invite") window.setTimeout(() => reopenPortalInvite(root, params.get("pid")), 300);
    const staffInvite = root.querySelector<HTMLDialogElement>("#dlgS");
    if (staffInvite && staffInvite.querySelector("[data-org]")) {
      // ?dlg=invite (coming back from step-up) reopens Invite staff with what was typed; closing drops the flag.
      if (dialogParam === INVITE_DIALOG) {
        window.setTimeout(() => {
          restoreStaffInvite(staffInvite);
          openDialog("dlgS");
        }, 300);
      }
      staffInvite.addEventListener("close", () => {
        if (new URLSearchParams(window.location.search).has("dlg")) router.replace(withoutDialog(window.location.pathname, window.location.search));
      }, listen);
    }
    // Settings > Retention: the firm owner's slider moves (firm setup's own k2Slider).
    if (page === "settings") mountRetentionSlider(root);
    // ?dlg=terms|privacy (coming back from step-up) reopens that publish dialog with what was typed.
    const policyKind = policyKindForDialog(dialogParam);
    for (const kind of POLICY_KINDS) {
      const policyDialog = root.querySelector<HTMLDialogElement>(`dialog#${policyDialogId(kind)}`);
      if (!policyDialog?.querySelector("[data-policy][data-org]")) continue;
      if (kind === policyKind) {
        window.setTimeout(() => {
          restorePolicyDraft(policyDialog, kind);
          openDialog(policyDialogId(kind));
        }, 300);
      }
      policyDialog.addEventListener("close", () => {
        if (new URLSearchParams(window.location.search).has("dlg")) router.replace(withoutDialog(window.location.pathname, window.location.search));
      }, listen);
    }
    const newMatter = root.querySelector<HTMLDialogElement>("#dlgNew");
    if (newMatter) {
      // ?new=1 (the sidebar link, or coming back from step-up) opens the dialog; closing it drops the flag.
      if (params.get("new") === "1") window.setTimeout(() => openDialog("dlgNew"), 300);
      newMatter.addEventListener("close", () => {
        if (new URLSearchParams(window.location.search).has("new")) router.replace(withoutNew(window.location.pathname, window.location.search));
      }, listen);
    }

    const newAgreement = root.querySelector<HTMLDialogElement>("dialog#dlgNewQ");
    if (newAgreement?.querySelector("[data-new-agreement]")) {
      // Choosing a template fills in its terms (fee, currency, not included, refund policy, government fees).
      prefillAgreementTerms(newAgreement);
      newAgreement.addEventListener("change", (event) => {
        if ((event.target as Element | null)?.id === "nqT") prefillAgreementTerms(newAgreement);
      }, listen);
      // ?dlg=agreement (from a matter page, or back from step-up) and ?dlg=template reopen the live dialogs.
      window.setTimeout(() => reopenAgreementDialogs(root, openDialog), 300);
      for (const live of [newAgreement, root.querySelector<HTMLDialogElement>("dialog#dlgTpl")]) {
        live?.addEventListener("close", () => {
          const search = new URLSearchParams(window.location.search);
          if (!search.has("dlg") || root.querySelector("dialog[open]")) return;
          search.delete("dlg");
          search.delete("matter");
          const query = search.toString();
          router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
        }, listen);
      }
    }

    // ?dlg=invoice (back from step-up) reopens the live New invoice dialog with what was typed.
    if (root.querySelector("dialog#dlgInv [data-new-invoice]")) window.setTimeout(() => reopenInvoiceDialog(root, openDialog), 300);
    // ?dlg=credit|recon (back from step-up) reopens the credit note, void or reconciliation dialog with what was typed.
    if (root.querySelector(CORRECTIONS_SUBMIT)) window.setTimeout(() => reopenCorrectionsDialog(root, openDialog), 300);
    // ?dlg=refund (back from step-up) reopens Refund for the same payment with what was typed.
    if (root.querySelector("dialog#dlgRefund [data-refund-submit]")) window.setTimeout(() => reopenRefundDialog(root, openDialog), 300);
    // ?dlg=funds (back from step-up) reopens the Client funds dialog with what was typed; the
    // chosen client ledger narrows the invoices a transfer can pay.
    if (root.querySelector(FUNDS_SUBMIT)) {
      window.setTimeout(() => reopenFundsDialog(root, openDialog), 300);
      for (const fundsDialog of root.querySelectorAll<HTMLDialogElement>("dialog")) {
        if (!fundsDialog.querySelector("select[data-ledger-select]")) continue;
        fundsDialog.addEventListener("change", (event) => {
          if ((event.target as Element | null)?.matches("select[data-ledger-select]")) syncFundsLedger(fundsDialog);
        }, listen);
      }
    }
    // ?dlg=countersign&envelope=… (back from step-up, or from the "your turn" email) reopens that
    // envelope's sign dialog on the Agreements or matter page; closing it drops the flag.
    const signDialogs = [...root.querySelectorAll<HTMLDialogElement>("dialog[data-sign-envelope]")];
    if (signDialogs.length) {
      window.setTimeout(() => reopenCountersign(root, openDialog), 300);
      for (const sign of signDialogs) {
        sign.addEventListener("close", () => {
          const search = new URLSearchParams(window.location.search);
          if (!search.has("envelope") || root.querySelector("dialog[open]")) return;
          search.delete("dlg");
          search.delete("envelope");
          const query = search.toString();
          router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
        }, listen);
      }
    }

    // Licences and the licence-suspended home: ?dlg=licence-add|licence-change|reassign (back from
    // step-up) reopens the dialog with what was typed; ticking matters keeps Reassign's count true.
    if (root.querySelector("[data-licence-send], [data-reassign-from]")) {
      window.setTimeout(() => reopenLicenceDialog(root, openDialog), 300);
      for (const id of ["dlgAdd", "dlgChg", "dlgRe"]) {
        root.querySelector<HTMLDialogElement>(`dialog#${id}`)?.addEventListener("close", () => {
          if (new URLSearchParams(window.location.search).has("dlg")) router.replace(withoutDialog(window.location.pathname, window.location.search));
        }, listen);
      }
      const reassign = root.querySelector<HTMLDialogElement>("dialog#dlgRe");
      if (reassign) reassign.addEventListener("change", () => syncReassign(reassign), listen);
    }

    // Settings > Firm, Offices, Branding, Language and time: ?dlg=<dialog id> (back from step-up)
    // reopens that dialog with what was typed; closing a dialog drops ?dlg.
    if (root.querySelector("[data-firm-save]")) {
      window.setTimeout(() => reopenFirmDialog(root, openDialog), 300);
      root.querySelectorAll<HTMLDialogElement>("dialog").forEach((dialog) => {
        if (!dialog.querySelector("[data-firm-save]")) return;
        dialog.addEventListener("close", () => {
          if (new URLSearchParams(window.location.search).has("dlg")) router.replace(withoutDialog(window.location.pathname, window.location.search));
        }, listen);
      });
    }

    // Access grants: ?dlg=grant (back from step-up) reopens New access grant with what was typed.
    const grantDialog = root.querySelector<HTMLDialogElement>("dialog#dlgG");
    if (grantDialog?.querySelector("[data-grant-create]")) {
      window.setTimeout(() => reopenGrantDialog(root, openDialog), 300);
      grantDialog.addEventListener("close", () => {
        if (new URLSearchParams(window.location.search).has("dlg")) router.replace(withoutDialog(window.location.pathname, window.location.search));
      }, listen);
    }

    const newTask = root.querySelector<HTMLDialogElement>("dialog#dlgTask");
    if (newTask?.querySelector("[data-new-task]")) {
      // The live New task form: owners and dependencies follow the chosen matter and kind.
      syncNewTask(newTask);
      newTask.addEventListener("change", () => syncNewTask(newTask), listen);
    }

    const bookDialog = root.querySelector<HTMLDialogElement>("dialog#dlgBook");
    if (bookDialog?.querySelector("[data-booking-submit]")) {
      // Book for a client: times follow the chosen booking type; ?dlg=book (from the Calendar) opens it.
      syncBookTimes(bookDialog);
      bookDialog.addEventListener("change", () => syncBookTimes(bookDialog), listen);
      if (dialogParam === "book") window.setTimeout(() => openDialog("dlgBook"), 300);
    }

    // Leads: the pipeline board, filters, New lead and CSV import; the lead page's actions.
    if (page === "pipeline") wirePipeline(root, router, ac.signal, openDialog);
    if (page === "lead") wireLead(root, router, ac.signal, openDialog);
    // ?dlg=compliance (back from step-up) reopens the privacy or complaints dialog with what was typed.
    if (dialogParam === "compliance") window.setTimeout(() => reopenComplianceDialog(root, openDialog), 300);
    // ?dlg=review&doc= (back from step-up) reopens the document review with what was typed.
    if (root.querySelector("dialog#dlgDocRev")) window.setTimeout(() => reopenDocReview(root, openDialog), 300);

    window.addEventListener("resize", place, listen);
    return () => ac.abort();
  }, [page, ref, router]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const state = new URLSearchParams(window.location.search).get("state");
    if (state) applyState(root, page, state);
  });
}

function armFuse(button: HTMLElement) {
  const wrap = button.closest<HTMLElement>(".k2-fb");
  if (!wrap) return;
  const idle = wrap.querySelector<HTMLElement>(".k2-fb-idle");
  const undo = wrap.querySelector<HTMLElement>(".k2-fb-undo");
  const done = wrap.querySelector<HTMLElement>(".k2-fb-done");
  if (button.classList.contains("k2-fb-undo")) {
    wrap.dataset.phase = "idle";
    wrap.querySelector(".k2-fb-rim rect")?.getAnimations().forEach((animation) => animation.cancel());
    return;
  }
  if (wrap.dataset.phase !== "idle") return;
  wrap.dataset.phase = "armed";
  const ms = Number(wrap.dataset.ms || 4000);
  const rect = wrap.querySelector(".k2-fb-rim rect");
  const animation = rect?.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: -1 }], { duration: ms, easing: "linear", fill: "forwards" });
  if (animation) {
    animation.onfinish = () => {
      wrap.dataset.phase = "settled";
      if (done) done.setAttribute("aria-hidden", "false");
      idle?.setAttribute("hidden", "");
      undo?.setAttribute("hidden", "");
    };
  }
  void done;
}

/**
 * The palette's label for a link: a tile's aria-label, or a menu item's own label `<span>`, so the
 * tile's shortcut hint (`<kbd>`), a count badge (`.k`) and avatar initials stay out of it.
 */
function paletteLabel(link: HTMLAnchorElement): string {
  const named = link.getAttribute("aria-label")?.trim() || link.querySelector(":scope > span:not([class])")?.textContent?.trim();
  if (named) return named;
  const copy = link.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("kbd, .tip, .sr, .k, .av, .ava, svg").forEach((node) => node.remove());
  return copy.textContent?.replace(/\s+/g, " ").trim() || "Open";
}

function openPalette(root: HTMLElement, go: (href: string) => void) {
  let scrim = root.querySelector<HTMLElement>(".scrim");
  if (!scrim) {
    scrim = document.createElement("div");
    scrim.className = "scrim";
    const seen = new Set<string>();
    const entries: { href: string; label: string }[] = [];
    // Menu items first, then the shortcut tiles, so a place keeps its menu name and link
    // (the Documents tile opens one matter's documents; the Invoices tile is Finance).
    const links = [...root.querySelectorAll<HTMLAnchorElement>(".nav a[href], .tree a[href]"), ...root.querySelectorAll<HTMLAnchorElement>(".tiles a[href]")];
    for (const link of links) {
      const href = link.getAttribute("href");
      if (!href || href === "#") continue;
      const label = paletteLabel(link);
      // The sidebar repeats some places (a tile and a menu item): list each once.
      const key = label.toLowerCase();
      if (seen.has(key) || seen.has(href)) continue;
      seen.add(key);
      seen.add(href);
      entries.push({ href, label });
    }
    const palette = document.createElement("div");
    palette.className = "palette";
    palette.setAttribute("role", "dialog");
    palette.setAttribute("aria-label", "Search");
    const input = document.createElement("input");
    input.placeholder = "Search matters, people and actions";
    input.setAttribute("aria-label", "Search");
    const list = document.createElement("ul");
    for (const entry of entries) {
      const item = document.createElement("li");
      item.dataset.u = entry.href;
      item.textContent = entry.label;
      list.append(item);
    }
    palette.append(input, list);
    scrim.append(palette);
    root.append(scrim);

    const close = () => scrim?.classList.remove("on");
    const visible = () => [...list.querySelectorAll<HTMLElement>("li")].filter((item) => !item.hidden);
    const mark = (item: HTMLElement | undefined) => {
      list.querySelectorAll("li.on").forEach((node) => node.classList.remove("on"));
      if (!item) return;
      item.classList.add("on");
      item.scrollIntoView({ block: "nearest" });
    };
    const open = (item: HTMLElement | undefined) => {
      const href = item?.dataset.u;
      if (!href) return;
      close();
      go(href);
    };
    scrim.addEventListener("click", (event) => {
      if (event.target === scrim) close();
    });
    list.addEventListener("click", (event) => open((event.target as HTMLElement).closest<HTMLElement>("li") ?? undefined));
    list.addEventListener("mousemove", (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>("li");
      if (item && !item.classList.contains("on")) mark(item);
    });
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      list.querySelectorAll<HTMLElement>("li").forEach((item) => {
        item.hidden = Boolean(q) && !item.textContent.toLowerCase().includes(q);
      });
      mark(visible()[0]);
    });
    input.addEventListener("keydown", (event) => {
      const items = visible();
      const at = items.findIndex((item) => item.classList.contains("on"));
      if (event.key === "Escape") close();
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        mark(items[(at + step + items.length) % items.length]);
      } else if (event.key === "Enter") {
        event.preventDefault();
        open(items[Math.max(at, 0)]);
      }
    });
  }
  const input = scrim.querySelector("input");
  if (input) {
    input.value = "";
    input.dispatchEvent(new Event("input"));
  }
  scrim.classList.add("on");
  window.setTimeout(() => input?.focus(), 30);
}

function applyState(root: HTMLElement, page: string, state: string) {
  const content = root.querySelector("#content");
  if (!content) return;
  const copy = sheetStateCopy(page);
  const heading = content.querySelector("h1")?.textContent || "This screen";
  if (state === "loading") {
    content.innerHTML = `<div class="fp-st" role="status"><span class="sr">Loading ${copy[4]}…</span><div class="sk h"></div><div class="sk" style="width:60%"></div>${'<div class="sk r"></div>'.repeat(4)}</div>`;
    return;
  }
  if (state === "empty") {
    content.innerHTML = `<div class="ph"><h1 class="display">${heading}</h1></div><div class="panel"><div class="emp">${art(copy[0], 88)}<b>${copy[1]}</b><small>${copy[2]}</small></div></div>`;
    return;
  }
  if (state === "error") {
    content.innerHTML = `<div class="ph"><h1 class="display">${heading}</h1></div><div class="alert bad" role="alert">${icon("alert")}<div><b>We couldn’t load ${copy[4]}</b>The server didn’t answer in time. Nothing was lost.</div></div>`;
    return;
  }
  if (state === "denied") {
    content.innerHTML = `<div class="ph"><h1 class="display">${heading}</h1></div><div class="panel"><div class="emp">${art("privacy-shield", 88)}<b>You don’t have permission to see ${copy[4]}</b><small>Your role doesn’t include this. Ask your firm owner if you need access.</small></div></div>`;
    return;
  }
  if (state === "offline") {
    content.insertAdjacentHTML("afterbegin", `<div class="alert warn" role="status">${icon("wifi-off")}<div><b>You’re offline</b>Showing ${copy[4]} from this device. Changes wait until you reconnect.</div></div>`);
  }
}
