import { AccountMarkup } from "./markup/portal-account";
import { AgreementsMarkup } from "./markup/portal-agreements";
import { AppointmentsMarkup } from "./markup/portal-appointments";
import { CorrectionMarkup } from "./markup/portal-correction";
import { DocumentsMarkup } from "./markup/portal-documents";
import { FamilyMarkup } from "./markup/portal-family";
import { GuardianMarkup } from "./markup/portal-guardian";
import { IntakeMarkup } from "./markup/portal-intake";
import { MattersMarkup } from "./markup/portal-matters";
import { MessagesMarkup } from "./markup/portal-messages";
import { OlenaMarkup } from "./markup/portal-olena";
import { PayMarkup } from "./markup/portal-pay";
import { PaymentsMarkup } from "./markup/portal-payments";
import { RafaelMarkup } from "./markup/portal-rafael";
import { TasksMarkup } from "./markup/portal-tasks";
import { UploadMarkup } from "./markup/portal-upload";
import { HomeMarkup } from "./markup/portal";

const VIEWS = {
  home: HomeMarkup,
  matters: MattersMarkup,
  tasks: TasksMarkup,
  documents: DocumentsMarkup,
  upload: UploadMarkup,
  intake: IntakeMarkup,
  messages: MessagesMarkup,
  appointments: AppointmentsMarkup,
  agreements: AgreementsMarkup,
  payments: PaymentsMarkup,
  family: FamilyMarkup,
  rafael: RafaelMarkup,
  olena: OlenaMarkup,
  guardian: GuardianMarkup,
  account: AccountMarkup,
  correction: CorrectionMarkup,
} as const;

export const PORTAL_SLUGS = Object.keys(VIEWS).filter((slug) => slug !== "home").concat("pay");

export function DemoPortal({ page, state }: { page: string; state?: string }) {
  if (page === "pay") return <PayMarkup state={state} />;
  const View = VIEWS[page as keyof typeof VIEWS];
  if (!View) return null;
  return <View />;
}
