"use client";

/**
 * Live only (2026-10-30): the Automations header's controls for a firm owner or licensed
 * consultant. New automation; on one of the firm's own automations Edit, Pause or Resume and
 * Duplicate; on the built-in rule (locked) Make a copy. The editor (`#dlgAutoRule`, the Designer's
 * `.dlg` parts) offers only what the reminder job runs: the trigger (a deadline with a due date is
 * saved), the kinds of deadline it covers, and the reminder days. What it sends (the approved
 * reminder email) and to whom (the matter's clients who chose reminders) are fixed.
 * public.save_firm_automation and public.set_firm_automation_paused check the role, a recent
 * step-up, the firm and every field, and write the audit log.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast2 } from "@/components/port/kit";
import { goStepUp } from "@/lib/auth/step-up-resume";
import { stepUpHref } from "@/lib/auth/mfa-step";
import { saveFirmAutomation, setFirmAutomationPaused } from "@/modules/automations/actions";
import { automationProblem, DEADLINE_KINDS, type FirmAutomationView } from "@/modules/sheet/automation-rules";
import { needsStepUp } from "@/modules/sheet/staff-present";
import { Icon } from "./frame";

export const AUTOMATION_RULE_DIALOG = "dlgAutoRule";

export type AutomationsManage = {
  organizationId: string;
  /** The firm automation shown, or null for the built-in rule. */
  selected: FirmAutomationView | null;
  builtInDays: number[];
  builtInName: string;
};

type Draft = {
  automationId: string | null;
  expectedVersion: number | null;
  name: string;
  kinds: string[];
  days: string;
  copiedFromBuiltIn: boolean;
  title: string;
};

const ALL_KINDS = DEADLINE_KINDS.map((kind) => kind.key as string);

export function AutomationsManageActions({ manage }: { manage: AutomationsManage }) {
  const router = useRouter();
  const editor = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const rule = manage.selected;

  const open = (next: Draft) => {
    setDraft(next);
    editor.current?.showModal();
  };
  const refused = (error: string, sub: string) => {
    if (needsStepUp(error)) {
      toast2("Confirm it’s you first", { kind: "warn", sub: "Then try again." });
      window.setTimeout(() => goStepUp(stepUpHref(`${window.location.pathname}${window.location.search}`, "automations")), 900);
      return;
    }
    toast2(error, { kind: "bad", sub });
  };

  const create = () =>
    open({ automationId: null, expectedVersion: null, name: "", kinds: [...ALL_KINDS], days: manage.builtInDays.join(", ") || "7, 1", copiedFromBuiltIn: false, title: "New automation" });
  const copyBuiltIn = () =>
    open({
      automationId: null,
      expectedVersion: null,
      name: `${manage.builtInName} (copy)`,
      kinds: [...ALL_KINDS],
      days: manage.builtInDays.join(", "),
      copiedFromBuiltIn: true,
      title: "Copy the built-in rule",
    });
  const edit = (view: FirmAutomationView) =>
    open({ automationId: view.id, expectedVersion: view.version, name: view.name, kinds: [...view.kinds], days: view.days.join(", "), copiedFromBuiltIn: view.copiedFromBuiltIn, title: "Edit automation" });
  const duplicate = (view: FirmAutomationView) =>
    open({ automationId: null, expectedVersion: null, name: `${view.name} (copy)`.slice(0, 120), kinds: [...view.kinds], days: view.days.join(", "), copiedFromBuiltIn: false, title: "Duplicate automation" });

  const save = async () => {
    if (!draft || busy) return;
    const checked = automationProblem({ name: draft.name, kinds: draft.kinds, days: draft.days });
    if ("error" in checked) {
      toast2(checked.error, { kind: "warn", sub: "The automation wasn’t saved." });
      return;
    }
    setBusy(true);
    const result = await saveFirmAutomation({ organizationId: manage.organizationId, ...draft });
    setBusy(false);
    if ("error" in result) return refused(result.error, "The automation wasn’t saved.");
    editor.current?.close();
    toast2(draft.automationId ? "Automation saved" : "Automation created", { kind: "ok", sub: "Deadlines saved from now on use it. The built-in rule is unchanged." });
    if (draft.automationId) router.refresh();
    else router.push(`/sheet/automations?rule=${result.id}`);
  };

  const pause = async (view: FirmAutomationView, paused: boolean) => {
    if (busy) return;
    setBusy(true);
    const result = await setFirmAutomationPaused({ organizationId: manage.organizationId, automationId: view.id, expectedVersion: view.version, paused });
    setBusy(false);
    if ("error" in result) return refused(result.error, "Nothing was changed.");
    toast2(paused ? "Automation paused" : "Automation resumed", {
      kind: "ok",
      sub: paused ? "Deadlines saved while it is paused get no reminders from it." : "Deadlines saved from now on get its reminders again.",
    });
    router.refresh();
  };

  const toggleKind = (key: string, on: boolean) =>
    setDraft((current) => (current ? { ...current, kinds: on ? [...new Set([...current.kinds, key])] : current.kinds.filter((kind) => kind !== key) } : current));

  return (
    <>
      {rule ? (
        <>
          <button className={"btn s sm"} type={"button"} onClick={() => edit(rule)} disabled={busy}>
            {"Edit"}
          </button>
          <button className={"btn s sm"} type={"button"} onClick={() => void pause(rule, rule.status === "active")} disabled={busy}>
            {rule.status === "active" ? "Pause" : "Resume"}
          </button>
          <button className={"btn s sm"} type={"button"} onClick={() => duplicate(rule)} disabled={busy}>
            {"Duplicate"}
          </button>
        </>
      ) : (
        <button className={"btn s sm"} type={"button"} onClick={copyBuiltIn} title={"The built-in rule is locked. Make your own copy to edit."}>
          {"Make a copy"}
        </button>
      )}
      <button className={"btn p sm"} type={"button"} onClick={create}>
        <Icon name={"plus"} cls={"ic s"} />
        {"New automation"}
      </button>
      <dialog className={"dlg"} id={AUTOMATION_RULE_DIALOG} ref={editor} aria-labelledby={"dlgAutoRuleH"}>
        <div className={"dh"}>
          <h2 id={"dlgAutoRuleH"}>{draft?.title ?? "New automation"}</h2>
          <button className={"x"} type={"button"} aria-label={"Close"} onClick={() => editor.current?.close()}>
            <Icon name={"close"} cls={"ic s"} />
          </button>
        </div>
        {draft ? (
          <div className={"db"}>
            <div className={"fld"}>
              <label htmlFor={"arN"}>{"Name"}</label>
              <input className={"inp"} id={"arN"} type={"text"} maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={"Letter reminders"} />
            </div>
            <div className={"fld"}>
              <span className={"lbl"}>{"When"}</span>
              <small className={"hint"}>{"A deadline with a due date is saved on a matter. This is the trigger the reminder job runs."}</small>
            </div>
            <fieldset className={"fld"} style={{ border: 0, padding: 0, margin: 0 }}>
              <legend>{"If the deadline is one of"}</legend>
              {DEADLINE_KINDS.map((kind) => (
                <label key={kind.key} className={"check"} style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "6px" }}>
                  <input type={"checkbox"} checked={draft.kinds.includes(kind.key)} onChange={(event) => toggleKind(kind.key, event.target.checked)} />
                  <span>{kind.label}</span>
                </label>
              ))}
            </fieldset>
            <div className={"fld"}>
              <label htmlFor={"arD"}>{"Then email a reminder, days before the due date"}</label>
              <small className={"hint"}>{"Whole days, separated by commas, like 30, 7, 2. Up to 12 days, each 1 to 365."}</small>
              <input className={"inp"} id={"arD"} type={"text"} inputMode={"numeric"} value={draft.days} onChange={(event) => setDraft({ ...draft, days: event.target.value })} />
            </div>
            <p className={"why"}>
              <Icon name={"lightning"} cls={"ic s"} />
              {
                "Sends the approved reminder email to the matter’s clients who chose deadline reminders; staff see it in Notifications. Quiet hours and the due-within-a-day reminder apply as for the built-in rule. A day both rules use sends one reminder."
              }
            </p>
          </div>
        ) : null}
        <div className={"df"}>
          <button className={"btn"} type={"button"} onClick={() => editor.current?.close()}>
            {"Cancel"}
          </button>
          <button className={"btn p"} type={"button"} onClick={() => void save()} disabled={busy} aria-busy={busy || undefined}>
            {draft?.automationId ? "Save" : "Create"}
          </button>
        </div>
      </dialog>
    </>
  );
}
