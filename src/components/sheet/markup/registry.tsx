/** Page name to captured markup. */
import type { ComponentType } from "react";
import { NotFoundMarkup } from "./404";
import { AgreementsMarkup } from "./agreements";
import { AiMarkup } from "./ai";
import { AutomationsMarkup } from "./automations";
import { BookMarkup } from "./book";
import { CalendarMarkup } from "./calendar";
import { ClientsMarkup } from "./clients";
import { ComplaintsMarkup } from "./complaints";
import { ConsultationsMarkup } from "./consultations";
import { DocumentsMarkup } from "./documents";
import { DraftsMarkup } from "./drafts";
import { EnquiryMarkup } from "./enquiry";
import { ExportsMarkup } from "./exports";
import { FinanceMarkup } from "./finance";
import { GovernmentMarkup } from "./government";
import { GrantsMarkup } from "./grants";
import { InboxMarkup } from "./inbox";
import { IndexMarkup } from "./index";
import { IntakeBuilderMarkup } from "./intake-builder";
import { InvitationsMarkup } from "./invitations";
import { LeadMarkup } from "./lead";
import { LicenceMarkup } from "./licence";
import { LicenceSuspendedMarkup } from "./licence-suspended";
import { MatterMarkup } from "./matter";
import { MattersMarkup } from "./matters";
import { MigrationMarkup } from "./migration";
import { NotificationsMarkup } from "./notifications";
import { PipelineMarkup } from "./pipeline";
import { PrivacyMarkup } from "./privacy";
import { QueueMarkup } from "./queue";
import { ReportsMarkup } from "./reports";
import { RolesMarkup } from "./roles";
import { SampleModeMarkup } from "./sample-mode";
import { SettingsMarkup } from "./settings";
import { StatesMarkup } from "./states";
import { TasksMarkup } from "./tasks";
import { TemplatesMarkup } from "./templates";

export const SHEET_MARKUP: Record<string, ComponentType<{ variant?: string }>> = {
  "404": NotFoundMarkup,
  "agreements": AgreementsMarkup,
  "ai": AiMarkup,
  "automations": AutomationsMarkup,
  "book": BookMarkup,
  "calendar": CalendarMarkup,
  "clients": ClientsMarkup,
  "complaints": ComplaintsMarkup,
  "consultations": ConsultationsMarkup,
  "documents": DocumentsMarkup,
  "drafts": DraftsMarkup,
  "enquiry": EnquiryMarkup,
  "exports": ExportsMarkup,
  "finance": FinanceMarkup,
  "government": GovernmentMarkup,
  "grants": GrantsMarkup,
  "inbox": InboxMarkup,
  "index": IndexMarkup,
  "intake-builder": IntakeBuilderMarkup,
  "invitations": InvitationsMarkup,
  "lead": LeadMarkup,
  "licence": LicenceMarkup,
  "licence-suspended": LicenceSuspendedMarkup,
  "matter": MatterMarkup,
  "matters": MattersMarkup,
  "migration": MigrationMarkup,
  "notifications": NotificationsMarkup,
  "pipeline": PipelineMarkup,
  "privacy": PrivacyMarkup,
  "queue": QueueMarkup,
  "reports": ReportsMarkup,
  "roles": RolesMarkup,
  "sample-mode": SampleModeMarkup,
  "settings": SettingsMarkup,
  "states": StatesMarkup,
  "tasks": TasksMarkup,
  "templates": TemplatesMarkup,
};

export const SHEET_PAGES = ["404", "agreements", "ai", "automations", "book", "calendar", "clients", "complaints", "consultations", "documents", "drafts", "enquiry", "exports", "finance", "government", "grants", "inbox", "index", "intake-builder", "invitations", "lead", "licence", "licence-suspended", "matter", "matters", "migration", "notifications", "pipeline", "privacy", "queue", "reports", "roles", "sample-mode", "settings", "states", "tasks", "templates"] as const;
export type SheetPage = (typeof SHEET_PAGES)[number];
