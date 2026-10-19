import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { newMatterError } from "@/modules/sheet/new-matter";
import { feeCents, leadError } from "./present";

/**
 * The lead pipeline's writes, as the signed-in staff member. Each one is a database function
 * that checks the role, the firm, staff MFA and (where a person edits what they saw) the lead's
 * version, writes the history and the audit event. Nothing here decides access.
 */

export type LeadActionResult = { ok: true; version?: number | null; id?: string | null; reference?: string | null; imported?: number; skipped?: { row: number; reason: string }[] } | { error: string; conflict?: boolean };

const uuid = z.string().refine(isUuid, "id");
const text = (max: number) => z.string().max(max * 2).optional().nullable();
const version = z.number().int().min(1);

const SCHEMAS = {
  create: z.object({
    org: uuid,
    name: z.string().max(400),
    email: text(320),
    phone: text(40),
    preferred: z.enum(["email", "phone"]).optional().nullable(),
    service: text(120),
    country: text(100),
    language: text(100),
    source: z.enum(["phone", "email", "referral", "event", "walk_in", "other"]),
    owner: uuid.optional().nullable(),
    fee: text(20),
    note: text(4000),
    reply: z.boolean(),
    marketing: z.boolean(),
  }),
  move: z.object({ org: uuid, lead: uuid, stage: uuid, version, reason: text(500) }),
  note: z.object({ org: uuid, lead: uuid, body: z.string().max(8000) }),
  "follow-up": z.object({ org: uuid, lead: uuid, title: z.string().max(400), owner: uuid.optional().nullable(), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("")) }),
  "follow-done": z.object({ org: uuid, followUp: uuid }),
  lost: z.object({ org: uuid, lead: uuid, version, reason: z.string().max(1200) }),
  conflict: z.object({ org: uuid, lead: uuid, version, result: z.enum(["clear", "possible_conflict", "conflict"]), note: text(1000) }),
  convert: z.object({ org: uuid, lead: uuid, version, consultant: z.string().max(40), program: z.string().max(40).optional().nullable() }),
  dup: z.object({ org: uuid, lead: uuid, other: uuid, same: z.boolean() }),
  edit: z.object({
    org: uuid,
    lead: uuid,
    version,
    name: z.string().max(400),
    email: text(320),
    phone: text(40),
    preferred: z.enum(["email", "phone", ""]).optional().nullable(),
    service: text(120),
    country: text(100),
    language: text(100),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("")),
    sourceDetail: text(200),
    owner: uuid.optional().nullable().or(z.literal("")),
    fee: text(20),
    tags: text(600),
    marketing: z.boolean().optional().nullable(),
    /** A staff-recorded source, when it changed. */
    source: z.enum(["phone", "email", "referral", "event", "walk_in", "other"]).optional().nullable(),
    /** The reply consent, when the answer changed. */
    reply: z.boolean().optional().nullable(),
  }),
  "link-booking": z.object({ org: uuid, lead: uuid, booking: uuid }),
  "from-booking": z.object({ org: uuid, booking: uuid }),
  import: z.object({
    org: uuid,
    file: z.string().max(200),
    rows: z
      .array(
        z.object({
          name: text(400),
          email: text(320),
          phone: text(40),
          service_interest: text(120),
          source: text(200),
          note: text(4000),
        }),
      )
      .max(500),
  }),
} as const;

export type LeadAction = keyof typeof SCHEMAS;

export function isLeadAction(value: string): value is LeadAction {
  return Object.hasOwn(SCHEMAS, value);
}

function blank(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function refused(message: string): { error: string; conflict?: boolean } {
  return { error: leadError(message), ...(/changed by someone else/i.test(message) ? { conflict: true } : {}) };
}

async function session(organizationId: string) {
  const supabase = await createClient({ organizationId });
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ? supabase : null;
}

export async function runLeadAction(action: LeadAction, body: unknown): Promise<LeadActionResult> {
  const parsed = SCHEMAS[action].safeParse(body);
  if (!parsed.success) return { error: "Some details are missing or too long. Check the form." };
  const input = parsed.data as Record<string, unknown> & { org: string };
  const supabase = await session(input.org);
  if (!supabase) return { error: "Sign in first." };

  switch (action) {
    case "create": {
      const v = SCHEMAS.create.parse(body);
      const fee = feeCents(v.fee);
      if (fee === "invalid") return { error: "Enter the proposed fee as an amount, like 2400 or 2400.50." };
      if (!blank(v.name)) return { error: "Add the person’s name." };
      if (!blank(v.email) && !blank(v.phone)) return { error: "Add an email address or a phone number." };
      const { data, error } = await supabase.rpc("create_lead", {
        p_org: v.org,
        p_name: v.name,
        p_email: blank(v.email),
        p_phone: blank(v.phone),
        p_preferred_contact: v.preferred ?? null,
        p_service_interest: blank(v.service),
        p_country_now: blank(v.country),
        p_language: blank(v.language),
        p_source: v.source,
        p_source_detail: null,
        p_owner_membership_id: v.owner ?? null,
        p_proposed_fee_cents: fee,
        p_tags: [],
        p_note: blank(v.note),
        p_reply_consent: v.reply,
        p_marketing_consent: v.marketing,
      });
      if (error) return refused(error.message);
      return { ok: true, id: typeof data === "string" ? data : null };
    }
    case "move": {
      const v = SCHEMAS.move.parse(body);
      const { data, error } = await supabase.rpc("move_lead_stage", { p_org: v.org, p_lead: v.lead, p_to_stage: v.stage, p_expected_version: v.version, p_reason: blank(v.reason) });
      if (error) return refused(error.message);
      return { ok: true, version: typeof data === "number" ? data : null };
    }
    case "note": {
      const v = SCHEMAS.note.parse(body);
      if (!blank(v.body)) return { error: "Write a note first." };
      const { error } = await supabase.rpc("add_lead_note", { p_org: v.org, p_lead: v.lead, p_body: v.body });
      return error ? refused(error.message) : { ok: true };
    }
    case "follow-up": {
      const v = SCHEMAS["follow-up"].parse(body);
      if (!blank(v.title)) return { error: "Name the follow-up." };
      const { error } = await supabase.rpc("add_lead_follow_up", { p_org: v.org, p_lead: v.lead, p_title: v.title, p_owner_membership_id: v.owner ?? null, p_due_on: blank(v.due) });
      return error ? refused(error.message) : { ok: true };
    }
    case "follow-done": {
      const v = SCHEMAS["follow-done"].parse(body);
      const { error } = await supabase.rpc("complete_lead_follow_up", { p_org: v.org, p_follow_up: v.followUp });
      return error ? refused(error.message) : { ok: true };
    }
    case "lost": {
      const v = SCHEMAS.lost.parse(body);
      const { data, error } = await supabase.rpc("close_lead_lost", { p_org: v.org, p_lead: v.lead, p_expected_version: v.version, p_reason: v.reason });
      if (error) return refused(error.message);
      return { ok: true, version: typeof data === "number" ? data : null };
    }
    case "conflict": {
      const v = SCHEMAS.conflict.parse(body);
      const { data, error } = await supabase.rpc("record_lead_conflict_check", { p_org: v.org, p_lead: v.lead, p_expected_version: v.version, p_result: v.result, p_note: blank(v.note) });
      if (error) return refused(error.message);
      return { ok: true, version: typeof data === "number" ? data : null };
    }
    case "convert": {
      const v = SCHEMAS.convert.parse(body);
      if (!isUuid(v.consultant)) return { error: "Choose a responsible consultant." };
      const program = blank(v.program);
      if (program && !isUuid(program)) return { error: "Choose a published program template." };
      const { data, error } = await supabase.rpc("convert_lead_to_matter", {
        p_org: v.org,
        p_lead: v.lead,
        p_expected_version: v.version,
        p_consultant_membership_id: v.consultant,
        p_rule_pack_version_id: program,
      });
      if (error) {
        // The matter's own refusals read as on the Sheet's New matter (create_client_matter's words).
        if (/conflict check|already converted|reopen the lead|changed by someone else|lead not found/i.test(error.message)) return refused(error.message);
        return { error: newMatterError(error.message) };
      }
      const result = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
      if (result.ok !== true || typeof result.id !== "string") {
        return { error: result.blocked === "licence" ? newMatterError("licence blocks") : "The matter was not created." };
      }
      return { ok: true, id: result.id, reference: typeof result.reference === "string" ? result.reference : null };
    }
    case "dup": {
      const v = SCHEMAS.dup.parse(body);
      const { error } = await supabase.rpc("decide_lead_duplicate", { p_org: v.org, p_lead: v.lead, p_other: v.other, p_same_person: v.same });
      return error ? refused(error.message) : { ok: true };
    }
    case "edit": {
      const v = SCHEMAS.edit.parse(body);
      const fee = feeCents(v.fee);
      if (fee === "invalid") return { error: "Enter the proposed fee as an amount, like 2400 or 2400.50." };
      const tags = (v.tags ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 12);
      const { data, error } = await supabase.rpc("update_lead", {
        p_org: v.org,
        p_lead: v.lead,
        p_expected_version: v.version,
        p_name: v.name,
        p_email: blank(v.email),
        p_phone: blank(v.phone),
        p_preferred_contact: blank(v.preferred),
        p_service_interest: blank(v.service),
        p_country_now: blank(v.country),
        p_language: blank(v.language),
        p_date_of_birth: blank(v.dateOfBirth),
        p_source_detail: blank(v.sourceDetail),
        p_owner_membership_id: blank(v.owner),
        p_proposed_fee_cents: fee,
        p_tags: tags,
      });
      if (error) return refused(error.message);
      let saved = typeof data === "number" ? data : null;
      if (v.source && saved != null) {
        const source = await supabase.rpc("set_lead_source", { p_org: v.org, p_lead: v.lead, p_expected_version: saved, p_source: v.source });
        if (source.error) return { error: `Details saved, but the source was not: ${leadError(source.error.message)}` };
        saved = typeof source.data === "number" ? source.data : saved;
      }
      if (typeof v.reply === "boolean") {
        const consent = await supabase.rpc("record_lead_consent", { p_org: v.org, p_lead: v.lead, p_purpose: "enquiry_reply", p_granted: v.reply });
        if (consent.error) return { error: `Details saved, but the reply consent was not: ${leadError(consent.error.message)}` };
      }
      if (typeof v.marketing === "boolean") {
        const consent = await supabase.rpc("record_lead_consent", { p_org: v.org, p_lead: v.lead, p_purpose: "marketing", p_granted: v.marketing });
        if (consent.error) return { error: `Details saved, but the marketing answer was not: ${leadError(consent.error.message)}` };
      }
      return { ok: true, version: saved };
    }
    case "link-booking": {
      const v = SCHEMAS["link-booking"].parse(body);
      const { error } = await supabase.rpc("link_booking_to_lead", { p_org: v.org, p_booking: v.booking, p_lead: v.lead });
      return error ? refused(error.message) : { ok: true };
    }
    case "from-booking": {
      const v = SCHEMAS["from-booking"].parse(body);
      const { data, error } = await supabase.rpc("create_lead_from_booking", { p_org: v.org, p_booking: v.booking });
      if (error) return refused(error.message);
      return { ok: true, id: typeof data === "string" ? data : null };
    }
    case "import": {
      const v = SCHEMAS.import.parse(body);
      if (!v.rows.length) return { error: "The file has no rows to import." };
      const { data, error } = await supabase.rpc("import_leads", { p_org: v.org, p_file_name: v.file, p_rows: v.rows });
      if (error) return refused(error.message);
      const result = (data && typeof data === "object" ? data : {}) as { imported?: number; skipped?: { row: number; reason: string }[] };
      return { ok: true, imported: result.imported ?? 0, skipped: result.skipped ?? [] };
    }
  }
}
