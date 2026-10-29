"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { goStepUp } from "@/lib/auth/step-up-resume";
import { stepUpHref } from "@/lib/auth/mfa-step";
import { saveRuleTestCase } from "@/modules/content-governance/pack-actions";

export type RuleTestRow = { id: string; kind: string; title: string; expected: string; actual: string; pass: boolean };

const KINDS = [
  ["supported", "Supported"],
  ["unsupported", "Unsupported"],
  ["missing_input", "Missing input"],
  ["jurisdiction_mismatch", "Jurisdiction mismatch"],
  ["stale_source", "Stale source"],
  ["superseded_version", "Superseded version"],
] as const;

const EXPECTED = [
  ["applies", "Applies"],
  ["does_not_apply", "Does not apply"],
  ["missing_input", "Missing input"],
  ["jurisdiction_mismatch", "Jurisdiction mismatch"],
  ["stale_blocked", "Stale source blocked"],
  ["superseded_blocked", "Superseded version blocked"],
] as const;

/** SRC-10: a reviewer adds cases. The form does not contain a rule. */
export function RuleTestsPanel({ organizationId, definitionId, cases }: { organizationId: string; definitionId: string; cases: RuleTestRow[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (form: FormData) => {
    const fact = String(form.get("fact") ?? "").trim();
    const raw = String(form.get("factValue") ?? "").trim();
    const inputs: Record<string, string | boolean> = {};
    if (fact) inputs[fact] = raw === "true" ? true : raw === "false" ? false : raw;
    const jurisdiction = String(form.get("jurisdiction") ?? "").trim();
    if (jurisdiction) inputs.jurisdiction = jurisdiction;
    setPending(true);
    const result = await saveRuleTestCase({
      organizationId,
      definitionId,
      kind: String(form.get("kind") ?? ""),
      title: String(form.get("title") ?? ""),
      expected: String(form.get("expected") ?? ""),
      inputs,
    });
    setPending(false);
    if ("error" in result) {
      if (/authenticator|step-up/i.test(result.error)) {
        goStepUp(stepUpHref(`/sheet/templates?tab=rule&claim=${definitionId}`, "rule_test"));
        return;
      }
      setMessage(result.error);
      return;
    }
    setMessage("");
    router.refresh();
  };

  return (
    <section className="panel" id="rule-tests">
      <h2>Rule tests</h2>
      <div className="fp-pad">
        <p className="fp-note" style={{ marginTop: 0 }}>
          Add a case for this rule. Supported, unsupported and missing-input cases run only when the version has an executable condition a reviewer stored. They do not invent one. A stale or superseded case checks that that version is not cited.
        </p>
        {cases.length === 0 ? <p>No test cases yet.</p> : (
          <ul>
            {cases.map((row) => (
              <li key={row.id}>{row.title}: expected {row.expected}, got {row.actual}{row.pass ? "" : " (not passing)"}</li>
            ))}
          </ul>
        )}
        <form action={(form) => void submit(form)}>
          <label className="fld">Kind
            <select className="inp" name="kind">{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </label>
          <label className="fld">What this case checks
            <input className="inp" name="title" required minLength={3} maxLength={200} />
          </label>
          <label className="fld">Expected result
            <select className="inp" name="expected">{EXPECTED.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </label>
          <label className="fld">Fact name
            <input className="inp" name="fact" maxLength={80} placeholder="Only if the rule’s condition names a fact" />
          </label>
          <label className="fld">Fact value
            <input className="inp" name="factValue" maxLength={80} />
          </label>
          <label className="fld">Jurisdiction
            <input className="inp" name="jurisdiction" maxLength={12} placeholder="For a jurisdiction-mismatch case" />
          </label>
          {message ? <p role="alert">{message}</p> : null}
          <button className="btn sm" type="submit" disabled={pending}>Add test case</button>
        </form>
      </div>
    </section>
  );
}
