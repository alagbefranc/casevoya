"use client";

import { goStepUp } from "@/lib/auth/step-up-resume";
import { toast2 } from "@/components/port/kit";
import { needsStepUp, stepUpLocation } from "@/modules/sheet/matter-wire";
import { parseFieldLines } from "@/modules/prep/fields";
import { pinFormTemplate, proposeFormTemplate, reviewFormTemplate, saveBundleSelection, setChannelExportRule } from "@/modules/prep/actions";

/**
 * Forms tab and evidence bundle controls (`data-prep`). The database checks every change.
 * A step-up refusal sends the person to confirm, then back.
 */
type Router = { replace: (href: string) => void; refresh: () => void };

function value(root: ParentNode, selector: string): string {
  return (root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)?.value ?? "").trim();
}

const pendingReject = { id: "", version: "" };

export function bindPrepControls(root: HTMLElement, router: Router, listen: { signal: AbortSignal }) {
  root.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      const rejectOpen = target.closest<HTMLElement>("[data-prep-reject]");
      if (rejectOpen && root.contains(rejectOpen)) {
        pendingReject.id = rejectOpen.dataset.prepReject ?? "";
        pendingReject.version = rejectOpen.dataset.version ?? "";
      }
      const attestOpen = target.closest<HTMLElement>('[data-prep="attest-open"]');
      if (attestOpen && root.contains(attestOpen)) {
        const dialog = root.querySelector("#dFormAtt");
        const button = dialog?.querySelector<HTMLElement>('[data-prep="attest"]');
        if (button) {
          button.dataset.id = attestOpen.dataset.id ?? "";
          button.dataset.version = attestOpen.dataset.version ?? "";
        }
      }
      const control = target.closest<HTMLElement>("[data-prep]");
      if (!control || !root.contains(control) || control.dataset.prep === "attest-open") return;
      event.preventDefault();
      event.stopPropagation();
      if (control.getAttribute("aria-busy") === "true") return;
      control.setAttribute("aria-busy", "true");
      void run(control, root, router).finally(() => control.removeAttribute("aria-busy"));
    },
    { capture: true, signal: listen.signal },
  );
}

async function run(control: HTMLElement, root: HTMLElement, router: Router) {
  const act = control.dataset.prep ?? "";
  const organizationId = control.dataset.org ?? "";
  const matterId = control.dataset.matter ?? "";
  let result: { error?: string; snapshot?: boolean; reason?: string | null } | { ok: true } | { id: string } | undefined;
  let note: string | null = null;

  if (act === "propose") {
    const format = value(root, "#ftO");
    const parsed = parseFieldLines(value(root, "#ftF"));
    if ("error" in parsed) return void toast2(parsed.error, { kind: "warn", sub: "Nothing was saved." });
    if (!value(root, "#ftI") || !value(root, "#ftV") || !value(root, "#ftU") || !value(root, "#ftJ")) {
      return void toast2("Enter the jurisdiction, form identifier, version and official page.", { kind: "warn", sub: "As the official page prints them." });
    }
    const proposed = await proposeFormTemplate({
      organizationId,
      jurisdiction: value(root, "#ftJ"),
      programKey: value(root, "#ftP") || null,
      officialFormId: value(root, "#ftI"),
      officialUrl: value(root, "#ftU"),
      sourceSection: value(root, "#ftS") || null,
      formVersion: value(root, "#ftV"),
      effectiveOn: value(root, "#ftE") || null,
      outputFormat: format,
      fields: parsed.fields,
      checkedOn: value(root, "#ftD"),
    });
    result = proposed;
    if (proposed && "snapshot" in proposed && !proposed.snapshot) {
      note = `${proposed.reason ?? "The page couldn’t be fetched."} It is kept for review. A licensed consultant approves it only after opening the official page.`;
    }
  } else if (act === "approve") {
    result = await reviewFormTemplate({ organizationId, templateId: control.dataset.id ?? "", version: Number(control.dataset.version), decision: "approved", note: null });
  } else if (act === "attest") {
    const opened = value(root, "#ftAttD");
    const ticked = root.querySelector<HTMLInputElement>("#ftAttC")?.checked;
    if (!ticked || !opened) return void toast2("Tick that you opened the official page, and enter the date.", { kind: "warn", sub: "Nothing was saved." });
    result = await reviewFormTemplate({
      organizationId,
      templateId: control.dataset.id ?? "",
      version: Number(control.dataset.version),
      decision: "approved",
      note: null,
      pageOpenedOn: opened,
    });
  } else if (act === "reject") {
    const why = value(root, "#ftRej");
    if (why.length < 3) return void toast2("Say why it’s rejected.", { kind: "warn", sub: "Kept with the template." });
    result = await reviewFormTemplate({ organizationId, templateId: pendingReject.id, version: Number(pendingReject.version), decision: "rejected", note: why });
  } else if (act === "pin") {
    result = await pinFormTemplate({ organizationId, matterId, templateId: value(root, "#pfPin") });
  } else if (act === "bundle") {
    const channel = value(root, "#bdCh");
    const items: { document_version_id: string; position: number }[] = [];
    for (const box of root.querySelectorAll<HTMLInputElement>("[data-bundle-version]")) {
      if (!box.checked) continue;
      const versionId = box.dataset.bundleVersion ?? "";
      const order = Number(root.querySelector<HTMLInputElement>(`[data-bundle-order="${versionId}"]`)?.value ?? "");
      if (!versionId || !Number.isInteger(order) || order < 1) return void toast2("Give each included document a place in the order.", { kind: "warn", sub: "Nothing was saved." });
      items.push({ document_version_id: versionId, position: order });
    }
    result = await saveBundleSelection({ organizationId, matterId, channel, items });
  } else if (act === "channel-rule") {
    const maxMb = Number(value(root, "#bdMax"));
    result = await setChannelExportRule({
      organizationId,
      channel: value(root, "#bdRuleCh"),
      namePattern: value(root, "#bdPat"),
      maxBytes: Math.round(maxMb * 1024 * 1024),
    });
  } else {
    return;
  }

  const error = result && "error" in result && typeof result.error === "string" ? result.error : null;
  if (error) {
    if (needsStepUp(error)) {
      const action = act === "channel-rule" ? "firm_settings" : act === "approve" || act === "attest" || act === "reject" ? "rule_approve" : "submission";
      goStepUp(stepUpLocation(window.location.pathname, window.location.search, null, action));
      return;
    }
    toast2(error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  root.querySelectorAll("dialog[open]").forEach((dialog) => {
    if (dialog instanceof HTMLDialogElement) dialog.close();
  });
  toast2(note ? "Saved for review" : "Saved", { kind: note ? "warn" : "ok", sub: note ?? "Recorded on this matter." });
  router.refresh();
}
