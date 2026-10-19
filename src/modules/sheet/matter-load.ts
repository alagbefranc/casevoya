import "server-only";
import { loadMatterMessages } from "@/modules/messages/load";
import { loadVoComposer } from "@/modules/sheet/vo-load";
import { loadVoReadingPanel } from "@/modules/sheet/vo-doc-load";
import {
  matterTab,
  type MatterAgreementRow,
  type MatterDeadline,
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
import { todayIso } from "@/modules/sheet/birth-date";
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
  allowedStageIndexes,
  dayMonthYear,
  defaultTargetStage,
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
import { deadlineConfirmable, TASK_STAFF_ROLES, taskManageWire } from "@/modules/sheet/tasks-present";
import { clientOptions, dependsOnOptions, matterOptions, staffOptions } from "@/modules/sheet/new-task";
import { personHref } from "@/modules/sheet/clients-present";
import { loadMatterBilling } from "@/modules/sheet/matter-billing-load";
import { agreementViewHref } from "@/modules/sheet/agreements-views-present";
import {
  COUNTERSIGN_BADGE,
  countersignDialogData,
  countersignDialogId,
  countersignHref,
  countersignTurn,
  esignConsent,
  newAgreementHref,
} from "@/modules/sheet/agreements-present";
import type { CountersignDialogData } from "@/components/sheet/designer/agreements";
import { inviteEmailLines } from "@/modules/email/templates";
import { acceptPath, portalRoleForParty, portalRoleLabel } from "@/modules/sheet/portal-invite";
import { mayOfferPersonEdit, personEditData } from "@/modules/sheet/edit-person";
import { loadMatterGovernment } from "@/modules/sheet/government-load";
import { DEADLINE_KINDS, DEADLINE_ROLES, deadlineSource } from "@/modules/sheet/new-deadline";
import { missingPolicies } from "@/modules/portal-policies/defaults";
import { loadCurrentPolicies } from "@/modules/portal-policies/load";
import { loadClosurePanel } from "@/modules/sheet/closure-load";
import { loadMatterIntake } from "@/modules/sheet/matter-intake-load";
import { docRequestPersonLabel, mayRequestDocuments } from "@/modules/sheet/doc-request";
import {
  governmentLabel,
  isoDateInTimeZone,
  plusDays,
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
  // Clients can't accept a portal invitation until the firm publishes its terms and privacy notice.
  const policies = loadCurrentPolicies(supabase, org);

  const [chrome, members, staffRows, participants, tasks, deadlines, requests, refs, agreements, pack, ownLicence, invitations] = await Promise.all([
    loadSheetChrome(staff, `/sheet/matters/${matter.id}`),
    memberNames(supabase, org),
    supabase.from("memberships").select("id").eq("organization_id", org).eq("status", "active").in("role", [...STAFF_ROLES]),
    supabase.from("matter_participants").select("person_id, membership_id, role").eq("organization_id", org).eq("matter_id", matter.id),
    supabase
      .from("tasks")
      .select("id, title, audience, status, due_on, owner_membership_id, owner_person_id, blocker_note, version")
      .eq("organization_id", org)
      .eq("matter_id", matter.id)
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(100),
    supabase
      .from("deadlines")
      .select("id, label, kind, due_on, due_at, timezone, verification, verifying_membership_id, evidence_locator, calculation_note, rule_version_id, source_url, source_retrieved_on, updated_at, version")
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
  // Every deadline still ahead (a timed one by its instant, a date-only one by its day), soonest first.
  const dueDay = (row: (typeof deadlineRows)[number]) => row.due_on ?? (row.due_at ? isoDateInTimeZone(new Date(row.due_at), staff.timezone) : "");
  const upcoming = deadlineRows
    .filter((row) => (row.due_at ? new Date(row.due_at).getTime() >= now.getTime() : dueDay(row) >= today))
    .sort((a, b) => dueDay(a).localeCompare(dueDay(b)));
  const next = upcoming[0] ?? null;
  const auditIds = [matter.id, ...documentIds, ...agreementIds, ...taskRows.map((row) => row.id)].slice(0, 300);

  const [documents, versions, envelopes, agreementVersions, reminders, audit] = await Promise.all([
    documentIds.length ? supabase.from("documents").select("id, purpose, person_id, current_version_id").eq("organization_id", org).in("id", documentIds) : null,
    documentIds.length
      ? supabase.from("document_versions").select("id, document_id, upload_state, review_state, version_number, expires_on").eq("organization_id", org).in("document_id", documentIds)
      : null,
    agreementIds.length
      ? supabase
          .from("signature_envelopes")
          .select("id, agreement_id, status, provider, sealed_sha256, content_sha256, sent_at, completed_at")
          .eq("organization_id", org)
          .in("agreement_id", agreementIds)
          .order("sent_at", { ascending: false })
      : null,
    versionIds.length ? supabase.from("agreement_versions").select("id, version_number").eq("organization_id", org).in("id", versionIds) : null,
    upcoming.length
      ? supabase
          .from("reminder_schedules")
          .select("deadline_id, offset_days, scheduled_for, status")
          .eq("organization_id", org)
          .in("deadline_id", upcoming.map((row) => row.id))
          .order("scheduled_for", { ascending: true })
          .limit(200)
      : null,
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
  const [persons, signers, relationships, consentSetting] = await Promise.all([
    personIds.length ? supabase.from("persons").select("id, display_name, email, contact_phone, user_id, date_of_birth, birth_date_precision, version").eq("organization_id", org).in("id", personIds) : null,
    envelopeIds.length
      ? supabase
          .from("envelope_signers")
          .select("envelope_id, membership_id, display_name, signing_order, status, signed_at")
          .eq("organization_id", org)
          .in("envelope_id", envelopeIds)
          .order("signing_order", { ascending: true })
      : null,
    personIds.length
      ? supabase.from("person_relationships").select("from_person_id, to_person_id, relationship_type").eq("organization_id", org).in("from_person_id", personIds).in("to_person_id", personIds)
      : null,
    // The e-sign consent the portal shows, for the countersign dialog.
    supabase.from("product_settings").select("value").eq("key", "agreements.esign_consent").maybeSingle(),
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
      documentId: row.document_id,
      personId: row.person_id,
      state: documentState({ requestStatus: row.status, version: currentVersion(row.document_id) }, today),
    })),
    ...documentRows
      .filter((row) => !requested.has(row.id))
      .map((row) => ({
        title: row.purpose,
        kind: "Added to the file",
        documentId: row.id as string | null,
        personId: row.person_id,
        state: documentState({ requestStatus: null, version: currentVersion(row.id) }, today),
      })),
  ];
  const counts = { accepted: 0, review: 0, outstanding: 0 };
  for (const row of checklist) if (row.state.bucket) counts[row.state.bucket] += 1;

  // Vo's reading of one document waiting for review: the Designer's review panel (`#ocr`).
  const voReading = matterTab(query.tab) === "documents" ? await loadVoReadingPanel(supabase, org, matter.id, query.vo ?? null).catch(() => null) : null;
  const documentTable: MatterDocumentRow[] = checklist.map((row) => ({
    title: row.title,
    kind: row.kind,
    person: { name: personName(row.personId) },
    upload: row.state.upload,
    review: row.state.review,
    version: row.state.version,
    open: voReading && row.documentId === voReading.documentId ? { href: "#ocr", label: "Review" } : null,
    who: firstName(personName(row.personId)),
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
    deadlineBadge(
      next ? { dueOn: dueDay(next) || null, dueAt: next.due_at, timezone: next.timezone, verification: next.verification } : null,
      Math.max(0, upcoming.length - 1),
      today,
    ),
  ];

  const facts = [matter.reference ?? "No reference yet", ...(program ? [program] : []), ...(consultant ? [`Consultant ${consultant}`] : [])];

  // People: clients from the matter's participants, then the staff on it.
  // public.create_portal_invitation lets an owner, or a consultant or case manager on the matter, invite.
  const canInvite = staff.role === "firm_owner" || staff.role === "licensed_consultant" || staff.role === "case_manager";
  const canEdit = mayOfferPersonEdit(staff.role);
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
        invite:
          canInvite && record && !record.user_id && portalRole
            ? { personId: record.id, role: portalRoleLabel(portalRole), email: record.email ?? "", birthDateMissing: !record.date_of_birth }
            : null,
        // Edit details; row-level security (app.can_write_person) decides whether the save goes through.
        edit: canEdit && record ? personEditData(org, record) : null,
        inert: "Your role can’t edit people or invite them to the portal.",
      });
    } else if (row.membership_id && !staffIds.has(row.membership_id)) {
      staffIds.add(row.membership_id);
      cards.push({
        person: staffPerson(memberName(row.membership_id)),
        role: partyRole(row.role),
        parts: ["Firm staff"],
        pill: { label: row.membership_id === matter.responsible_consultant_membership_id ? "Responsible" : "Assigned" },
        staff: "/sheet/settings",
      });
    }
  }
  if (matter.responsible_consultant_membership_id && !staffIds.has(matter.responsible_consultant_membership_id)) {
    cards.push({
      person: staffPerson(memberName(matter.responsible_consultant_membership_id)),
      role: "Licensed consultant",
      parts: ["Firm staff"],
      pill: { label: "Responsible" },
      staff: "/sheet/settings",
    });
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
  // Envelopes where the signed-in staff member is the current signer: their turn to countersign.
  const consent = esignConsent(consentSetting?.data?.value);
  const countersign: CountersignDialogData[] = [];
  const agreementTable: MatterAgreementRow[] = agreementRows.map((row) => {
    const people = signersOf(row.id);
    const envelope = latestEnvelope.get(row.id);
    const number = row.current_version_id ? versionNumber.get(row.current_version_id) : undefined;
    const sentOn = envelope?.sent_at ? `sent ${dayMonth(isoDateInTimeZone(new Date(envelope.sent_at), staff.timezone))}` : null;
    const signedCount = people.filter((signer) => signer.status === "signed").length;
    const turn = Boolean(
      envelope && ["sent", "partially_signed"].includes(envelope.status) && countersignTurn(people, envelope.id, staff.membershipId),
    );
    if (turn && envelope) {
      countersign.push(
        countersignDialogData({
          organizationId: org,
          envelopeId: envelope.id,
          title: row.title,
          versionNumber: number,
          client: clientName,
          matter: matter.reference ?? matter.title,
          contentSha: envelope.content_sha256,
          signed: signedCount,
          total: people.length,
          consent,
        }),
      );
    }
    return {
      title: row.title,
      version: [number ? `v${number}` : "—", ...(sentOn && row.status !== "completed" ? [sentOn] : [])],
      parties: people.length ? people.map((signer) => firstName(signer.display_name)).join(", ") : "—",
      signatures: people.length ? `${signedCount} of ${people.length}` : "—",
      state: turn ? COUNTERSIGN_BADGE : agreementState(row.status),
      // The agreement's own view: a quote in the Quote builder, an unsent draft in the Agreement
      // editor, else its envelope, signers, events and the signed PDF.
      href: turn && envelope ? countersignHref(envelope.id) : agreementViewHref(row, Boolean(envelope)),
      action: turn ? "Countersign" : envelope && row.status !== "completed" ? "Track envelope" : "Open",
      ...(turn && envelope ? { dialog: countersignDialogId(envelope.id) } : {}),
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
  // Task controls: the tick marks an open task done, Manage opens the Task dialog (the database decides each change).
  const managesTasks = TASK_STAFF_ROLES.includes(staff.role);
  const taskTable: MatterTaskRow[] = taskRows
    .filter((row) => row.status !== "cancelled")
    .map((row) => {
      const owner = row.owner_membership_id ? memberName(row.owner_membership_id) : row.owner_person_id ? personName(row.owner_person_id) : "Unassigned";
      const due = taskDue(row.due_on, today);
      const open = row.status === "open" || row.status === "blocked";
      return {
        done: managesTasks && open ? { "data-task-done": row.id, "data-org": org, "data-version": String(row.version) } : null,
        manage: managesTasks && open ? taskManageWire(row) : null,
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
  const licensedHere = isLicensedMembership(staff.role, ownLicence?.data);
  const deadlinePanels: MatterDeadline[] = upcoming.map((row) => {
    const day = dueDay(row);
    const can = deadlineConfirmable({ kind: row.kind, verification: row.verification, sourceUrl: row.source_url, ruleVersionId: row.rule_version_id }, staff.role, licensedHere);
    return {
      label: row.label,
      due: `${weekdayDayMonth(day)} ${day.slice(0, 4)}${row.due_at ? `, ${clockTime(row.due_at, row.timezone)}` : ""}`,
      verified:
        row.verification === "confirmed"
          ? ({ tone: "ok", label: row.verifying_membership_id ? `Verified by ${memberName(row.verifying_membership_id)}` : "Verified" } as MatterBadge)
          : ({ tone: "chg", label: "Not verified yet" } as MatterBadge),
      source: deadlineSource(row.evidence_locator, row.source_url, row.source_retrieved_on ? dayMonthYear(row.source_retrieved_on, today) : null),
      origin: `${row.rule_version_id ? "Derived from a program rule." : "Not derived from a rule."}${row.calculation_note ? ` ${row.calculation_note}` : ""}`,
      reminders: (reminders?.data ?? [])
        .filter((reminder) => reminder.deadline_id === row.id && reminder.status !== "cancelled")
        .slice(0, 8)
        .map((reminder) => ({
          label: reminder.offset_days ? `${reminder.offset_days} ${reminder.offset_days === 1 ? "day" : "days"} before` : "Now (due soon)",
          date: dayMonthYear(isoDateInTimeZone(new Date(reminder.scheduled_for), row.timezone), today),
          badge: reminderBadge(reminder.status),
        })),
      timezone: `Official: ${row.due_at ? clockTime(row.due_at, row.timezone) : "end of day"} (${row.timezone})`,
      confirm: can.ok ? { "data-deadline-confirm": row.id, "data-org": org, "data-version": String(row.version) } : null,
      confirmWhy: can.ok ? null : can.why,
    };
  });

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

  // The Designer's "Pinned note": the matter's latest staff-only note (matter_staff_notes, never
  // shown in the portal and never mixed with messages). RLS returns nothing to anyone else.
  const pinned = await supabase
    .from("matter_staff_notes")
    .select("body, author_membership_id")
    .eq("organization_id", staff.organizationId)
    .eq("matter_id", matterId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pinned.data) rbar.note = { text: pinned.data.body, parts: ["Staff only", firstName(memberName(pinned.data.author_membership_id))] };

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
  // Messages tab: the chat view (owner's request, 2026-10-18). A failed read shows its error state.
  const messages = tab === "messages" ? await loadMatterMessages(staff, matterId, query.thread ?? null).catch(() => null) : undefined;
  // "Draft with Vo" in the composer; a failed read just leaves Vo out.
  if (messages) messages.vo = await loadVoComposer(staff, matterId).catch(() => undefined);
  // Every change is still checked by the database (role, version, step-up); this only says which matter.
  const wire = { organizationId: org, matterId: matter.id, version: matter.version };
  // public.record_deadline accepts these roles; anyone else is not offered the dialog.
  const recordsDeadlines = (DEADLINE_ROLES as readonly string[]).includes(staff.role);
  // public.create_document_request accepts these roles; anyone else keeps the Designer's link to the Documents tab.
  const requestsDocuments = mayRequestDocuments(staff.role);
  const header: MatterHeaderData = {
    client,
    pills: headerPills(matter.updated_at, matter.created_at, staff.timezone, now),
    hold,
    tab,
    wire,
    deadline: recordsDeadlines,
    request: requestsDocuments,
    // The client crumb opens the applicant's record on the Clients page.
    crumbs: { client: applicantRow?.person_id ? `/sheet/clients${personHref(applicantRow.person_id)}` : null },
    addTask: managesTasks && matter.stage !== "closed",
  };

  const inviteDialog: MatterInviteData = {
    matter: { client: clientName, reference: matter.reference },
    email: "",
    mail: inviteEmailLines(staff.organizationName, "portal"),
    preview: acceptPath("client"),
    // A real matter while the firm is still in sample mode: the database refuses real client invitations.
    locked: staff.sampleMode && !matter.is_sample,
    wire: { organizationId: org, matterId: matter.id },
    // public.create_portal_invitation needs a date of birth; the dialog asks for it when one is missing.
    birthDate: cards.some((card) => card.invite?.birthDateMissing) ? { max: todayIso() } : null,
    // public.accept_portal_invitation needs both published; the dialog says so instead of sending.
    policiesMissing: missingPolicies(await policies),
  };

  // A hold's owner is someone on the firm's staff, never a client. The responsible consultant comes first.
  const holdStaff = (staffRows.data ?? []).map((row) => row.id);
  const responsible = matter.responsible_consultant_membership_id;
  const ownerIds = responsible && holdStaff.includes(responsible) ? [responsible, ...holdStaff.filter((id) => id !== responsible)] : holdStaff;
  const dialogs: MatterDialogsData = {
    current: stage,
    // Only the moves the database allows are offered; the first one forward is picked.
    target: defaultTargetStage(matter.stage),
    allowed: allowedStageIndexes(matter.stage),
    version: matter.version,
    evidence: [],
    reason: "",
    owners: ownerIds.length ? ownerIds.map((id) => ({ id, name: memberName(id) })) : [{ id: staff.membershipId, name: staff.displayName }],
    reviewOn: matter.on_hold_review_on && matter.on_hold_review_on > today ? matter.on_hold_review_on : defaultReview(today),
    minReview: plusDays(today, 1),
    receivedOn: today,
    wire,
    invite: canInvite ? inviteDialog : null,
    edit: cards.some((card) => card.edit) ? { maxBirthDate: todayIso(), invite: canInvite } : null,
    deadline: recordsDeadlines ? { timezone: staff.timezone, sampleMode: staff.sampleMode && !matter.is_sample, kinds: DEADLINE_KINDS, today } : null,
    // Request a document: the people on the matter (the database checks each is a participant).
    request: requestsDocuments
      ? {
          organizationId: org,
          matterId: matter.id,
          people: ordered
            .filter((row, index) => row.person_id && ordered.findIndex((other) => other.person_id === row.person_id) === index)
            .map((row) => ({
              id: row.person_id as string,
              label: docRequestPersonLabel(personName(row.person_id), partyRole(row.role), Boolean(person.get(row.person_id as string)?.user_id)),
            })),
          today,
          sampleMode: staff.sampleMode && !matter.is_sample,
        }
      : null,
  };
  // New task for this matter, and the Task dialog its rows open (Tasks and deadlines tab).
  if (managesTasks && matter.stage !== "closed") {
    const staffOwners = staffOptions(holdStaff.map((id) => ({ id, name: memberName(id) })));
    const clientOwners = clientOptions(
      ordered.flatMap((row) => {
        const found = row.person_id ? person.get(row.person_id) : undefined;
        return found ? [{ matterId: matter.id, personId: found.id, name: found.display_name }] : [];
      }),
    );
    dialogs.newTask = {
      owners: [...staffOwners, ...clientOwners],
      dependsOn: dependsOnOptions(taskRows.filter((row) => row.status !== "cancelled").map((row) => ({ id: row.id, title: row.title, matter_id: matter.id }))),
      wire: {
        organizationId: org,
        timezone: staff.timezone,
        matters: matterOptions([{ id: matter.id, reference: matter.reference, is_sample: matter.is_sample }], () => clientName),
        owner: staff.membershipId,
      },
    };
    dialogs.task = {
      organizationId: org,
      timezone: staff.timezone,
      today,
      owners: staffOwners.flatMap((option) => (option.value ? [{ value: option.value, label: option.label }] : [])),
    };
  }
  // Submissions and Decisions (T036 to T039), read as this member like everything above.
  const government = await loadMatterGovernment(supabase, {
    staff,
    matter,
    members,
    licensed: isLicensedMembership(staff.role, ownLicence?.data),
    today,
    now,
  });
  if (dialogs.deadline) dialogs.deadline.letters = government.letters;
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
      vo: voReading?.panel ?? null,
      filter: true,
    },
    agreements: { rows: agreementTable, signing, create: matter.stage === "closed" ? null : newAgreementHref(matter.id) },
    tasks: { deadlines: deadlinePanels, tasks: taskTable, record: recordsDeadlines, add: managesTasks && matter.stage !== "closed" },
    outcome: matter.outcome ? outcomeLabel(matter.outcome) : null,
    confirmOutcome,
    closure: { closed: matter.stage === "closed", retention: matter.retention_on ? longDate(matter.retention_on) : null },
    messages,
    submissions: government.submissions,
    decisions: government.decisions,
  };
  // The Billing tab: this matter's invoices and client funds, as row-level security shows them.
  if (tab === "billing") page.billing = await loadMatterBilling(supabase, { organizationId: org, matterId: matter.id, today, role: staff.role });
  // The Closure tab's checklist (T040): money, tasks, retention setting and legal hold.
  if (tab === "closure") {
    page.closure.panel = await loadClosurePanel(supabase, {
      organizationId: org,
      matterId: matter.id,
      openTasks: taskRows.filter((row) => row.status === "open" || row.status === "blocked").length,
      consultant: matter.responsible_consultant_membership_id ? (members.get(matter.responsible_consultant_membership_id) ?? null) : null,
      outcome: matter.outcome ? outcomeLabel(matter.outcome) : null,
      closed: matter.stage === "closed",
    });
  }

  // Intake delivery: each person's forms, answers with provenance, review state and flags.
  if (tab === "intake") {
    const intakePeople = ordered
      .filter((row, index) => row.person_id && ordered.findIndex((other) => other.person_id === row.person_id) === index)
      .flatMap((row) => {
        const found = person.get(row.person_id as string);
        return found
          ? [{ id: found.id, name: found.display_name, role: partyRole(row.role), hasLogin: Boolean(found.user_id), dateOfBirth: found.date_of_birth, birthPrecision: found.birth_date_precision }]
          : [];
      });
    page.intake = await loadMatterIntake(supabase, { staff, matter, people: intakePeople, today }).catch(() => null);
  }

  return { chrome, header, rbar, dialogs, page, countersign, governmentDialogs: government.dialogs };
}
