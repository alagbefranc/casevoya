"use client";

import { useState, useTransition } from "react";
import { withdrawSectionShare } from "@/modules/portal-invitations/actions";

export function WithdrawShare({ organizationId, shareId }: { organizationId: string; shareId: string }) {
  const [gone, setGone] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  if (gone) return <span className="lbl">Withdrawn</span>;
  return (
    <span className="r">
      <button
        className="btn sm"
        type="button"
        disabled={pending}
        onClick={() => {
          start(async () => {
            const result = await withdrawSectionShare({ organizationId, shareId });
            if ("error" in result) setMessage(result.error ?? "That share could not be withdrawn.");
            else setGone(true);
          });
        }}
      >
        Withdraw
      </button>
      {message ? <small className="lbl">{message}</small> : null}
    </span>
  );
}
