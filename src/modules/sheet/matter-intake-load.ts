import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { MatterIntakeData } from "@/components/sheet/designer/matter-intake";
import { schemaFields, type AnswerVersion, type Presence } from "@/modules/intake/present";
import { intakePanel, mayHandleIntake, publishedForms, sendPersonLabel } from "@/modules/sheet/matter-intake-present";
import type { SheetStaff } from "@/modules/sheet/load";

type Client = Awaited<ReturnType<typeof createClient>>;

const PRESENCES = new Set(["provided", "unknown", "not_applicable", "approximate"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The matter's Intake tab, read as the signed-in member: row-level security decides which
 * responses and answers they see (staff on the matter; person rows and answers stay
 * assignment-based). `people` are the matter's persons in the Designer's order, applicant first.
 */
export async function loadMatterIntake(
  supabase: Client,
  input: {
    staff: SheetStaff;
    matter: { id: string; is_sample: boolean };
    people: { id: string; name: string; role: string; hasLogin: boolean; dateOfBirth: string | null; birthPrecision: string | null }[];
    today: string;
  },
): Promise<MatterIntakeData> {
  const org = input.staff.organizationId;
  const handles = mayHandleIntake(input.staff.role);
  const [responses, templates] = await Promise.all([
    supabase
      .from("intake_responses")
      .select("id, template_id, person_id, status, submitted_at, frozen_at, created_at")
      .eq("organization_id", org)
      .eq("matter_id", input.matter.id)
      .order("created_at", { ascending: true })
      .limit(50),
    supabase.from("intake_templates").select("id, stable_key, title, version_number, status, effective_on, schema").eq("organization_id", org).limit(200),
  ]);
  const rows = responses.data ?? [];
  const ids = rows.map((row) => row.id);
  const personIds = [...new Set(rows.map((row) => row.person_id))];
  const [answers, corrections, documents, otherAnswers] = await Promise.all([
    ids.length
      ? supabase.from("intake_answer_versions").select("id, response_id, field_key, presence, raw_value, normalized_value, created_at, created_by").in("response_id", ids).order("created_at", { ascending: true }).limit(3000)
      : null,
    ids.length ? supabase.from("intake_corrections").select("response_id, correction_number, field_key, answer_id, description, created_at, proof_document_id").in("response_id", ids) : null,
    personIds.length ? supabase.from("documents").select("person_id, purpose, current_version_id").eq("organization_id", org).in("person_id", personIds).limit(300) : null,
    // The same people's date-of-birth answers on their other matters' forms (conflicting birth dates).
    personIds.length
      ? supabase.from("intake_responses").select("id, person_id, template_id").eq("organization_id", org).in("person_id", personIds).neq("matter_id", input.matter.id).limit(100)
      : null,
  ]);
  const answerRows = answers?.data ?? [];
  const [reviews, versions, profiles, people, otherBirthRows] = await Promise.all([
    answerRows.length ? supabase.from("intake_answer_reviews").select("answer_id, created_at, created_by").in("answer_id", answerRows.map((row) => row.id)) : null,
    (documents?.data ?? []).some((row) => row.current_version_id)
      ? supabase
          .from("document_versions")
          .select("id, expires_on")
          .eq("organization_id", org)
          .in("id", (documents?.data ?? []).map((row) => row.current_version_id).filter((id): id is string => Boolean(id)))
      : null,
    answerRows.length ? supabase.from("profiles").select("id, display_name").in("id", [...new Set(answerRows.map((row) => row.created_by).filter((id): id is string => Boolean(id)))]) : null,
    personIds.length ? supabase.from("persons").select("id, user_id, display_name").eq("organization_id", org).in("id", personIds) : null,
    (otherAnswers?.data ?? []).length
      ? supabase.from("intake_answer_versions").select("id, response_id, field_key, presence, raw_value, normalized_value, created_at, created_by").in("response_id", (otherAnswers?.data ?? []).map((row) => row.id)).limit(500)
      : null,
  ]);
  const reviewed = new Set((reviews?.data ?? []).map((row) => row.answer_id));
  // INT-04: who reviewed each answer and when, and a correction's proof document.
  const reviewInfo = new Map((reviews?.data ?? []).map((row) => [row.answer_id, { by: row.created_by ?? null, at: row.created_at }]));
  const reviewerIds = [...new Set((reviews?.data ?? []).map((row) => row.created_by).filter((id): id is string => Boolean(id)))];
  const reviewers = reviewerIds.length ? await supabase.from("profiles").select("id, display_name").in("id", reviewerIds) : null;
  const proofOf = new Map((corrections?.data ?? []).filter((row) => row.answer_id && row.proof_document_id).map((row) => [row.answer_id as string, row.proof_document_id as string]));
  const expires = new Map((versions?.data ?? []).map((row) => [row.id, row.expires_on]));
  const profileName = new Map([...(profiles?.data ?? []), ...(reviewers?.data ?? [])].map((row) => [row.id, row.display_name]));
  const personByUser = new Map((people?.data ?? []).filter((row) => row.user_id).map((row) => [row.user_id as string, row.display_name]));
  const templateById = new Map((templates.data ?? []).map((row) => [row.id, row]));
  const personInfo = new Map(input.people.map((person) => [person.id, person]));
  const who = (userId: string | null) => (userId ? (personByUser.get(userId) ?? profileName.get(userId) ?? "Someone") : "Someone");
  const toAnswer = (row: (typeof answerRows)[number]): AnswerVersion => ({
    id: row.id,
    fieldKey: row.field_key,
    presence: row.presence as Presence,
    value: record(row.normalized_value),
    raw: record(row.raw_value),
    createdAt: row.created_at,
    createdBy: row.created_by,
  });
  const birthKeys = /(^|_)(date_of_birth|birth_date|dob)$/;
  const otherResponsePerson = new Map((otherAnswers?.data ?? []).map((row) => [row.id, row.person_id]));

  const panels = rows.flatMap((row) => {
    const template = templateById.get(row.template_id);
    if (!template) return [];
    const person = personInfo.get(row.person_id);
    const personName = person?.name ?? (people?.data ?? []).find((item) => item.id === row.person_id)?.display_name ?? "Person";
    const mine = answerRows.filter((answer) => answer.response_id === row.id && PRESENCES.has(answer.presence)).map(toAnswer);
    const otherBirths = [
      ...answerRows.filter((answer) => answer.response_id !== row.id && rows.find((other) => other.id === answer.response_id)?.person_id === row.person_id),
      ...(otherBirthRows?.data ?? []).filter((answer) => otherResponsePerson.get(answer.response_id) === row.person_id),
    ]
      .filter((answer) => birthKeys.test(answer.field_key) && PRESENCES.has(answer.presence))
      .map(toAnswer);
    return [
      intakePanel(
        {
          id: row.id,
          personName,
          title: template.title,
          versionNumber: template.version_number,
          status: row.status === "submitted" ? "submitted" : "draft",
          submittedAt: row.submitted_at,
          frozenAt: row.frozen_at,
          fields: schemaFields(template.schema),
          answers: mine,
          reviewed,
          corrections: (corrections?.data ?? [])
            .filter((item) => item.response_id === row.id)
            .map((item) => ({ number: item.correction_number, fieldKey: item.field_key, answerId: item.answer_id, description: item.description, createdAt: item.created_at })),
          record: person ? { displayName: person.name, dateOfBirth: person.dateOfBirth, birthPrecision: person.birthPrecision } : null,
          documents: (documents?.data ?? [])
            .filter((doc) => doc.person_id === row.person_id && doc.current_version_id)
            .map((doc) => ({ purpose: doc.purpose, expiresOn: expires.get(doc.current_version_id as string) ?? null })),
          otherBirths,
          reviews: reviewInfo,
          proofHref: (answerId) => (proofOf.has(answerId) ? `/sheet/matters/${input.matter.id}?tab=documents` : null),
        },
        who,
        input.staff.timezone,
        input.today,
      ),
    ];
  });

  return {
    organizationId: org,
    panels,
    reviewer: handles,
    send: handles
      ? {
          organizationId: org,
          matterId: input.matter.id,
          forms: publishedForms(templates.data ?? [], input.today),
          people: input.people.map((person) => ({ id: person.id, label: sendPersonLabel(person.name, person.role, person.hasLogin) })),
          today: input.today,
          sampleMode: input.staff.sampleMode && !input.matter.is_sample,
        }
      : null,
    note: "Answers are read by the staff on this matter and the person who gave them. A sponsor or family member sees only their own forms, and answers a form marks to share with them.",
  };
}
