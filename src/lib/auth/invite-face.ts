export type InviteFace = {
  firm: string;
  person: string;
  email: string;
  consultant: string;
  applicant: string;
  role: string;
  matter: string;
  phone: string;
};

export const BLANK_FACE: InviteFace = {
  firm: "",
  person: "",
  email: "",
  consultant: "",
  applicant: "",
  role: "",
  matter: "",
  phone: "",
};

export function showFace(value: string | undefined, fallback: string): string {
  const text = value?.trim();
  return text ? text : fallback;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function faceFromPortalPreview(value: unknown): InviteFace {
  const root = record(value);
  if (!root) return { ...BLANK_FACE };
  const invitee = record(root.invitee);
  const organization = record(root.organization);
  const inviter = record(root.inviter);
  const applicant = record(root.applicant);
  const matter = record(root.matter);
  const person = text(invitee?.display_name);
  return {
    firm: text(organization?.display_name),
    person: person.split(" ")[0] ?? "",
    email: text(invitee?.email),
    consultant: text(inviter?.display_name),
    applicant: text(applicant?.display_name),
    role: text(root.role).replaceAll("_", " "),
    matter: text(matter?.title),
    phone: text(root.contact_phone),
  };
}

export function faceFromStaffPreview(
  value: { email?: string | null; organization_name?: string | null; role?: string | null } | null,
): InviteFace {
  if (!value) return { ...BLANK_FACE };
  return {
    ...BLANK_FACE,
    firm: value.organization_name?.trim() ?? "",
    email: value.email?.trim() ?? "",
    role: value.role?.replaceAll("_", " ") ?? "",
  };
}
