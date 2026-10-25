/**
 * The reviewer's attestation for approving an entry whose official page Casevoya couldn't capture
 * (decided 2026-10-24): the date they opened the page and a tick that the entry matches it. Built
 * from the design system's own parts, as the other review controls are: a `.fl` date field, the
 * `label.check` box (as in Verify payment) and a `.mu` note. The inputs carry `data-attest-on` and
 * `data-attest`; the Sheet acts read them inside the dialog or row that holds the Approve button
 * (readAttestationFrom), so several rows can each have their own.
 */
import { ATTEST_LABEL, ATTEST_WHY } from "@/modules/government/page-attestation";

export function PageAttestFields({ today }: { today: string }) {
  return (
    <>
      <label className={"fl"} style={{ marginTop: "10px" }}>
        {"Date you opened the official page"}
        <input type={"date"} max={today} defaultValue={today} data-attest-on={""} />
      </label>
      <label className={"check"} style={{ marginTop: "10px" }}>
        <input type={"checkbox"} data-attest={""} />
        <span>{ATTEST_LABEL}</span>
      </label>
      <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
        {ATTEST_WHY}
      </p>
    </>
  );
}
