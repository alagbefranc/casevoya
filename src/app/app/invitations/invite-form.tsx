"use client";

import { useActionState } from "react";
import { STAFF_ROLES } from "@/lib/tenant/roles";
import { createStaffInvitation, type InviteFormState } from "./actions";

type OrgOption = { id: string; name: string };

export function InviteForm({ organizations }: { organizations: OrgOption[] }) {
  const [state, action, pending] = useActionState<InviteFormState, FormData>(createStaffInvitation, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      {state?.error ? (
        <p role="alert" className="rounded-control bg-danger-bg px-4 py-3 text-danger">
          {state.error}
        </p>
      ) : null}
      {state?.link ? (
        <p role="status" className="break-all rounded-control bg-surface-muted px-4 py-3">
          {state.emailLink
            ? "Invitation sent. The email contains their private link. Here it is too, as a backup. It works once and expires in 7 days. "
            : "Invitation sent. Share this link once. It expires in 7 days. "}
          {state.link}
        </p>
      ) : null}
      <label className="flex flex-col gap-2">
        <span className="font-semibold">Firm</span>
        <select name="organizationId" required className="h-11 rounded-control border border-line-strong bg-surface px-3">
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-2">
        <span className="font-semibold">Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="h-11 rounded-control border border-line-strong bg-surface px-3"
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="font-semibold">Role</span>
        <select name="role" required className="h-11 rounded-control border border-line-strong bg-surface px-3">
          {STAFF_ROLES.map((role) => (
            <option key={role} value={role}>
              {role.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-2">
        <span className="font-semibold">Authenticator code</span>
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          pattern="[0-9]{6}"
          className="h-11 rounded-control border border-line-strong bg-surface px-3"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-control bg-action px-5 font-semibold text-on-action disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create invitation"}
      </button>
    </form>
  );
}
