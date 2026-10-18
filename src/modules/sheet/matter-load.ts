import "server-only";
import {
  matterTab,
  type MatterDialogsData,
  type MatterDocumentRow,
  type MatterEvent,
  type MatterHeaderData,
  type MatterInviteData,
  type MatterPageData,
  type MatterPersonCard,
  type MatterRbarData,
  type MatterRelationship,
  type MatterTaskRow,
} from "@/components/sheet/designer/matter";
import type { MatterBadge } from "@/components/sheet/designer/matters";
import { createClient } from "@/lib/supabase/server";
import { staffPerson } from "@/modules/sheet/avatar";
import { isUuid } from "@/lib/tenant/context";
import { isLicensedMembership, LICENCE_FACT_COLUMNS } from "@/lib/tenant/roles";
import { loadSheetChrome, memberNames } from "@/modules/sheet/chrome-load";
import { dayMonth, isoDate, localNow } from "@/modules/sheet/home-present";
import type { SheetStaff } from "@/modules/sheet/load";
import {
  actorLabel,
  agreementState,
  agreementWord,
  deadlineBadge,
  defaultReview,
  documentState,
  dueIn,
  eventWhen,
  firstName,
  headerPills,
  longDate,
  MATTER_EVENT,
  partyRank,
  partyRole,
  relationLabel,
  reminderBadge,
  stageIndex,
  taskDue,
  taskRowBadge,
  weekdayDayMonth,
  clockTime,
} from "@/modules/sheet/matter-present";
import { governmentBadge, programLabel } from "@/modules/sheet/matters-present";
import { inviteEmailLines } from "@/modules/email/templates";
import { acceptPath, portalRoleForParty, portalRoleLabel } from "@/modules/sheet/portal-invite";
import { DEADLINE_KINDS, DEADLINE_ROLES, deadlineSource } from "@/modules/sheet/new-deadline";
import {
  governmentLabel,
  isoDateInTimeZone,
  MATTER_OUTCOMES,
  MATTER_STAGES,
  outcomeLabel,
  STAFF_ROLES,
  stageLabel,
  type SheetQuery,
} from "@/modules/sheet/present";

/**
 * The Designer's matter page for one matter, read as the signed-in staff member so
 * row-level security decides what is visible. Null when the matter is not this firm's
 * (or not visible to this member). Features without a backend yet (Vo, billing,
 * messages, forms, submissions) show nothing rather than sample values.
 */
export async function loadSheetMatter(staff: SheetStaff, matterId: string, query: SheetQuery, now: Date = new Date()) {
  if (!isUuid(matterId)) return null;
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const local = localNow(staff.timezone, now);
  const today = isoDate(local.year, local.month, local.day);

  const { data: matter } = await supabase
    .from("matters")
    .select(
      "id, title, reference, stage, government_status, on_hold, on_hold_reason, on_hold_owner_membership_id, on_hold_review_on, outcome, retention_on, program_pack_id, responsible_consultant_membership_id, is_sample, version, created_at, updated_at",
    )
    .eq("organization_id", org)
    .eq("id", matterId)
    .maybeSingle();
  if (!matter) return null;

  const [chrome, members, staffRows, participants, tasks, deadlines, requests, refs, agreements, pack, ownLicence, invitations] = await Promise.all([
    loadSheetChrome(staff, `/sheet/matters/${matter.id}`),
    memberNames(supabase, org),
    supabase.from("memberships").select("id").eq("organization_id", org).eq("status", "active").in("role", [...STAFF_ROLES]),
    supabase.from("matter_participants").select("person_id, membership_id, role").eq("organization_id", org).eq("matter_id", matter.id),
    supabase
      .from("tasks")
      .select("id, title, audience, status, due_on, owner_membership_id, owner_person_id, blocker_note")
      .eq("organization_id", org)
      .eq("matter_id", matter.id)
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(100),
    supabase
      .from("deadlines")
      .select("id, label, kind, due_on, due_at, timezone, verification, verifying_membership_id, evidence_locator, calculation_note, rule_version_id, source_url, source_retrieved_on, updated_at")
      .eq("organization_id", org)
      .eq("matter_id", matter.id)
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(50),
    supabase
      .from("document_requests")
      .select("id, purpose, person_id, document_id, status, source, due_on")
      .eq("organization_id", org)
      .eq("matter_id", matter.id)
      .neq("status", "cancelled")
      .order("created_at", { ascending: true })
      .limit(200),
    supabase.from("document_matter_refs").select("document_id").eq("organization_id", org).eq("matter_id", matter.id).is("removed_at", null).limit(200),
    supabase
      .from("agreements")
      .select("id, title, kind, status, current_version_id, updated_at")
      .eq("organization_id", org)
      .eq("matter_id", matter.id)
      .order("updated_at", { ascending: false })
      .limit(50),
    matter.program_pack_id ? supabase.from("rule_pack_versions").select("program_key, pack_version").eq("id", matter.program_pack_id).maybeSingle() : null,
    // A firm owner's own licence makes them a licensed consultant for these controls.
    staff.role === "firm_owner"
      ? supabase.from("consultant_credentials").select(LICENCE_FACT_COLUMNS).eq("organization_id", org).eq("membership_id", staff.membershipId).maybeSingle()
      : null,
    // Open portal invitations on this matter (row-level security shows them to staff who may invite).
    supabase
      .from("portal_invitations")
      .select("person_id, created_at")
      .eq("organization_id", org)
      .eq("matter_id", matter.id)
      .is("consumed_at", null)
      .is("revoked_at", null)
      .is("declined_at", null)
      .gt("expires_at", now.toISOString())
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const parties = participants.data ?? [];
  const taskRows = tasks.data ?? [];
  const deadlineRows = deadlines.data ?? [];
  const requestRows = requests.data ?? [];
  const agreementRows = agreements.data ?? [];
  const documentIds = [...new Set([...(refs.data ?? []).map((row) => row.document_id), ...requestRows.map((row) => row.document_id).filter((id): id is string => Boolean(id))])];
  const agreementIds = agreementRows.map((row) => row.id);
  const versionIds = agreementRows.map((row) => row.current_version_id).filter((id): id is string => Boolean(id));
  const next = deadlineRows.find((row) => row.due_on && row.due_on >= today) ?? null;
  const auditIds = [matter.id, ...documentIds, ...agreementIds, ...taskRows.map((row) => row.id)].slice(0, 300);

  const [documents, versions, envelopes, agreementVersions, reminders, audit] = await Promise.all([
    documentIds.length ? supabase.from("documents").select("id, purpose, person_id, current_version_id").eq("organization_id", org).in("id", documentIds) : null,
    documentIds.length
      ? supabase.from("document_versions").select("id, document_id, upload_state, review_state, version_number, expires_on").eq("organization_id", org).in("document_id", documentIds)
      : null,
    agreementIds.length
      ? supabase.from("signature_envelopes").select("id, agreement_id, status, provider, sealed_sha256, sent_at, completed_at").eq("organization_id", org).in("agreement_id", agreementIds).order("sent_at", { ascending: false })
      : null,
    versionIds.length ? supabase.from("agreement_versions").select("id, version_number").eq("organization_id", org).in("id", versionIds) : null,
    next ? supabase.from("reminder_schedules").select("offset_days, scheduled_for, status").eq("organization_id", org).eq("deadline_id", next.id).order("scheduled_for", { ascending: true }).limit(8) : null,
    supabase
      .from("audit_log")
      .select("action, actor_type, occurred_at")
      .eq("organization_id", org)
      .in("object_id", auditIds)
      .in("action", Object.keys(MATTER_EVENT))
      .eq("result", "success")
      .order("occurred_at", { ascending: false })
      .limit(5),
  ]);

  const envelopeRows = envelopes?.data ?? [];
  const latestEnvelope = new Map<string, (typeof envelopeRows)[number]>();
  for (const row of envelopeRows) if (!latestEnvelope.has(row.agreement_id)) latestEnvelope.set(row.agreement_id, row);
  const envelopeIds = [...latestEnvelope.values()].map((row) => row.id);

  const documentRows = documents?.data ?? [];
  const personIds = [
    ...new Set(
      [...parties.map((row) => row.person_id), ...requestRows.map((row) => row.person_id), ...documentRows.map((row) => row.person_id)].filter((id): id is string => Boolean(id)),
    ),
  ];
  const [persons, signers, relationships] = await Promise.all([
    personIds.length ? supabase.from("persons").select("id, display_name, email, user_id").eq("organization_id", org).in("id", personIds) : null,
    envelopeIds.length
      ? supabase.from("envelope_signers").select("envelope_id, display_name, signing_order, status, signed_at").eq("organization_id", org).in("envelope_id", envelopeIds).order("signing_order", { ascending: true })
      : null,
    personIds.length
      ? supabase.from("person_relationships").select("from_person_id, to_person_id, relationship_type").eq("organization_id", org).in("from_person_id", personIds).in("to_person_id", personIds)
      : null,
  ]);

  const person = new Map((persons?.data ?? []).map((row) => [row.id, row]));
  const personName = (id: string | null) => (id ? person.get(id)?.display_name : undefined) || "Unknown person";
  const memberName = (id: string | null) => (id ? members.get(id) : undefined) || "Unassigned";

  const ordered = [...parties].sort((a, b) => partyRank(a.role) - partyRank(b.role));
  const applicantRow = ordered.find((row) => row.person_id);
  const clientName = applicantRow ? personName(applicantRow.person_id) : matter.title;
  const client = { name: clientName };
  const consultant = matter.responsible_consultant_membership_id ? members.get(matter.responsible_consultant_membership_id) : undefined;
  const program = pack?.data ? programLabel(pack.data.program_key) : null;

  // Documents: each request (with what was uploaded for it), then documents linked without a request.
  const versionById = new Map((versions?.data ?? []).map((row) => [row.id, row]));
  const documentById = new Map(documentRows.map((row) => [row.id, row]));
  const currentVersion = (documentId: string | null) => {
    const doc = documentId ? documentById.get(documentId) : undefined;
    const version = doc?.current_version_id ? versionById.get(doc.current_version_id) : undefined;
    return version
      ? { uploadState: version.upload_state, reviewState: version.review_state, versionNumber: version.version_number, expiresOn: version.expires_on }
      : null;
  };
  const requested = new Set(requestRows.map((row) => row.document_id).filter(Boolean));
  const checklist = [
    ...requestRows.map((row) => ({
      title: row.purpose,
      kind: row.source === "rule" ? "From the checklist" : "Requested by the firm",
      personId: row.person_id,
      state: documentState({ requestStatus: row.status, version: currentVersion(row.document_id) }, today),
    })),
    ...documentRows
      .filter((row) => !requested.has(row.id))
      .map((row) => ({ title: row.purpose, kind: "Added to the file", personId: row.person_id, state: documentState({ requestStatus: null, version: currentVersion(row.id) }, today) })),
  ];
  const counts = { accepted: 0, review: 0, outstanding: 0 };
  for (const row of checklist) if (row.state.bucket) counts[row.state.bucket] += 1;

  const documentTable: MatterDocumentRow[] = checklist.map((row) => ({
    title: row.title,
    kind: row.kind,
    person: { name: personName(row.personId) },
    upload: row.state.upload,
    review: row.state.review,
    version: row.state.version,
  }));

  // Overview.
  const stage = stageIndex(matter.stage);
  const blockers = [
    ...taskRows.filter((row) => row.status === "blocked").map((row) => ({ blocking: true, text: row.blocker_note || row.title })),
    ...[
      ...taskRows.filter((row) => row.status === "open" && row.due_on).map((row) => ({ title: row.title, due: row.due_on as string })),
      ...requestRows.filter((row) => row.status === "open" && row.due_on).map((row) => ({ title: row.purpose, due: row.due_on as string })),
    ]
      .filter((row) => row.due <= defaultReview(today))
      .sort((a, b) => a.due.localeCompare(b.due))
      .map((row) => ({ blocking: false, text: `${row.title} ${dueIn(row.due, today)}` })),
  ].slice(0, 4);

  const keyPeople = ordered
    .filter((row) => row.person_id)
    .slice(0, 4)
    .map((row) => ({ person: { name: personName(row.person_id) }, role: partyRole(row.role) }));

  const events: MatterEvent[] = (audit.data ?? []).map((row) => {
    const event = MATTER_EVENT[row.action];
    return { dot: event.dot, title: event.title, parts: [event.source, actorLabel(row.actor_type)], badge: event.badge, when: eventWhen(row.occurred_at, staff.timezone, today) };
  });

  const badges: MatterBadge[] = [
    { tone: "blue", label: "Stage", detail: stageLabel(matter.stage) },
    { ...governmentBadge(matter.government_status), label: "Government", detail: governmentLabel(matter.government_status) },
    deadlineBadge(next ? { dueOn: next.due_on, dueAt: next.due_at, timezone: next.timezone, verification: next.verification } : null),
  ];

  const facts = [matter.reference ?? "No reference yet", ...(program ? [program] : []), ...(consultant ? [`Consultant ${consultant}`] : [])];

  // People: clients from the matter's participants, then the staff on it.
  // public.create_portal_invitation lets an owner, or a consultant or case manager on the matter, invite.
  const canInvite = staff.role === "firm_owner" || staff.role === "licensed_consultant" || staff.role === "case_manager";
  const invitedOn = new Map<string, string>();
  for (const row of invitations?.data ?? []) {
    if (!invitedOn.has(row.person_id)) invitedOn.set(row.person_id, dayMonth(isoDateInTimeZone(new Date(row.created_at), staff.timezone)));
  }
  const staffIds = new Set<string>();
  const cards: MatterPersonCard[] = [];
  for (const row of ordered) {
    if (row.person_id) {
      const record = person.get(row.person_id);
      const invited = invitedOn.get(row.person_id);
      const portalRole = portalRoleForParty(row.role);
      cards.push({
        person: { name: personName(row.person_id) },
        role: partyRole(row.role),
        parts: [record?.email || "No email on file"],
        pill: { label: record?.user_id ? "Portal active" : invited ? `Invited ${invited}` : "No portal access" },
        invite: canInvite && record && !record.user_id && portalRole ? { personId: record.id, role: portalRoleLabel(portalRole), email: record.email ?? "" } : null,
      });
    } else if (row.membership_id && !staffIds.has(row.membership_id)) {
      staffIds.add(row.membership_id);
      cards.push({
        person: staffPerson(memberName(row.membership_id)),
        role: partyRole(row.role),
        parts: ["Firm staff"],
        pill: { label: row.membership_id === matter.responsible_consultant_membership_id ? "Responsible" : "Assigned" },
      });
    }
  }
  if (matter.responsible_consultant_membership_id && !staffIds.has(matter.responsible_consultant_membership_id)) {
    cards.push({ person: staffPerson(memberName(matter.responsible_consultant_membership_id)), role: "Licensed consultant", parts: ["Firm staff"], pill: { label: "Responsible" } });
  }
  const relationRows: MatterRelationship[] = (relationships?.data ?? []).map((row) => ({
    from: firstName(personName(row.from_person_id)),
    relation: relationLabel(row.relationship_type),
    to: firstName(personName(row.to_person_id)),
    evidence: "—",
    sharing: null,
  }));

  // Agreements.
  const versionNumber = new Map((agreementVersions?.data ?? []).map((row) => [row.id, row.version_number]));
  const signerRows = signers?.data ?? [];
  const signersOf = (agreementId: string) => {
    const envelope = latestEnvelope.get(agreementId);
    return envelope ? signerRows.filter((row) => row.envelope_id === envelope.id) : [];
  };
  const agreementTable = agreementRows.map((row) => {
    const people = signersOf(row.id);
    const envelope = latestEnvelope.get(row.id);
    const number = row.current_version_id ? versionNumber.get(row.current_version_id) : undefined;
    const sentOn = envelope?.sent_at ? `sent ${dayMonth(isoDateInTimeZone(new Date(envelope.sent_at), staff.timezone))}` : null;
    return {
      title: row.title,
      version: [number ? `v${number}` : "—", ...(sentOn && row.status !== "completed" ? [sentOn] : [])],
      parties: people.length ? people.map((signer) => firstName(signer.display_name)).join(", ") : "—",
      signatures: people.length ? `${people.filter((signer) => signer.status === "signed").length} of ${people.length}` : "—",
      state: agreementState(row.status),
      href: "/sheet/agreements",
      action: envelope && row.status !== "completed" ? "Track envelope" : "Open",
    };
  });
  const signed = agreementRows.find((row) => signersOf(row.id).length > 0);
  const signing = signed
    ? {
        title: signed.title,
        signers: signersOf(signed.id).map((signer) => ({
          person: { name: signer.display_name },
          order: signer.signing_order,
          note:
            signer.status === "signed" && signer.signed_at
              ? `Signed ${dayMonth(isoDateInTimeZone(new Date(signer.signed_at), staff.timezone))}, ${clockTime(signer.signed_at, staff.timezone)}`
              : signer.status === "declined"
                ? "Declined"
                : signer.status === "current"
                  ? "Waiting to sign"
                  : "Waiting for earlier signers",
          signed: signer.status === "signed",
        })),
        hash: latestEnvelope.get(signed.id)?.sealed_sha256 ? `${latestEnvelope.get(signed.id)?.sealed_sha256?.slice(0, 4)}…${latestEnvelope.get(signed.id)?.sealed_sha256?.slice(-4)}` : null,
      }
    : null;

  // Tasks and deadlines.
  const taskTable: MatterTaskRow[] = taskRows
    .filter((row) => row.status !== "cancelled")
    .map((row) => {
      const owner = row.owner_membership_id ? memberName(row.owner_membership_id) : row.owner_person_id ? personName(row.owner_person_id) : "Unassigned";
      const due = taskDue(row.due_on, today);
      return {
        title: row.title,
        parts: [
          row.audience === "client" ? "Client task" : "Internal",
          firstName(owner),
          ...(row.status === "blocked" && row.blocker_note ? [`blocked by ${row.blocker_note}`] : []),
          ...(due ? [due] : []),
        ],
        badge: taskRowBadge(row.status, row.due_on, today),
        owner: row.owner_membership_id ? staffPerson(owner) : { name: owner },
      };
    });
  const deadline = next
    ? {
        label: next.label,
        due: `${weekdayDayMonth(next.due_on as string)} ${(next.due_on as string).slice(0, 4)}${next.due_at ? `, ${clockTime(next.due_at, next.timezone)}` : ""}`,
        verified:
          next.verification === "confirmed"
            ? ({ tone: "ok", label: next.verifying_membership_id ? `Verified by ${memberName(next.verifying_membership_id)}` : "Verified" } as MatterBadge)
            : ({ tone: "chg", label: "Not verified yet" } as MatterBadge),
        source: deadlineSource(next.evidence_locator, next.source_url, next.source_retrieved_on ? dayMonth(next.source_retrieved_on) : null),
        origin: `${next.rule_version_id ? "Derived from a program rule." : "Not derived from a rule."}${next.calculation_note ? ` ${next.calculation_note}` : ""}`,
        reminders: (reminders?.data ?? []).map((row) => ({
          label: row.offset_days != null ? `${row.offset_days} ${row.offset_days === 1 ? "day" : "days"}` : "Reminder",
          date: dayMonth(isoDateInTimeZone(new Date(row.scheduled_for), staff.timezone)),
          badge: reminderBadge(row.status),
        })),
        timezone: `Official: ${next.due_at ? clockTime(next.due_at, next.timezone) : "end of day"} (${next.timezone})`,
      }
    : null;

  // Right column.
  const service = agreementRows.find((row) => row.kind === "service") ?? agreementRows[0];
  const serviceSigners = service ? signersOf(service.id) : [];
  const serviceEnvelope = service ? latestEnvelope.get(service.id) : undefined;
  const serviceNumber = service?.current_version_id ? versionNumber.get(service.current_version_id) : undefined;
  const rbar: MatterRbarData = service
    ? {
        agreement: {
          title: `${service.title}${serviceNumber ? ` v${serviceNumber}` : ""}`,
          state: agreementWord(service.status),
          parts: [
            serviceSigners.length ? `${serviceSigners.filter((row) => row.status === "signed").length} of ${serviceSigners.length} signed` : "No signers yet",
            ...(serviceEnvelope?.completed_at ? [dayMonth(isoDateInTimeZone(new Date(serviceEnvelope.completed_at), staff.timezone))] : []),
          ],
        },
      }
    : { agreement: { title: "No agreement yet", state: null, parts: ["Quotes and service agreements start from an approved template."] } };

  const hold = matter.on_hold
    ? {
        reason: matter.on_hold_reason,
        parts: [
          `Owner ${memberName(matter.on_hold_owner_membership_id)}`,
          ...(matter.on_hold_review_on ? [`review ${dayMonth(matter.on_hold_review_on)}`] : []),
          "deadline alerts still on",
        ],
      }
    : null;

  const tab = matterTab(query.tab);
  // Every change is still checked by the database (role, version, step-up); this only says which matter.
  const wire = { organizationId: org, matterId: matter.id, version: matter.version };
  // public.record_deadline accepts these roles; anyone else is not offered the dialog.
  const recordsDeadlines = (DEADLINE_ROLES as readonly string[]).includes(staff.role);
  const header: MatterHeaderData = { client, pills: headerPills(matter.updated_at, matter.created_at, staff.timezone, now), hold, tab, wire, deadline: recordsDeadlines };

  const inviteDialog: MatterInviteData = {
    matter: { client: clientName, reference: matter.reference },
    email: "",
    mail: inviteEmailLines(staff.organizationName, "portal"),
    preview: acceptPath("client"),
    // A real matter while the firm is still in sample mode: the database refuses real client invitations.
    locked: staff.sampleMode && !matter.is_sample,
    wire: { organizationId: org, matterId: matter.id },
  };

  // A hold's owner is someone on the firm's staff, never a client. The responsible consultant comes first.
  const holdStaff = (staffRows.data ?? []).map((row) => row.id);
  const responsible = matter.responsible_consultant_membership_id;
  const ownerIds = responsible && holdStaff.includes(responsible) ? [responsible, ...holdStaff.filter((id) => id !== responsible)] : holdStaff;
  const dialogs: MatterDialogsData = {
    current: stage,
    target: stage < MATTER_STAGES.length - 1 ? stage + 1 : null,
    version: matter.version,
    evidence: [],
    reason: "",
    owners: ownerIds.length ? ownerIds.map((id) => ({ id, name: memberName(id) })) : [{ id: staff.membershipId, name: staff.displayName }],
    reviewOn: matter.on_hold_review_on ?? defaultReview(today),
    receivedOn: today,
    wire,
    invite: canInvite ? inviteDialog : null,
    deadline: recordsDeadlines ? { timezone: staff.timezone, sampleMode: staff.sampleMode && !matter.is_sample, kinds: DEADLINE_KINDS } : null,
  };
  const confirmOutcome =
    !matter.outcome && matter.government_status === "decision_evidence_on_file" && isLicensedMembership(staff.role, ownLicence?.data)
      ? { options: MATTER_OUTCOMES.map((value) => ({ value, label: outcomeLabel(value) })), wire }
      : null;

  const page: MatterPageData = {
    tab,
    overview: {
      client,
      facts,
      badges,
      stage: { index: stage, total: MATTER_STAGES.length, label: stageLabel(matter.stage) },
      documents: counts,
      requests: checklist
        .filter((row) => row.state.bucket === "outstanding" || row.state.bucket === "review")
        .slice(0, 5)
        .map((row) => ({ person: { name: personName(row.personId) }, title: row.title, badge: row.state.review })),
      blockers,
      people: keyPeople,
      events,
    },
    people: { cards, relationships: relationRows },
    documents: {
      checklist: program,
      people: [...new Set(checklist.map((row) => firstName(personName(row.personId))))].slice(0, 4),
      rows: documentTable,
    },
    agreements: { rows: agreementTable, signing },
    tasks: { deadline, tasks: taskTable, record: recordsDeadlines },
    outcome: matter.outcome ? outcomeLabel(matter.outcome) : null,
    confirmOutcome,
    closure: { closed: matter.stage === "closed", retention: matter.retention_on ? longDate(matter.retention_on) : null },
  };

  return { chrome, header, rbar, dialogs, page };
}
