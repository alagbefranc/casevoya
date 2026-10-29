"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { goStepUp } from "@/lib/auth/step-up-resume";
import { stepUpHref } from "@/lib/auth/mfa-step";
import { publishReviewedProgramPack } from "@/modules/content-governance/pack-actions";

export type PackEditorClaim = { versionId: string; key: string; programKey: string | null; claim: string };
export type PackEditorMember = { membershipId: string; name: string; licence: string };
export type PackEditorData = {
  organizationId: string;
  licensed: boolean;
  claims: PackEditorClaim[];
  members: PackEditorMember[];
};

/** INT-02 / SRC-11: publish a firm pack of claims that are already live. No claim is created here. */
export function ProgramPackPublish({ data }: { data: PackEditorData }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const programs = [...new Set(data.claims.map((claim) => claim.programKey).filter((key): key is string => Boolean(key)))];

  if (!data.licensed) return null;

  const submit = async (form: FormData) => {
    const versionIds = form.getAll("version").filter((value): value is string => typeof value === "string");
    setPending(true);
    const result = await publishReviewedProgramPack({
      organizationId: data.organizationId,
      programKey: String(form.get("program") ?? ""),
      jurisdiction: String(form.get("jurisdiction") ?? "CA"),
      versionIds,
      sourceOwnerId: String(form.get("owner") ?? ""),
      effectiveFrom: new Date(`${String(form.get("effective") ?? "")}T00:00:00Z`).toISOString(),
      nextReviewAt: new Date(`${String(form.get("review") ?? "")}T00:00:00Z`).toISOString(),
      changeResponse: String(form.get("response") ?? ""),
    });
    setPending(false);
    if ("error" in result) {
      if (/authenticator|step-up/i.test(result.error)) {
        goStepUp(stepUpHref("/sheet/templates?tab=program", "pack_publish"));
        return;
      }
      setMessage(result.error);
      return;
    }
    setMessage("");
    router.refresh();
  };

  return (
    <section className="panel rv" style={{ marginTop: 16 }}>
      <h2>Publish a reviewed program pack</h2>
      <form className="fp-pad" action={(form) => void submit(form)}>
        <p className="fp-note" style={{ marginTop: 0 }}>
          Choose live official claims only. You are recorded as the reviewer. Name a licensed source owner and how the firm handles a later change to those pages. Templates and this approval stay with a licensed member.
        </p>
        {data.claims.length === 0 ? <p>No live official claims are loaded yet. The one-time loader has not been run.</p> : null}
        <label className="fld">Program
          <select className="inp" name="program" required defaultValue={programs[0] ?? ""}>
            {programs.map((key) => <option key={key} value={key}>{key}</option>)}
          </select>
        </label>
        <label className="fld">Jurisdiction
          <input className="inp" name="jurisdiction" required defaultValue="CA" maxLength={12} />
        </label>
        <fieldset>
          <legend>Live claims</legend>
          {data.claims.map((claim) => (
            <label key={claim.versionId} style={{ display: "block", margin: "6px 0" }}>
              <input type="checkbox" name="version" value={claim.versionId} /> {claim.key}
              <span className="fp-note"> {claim.claim}</span>
            </label>
          ))}
        </fieldset>
        <label className="fld">Source owner
          <select className="inp" name="owner" required defaultValue={data.members[0]?.membershipId ?? ""}>
            {data.members.map((member) => (
              <option key={member.membershipId} value={member.membershipId}>{member.name}, licence {member.licence}</option>
            ))}
          </select>
        </label>
        <label className="fld">Effective date
          <input className="inp" name="effective" type="date" required />
        </label>
        <label className="fld">Next review
          <input className="inp" name="review" type="date" required />
        </label>
        <label className="fld">When a source changes
          <textarea className="inp" name="response" required minLength={20} maxLength={2000} placeholder="Who looks at the affected matters and templates, and what they do." />
        </label>
        {message ? <p role="alert">{message}</p> : null}
        <button className="btn" type="submit" disabled={pending || data.claims.length === 0 || data.members.length === 0}>Publish pack</button>
      </form>
    </section>
  );
}
