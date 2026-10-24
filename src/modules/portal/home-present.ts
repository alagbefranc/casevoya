import type { PortalDocumentCard } from "@/modules/documents/load";
import type { PortalInvoice } from "@/modules/finance/portal-load";
import { formatMoney } from "@/modules/finance/money";
import type { ChatData } from "@/modules/messages/present";
import type { PortalMatter } from "@/modules/portal/load";
import type { PortalTask } from "@/modules/portal/tasks-load";
import type { ClientRecordView } from "@/modules/government/status-provenance";
import type { PortalRenewalView } from "@/modules/renewals/present";

/** The eight steps of "Where things stand" on the client's Home, in order. */
export const HOME_STEPS = [
  "Agreement",
  "Your information",
  "Documents",
  "Preparation",
  "Your review",
  "Submitted",
  "IRCC processing",
  "Decision",
] as const;

/** Which of the eight steps each matter stage sits on. A closed matter has every step done. */
const STEP_OF_STAGE: Record<string, number> = {
  engagement_pending: 0,
  intake: 1,
  evidence_collection: 2,
  preparation: 3,
  consultant_review: 3,
  client_confirmation: 4,
  ready_to_submit: 4,
  submitted: 5,
  government_processing: 6,
  decision_review: 7,
  post_decision: 7,
  closed: 8,
};

/** "What happens next?" for each stage, in the client's words. */
const NEXT_OF_STAGE: Record<string, string> = {
  engagement_pending: "You sign your agreement",
  intake: "You answer your questions",
  evidence_collection: "You send your documents",
  preparation: "Your consultant prepares the package",
  consultant_review: "Your consultant reviews the package",
  client_confirmation: "You review and confirm the package",
  ready_to_submit: "Your consultant submits the application",
  submitted: "IRCC processes the application",
  government_processing: "Waiting for IRCC",
  decision_review: "Your consultant reviews the decision",
  post_decision: "Your consultant explains what comes next",
  closed: "Nothing more. This file is closed.",
};

export type HomeStep = { label: string; state: "done" | "current" | "todo" };

export type HomeView = {
  firstName: string;
  next: { eyebrow: string; title: string; body: string; href: string; action: string; calm: boolean };
  strip: { todo: string; byWhen: string; who: string; whatNext: string };
  steps: HomeStep[] | null;
  docs: { accepted: { key: string; title: string }[]; pending: { key: string; title: string; label: string; tone: "rev" | "chg" }[] };
  message: { author: string; preview: string; when: string } | null;
  invoice: { title: string; detail: string; amount: string; href: string } | null;
  /** GOV-05: government statuses the firm shared on this matter (src/modules/portal/government-load.ts). */
  government?: ClientRecordView[];
  /** DEC-02: renewal reminders the firm set (src/modules/portal/renewal-load.ts). */
  renewals?: PortalRenewalView[];
};

export type HomeInput = {
  firmName: string;
  personName: string | null;
  timezone: string;
  now: Date;
  matter: PortalMatter | null;
  consultant: string | null;
  tasks: PortalTask[];
  documents: PortalDocumentCard[];
  invoices: PortalInvoice[];
  messages: ChatData | null;
};

/** en-GB writes September "Sept"; the designs use three letters. */
function sep(text: string): string {
  return text.replace("Sept", "Sep");
}

/** "Tue 20 Oct" for a date-only value (no shift across time zones). */
export function shortDay(isoDate: string): string {
  const date = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(date).replace(",", "").replace("Sept", "Sep");
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The time of a message: "08:55" today, otherwise "20 Oct". */
function messageWhen(at: string, now: Date, timeZone: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const day = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  if (day(date) === day(now)) {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(date);
  }
  return sep(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(date));
}

/** The stage's enum value (the viewer carries it with spaces, for display). */
function stageKey(matter: PortalMatter): string {
  return matter.stage.trim().replaceAll(" ", "_");
}

function stepsFor(matter: PortalMatter | null): HomeStep[] | null {
  if (!matter) return null;
  const at = STEP_OF_STAGE[stageKey(matter)] ?? 0;
  return HOME_STEPS.map((label, index) => ({ label, state: index < at ? "done" : index === at ? "current" : "todo" }));
}

function invoiceDue(invoice: PortalInvoice): number {
  return Math.max(0, invoice.amountCents - invoice.paidCents - invoice.creditedCents);
}

/** What the client's Home shows, from their own records. */
export function homeView(input: HomeInput): HomeView {
  const firstName = (input.personName ?? "").trim().split(/\s+/)[0] ?? "";
  // Blocked tasks wait on the firm, so they aren't the client's to do.
  const open = input.tasks.filter((task) => task.status === "open");
  const dated = open.filter((task) => task.dueOn).sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? ""));
  const first = dated[0] ?? open[0] ?? null;
  const needed = input.documents.filter((card) => card.needsYou);
  const unpaid = input.invoices
    .filter((invoice) => invoice.open && !invoice.processing && invoiceDue(invoice) > 0)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const bill = unpaid[0] ?? null;

  let next: HomeView["next"];
  if (first) {
    const due = first.dueOn ? ` · due ${shortDay(first.dueOn)}` : "";
    next = {
      eyebrow: `Your next step${due}`,
      title: first.title,
      body:
        first.status === "blocked" && first.blockerNote
          ? first.blockerNote
          : `${input.firmName} asked you to do this. Open it to see what's needed.`,
      href: first.intakeResponseId ? `/portal/intake?response=${first.intakeResponseId}` : "/portal/tasks",
      action: "Continue",
      calm: false,
    };
  } else if (needed.length) {
    const card = needed[0];
    next = {
      eyebrow: "Your next step",
      title: card.labels.includes("Changes needed") ? `Send a new copy of ${card.title}` : `Upload ${card.title}`,
      body: card.alert ?? `${input.firmName} asked for this document${card.personName ? ` for ${card.personName}` : ""}.`,
      href: "/portal/upload",
      action: "Continue",
      calm: false,
    };
  } else if (bill) {
    next = {
      eyebrow: `Your next step · due ${shortDay(bill.dueOn)}`,
      title: `Pay invoice ${bill.number}`,
      body: `${formatMoney(invoiceDue(bill), bill.currency)} to ${input.firmName}.`,
      href: `/portal/pay?invoice=${bill.id}`,
      action: "Pay",
      calm: false,
    };
  } else {
    next = {
      eyebrow: "Your next step",
      title: "Nothing needs you right now",
      body: `${input.firmName} will let you know when there's something to do.`,
      href: "/portal/messages",
      action: "Open messages",
      calm: true,
    };
  }

  // One kind of thing to do is named ("2 tasks"); a mix is counted ("4 things").
  const kinds = [
    open.length ? plural(open.length, "task", "tasks") : "",
    needed.length ? plural(needed.length, "document", "documents") : "",
    unpaid.length ? plural(unpaid.length, "payment", "payments") : "",
  ].filter(Boolean);
  const total = open.length + needed.length + unpaid.length;
  const todo = kinds.length > 1 ? plural(total, "thing", "things") : kinds[0] ?? "";
  const dueDates = [...dated.map((task) => task.dueOn as string), ...(bill ? [bill.dueOn] : [])].sort();
  const stage = input.matter ? (input.matter.onHold ? "Your file is on hold for now" : NEXT_OF_STAGE[stageKey(input.matter)] ?? "") : "";

  const accepted = input.documents.filter((card) => card.countsAsAccepted).map((card) => ({ key: card.key, title: card.title }));
  const pending = input.documents
    .filter((card) => !card.countsAsAccepted && card.labels.includes("Uploaded"))
    .map((card) => {
      const changes = card.labels.includes("Changes needed") || card.labels.includes("Expired");
      return { key: card.key, title: card.title, label: changes ? (card.labels.includes("Expired") ? "Expired" : "Changes needed") : "Being reviewed", tone: changes ? ("chg" as const) : ("rev" as const) };
    });

  const latest = input.messages?.messages.filter((message) => !message.mine).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const preview = latest ? latest.body.replace(/\s+/g, " ").trim() : "";

  return {
    firstName,
    next,
    strip: {
      todo: todo || "Nothing right now",
      byWhen: dueDates[0] ? shortDay(dueDates[0]) : "No date set",
      who: input.consultant ?? input.firmName,
      whatNext: stage || "Your firm will update this",
    },
    steps: stepsFor(input.matter),
    docs: { accepted, pending },
    message: latest
      ? { author: latest.authorName, preview: preview.length > 140 ? `${preview.slice(0, 139)}…` : preview, when: messageWhen(latest.createdAt, input.now, input.timezone) }
      : null,
    invoice: bill
      ? {
          title: `Invoice ${bill.number} · balance`,
          detail: `Paid to ${input.firmName} · due ${shortDay(bill.dueOn).replace(/^\w+ /, "")}`,
          amount: formatMoney(invoiceDue(bill), bill.currency),
          href: `/portal/pay?invoice=${bill.id}`,
        }
      : null,
  };
}

export type MatterCard = {
  id: string;
  label: string;
  title: string;
  withLine: string;
  steps: HomeStep[] | null;
  badge: { tone: "blue" | "unv" | "chg"; text: string };
  consultant: string | null;
  note: string | null;
  href: string;
  closed: boolean;
};

function longDay(iso: string, timeZone: string): string {
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return "";
  return sep(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: iso.length === 10 ? "UTC" : timeZone }).format(date));
}

function monthYear(isoDate: string): string {
  const date = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  return sep(new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(date));
}

/** "With Jordan Lee (sponsor) and Sam Lee (dependant)", or "Only you". */
function withLine(people: { name: string; role: string; self: boolean }[]): string {
  const others = people.filter((person) => !person.self);
  if (!others.length) return "Only you";
  const named = others.map((person) => `${person.name} (${person.role.replaceAll("_", " ")})`);
  return `With ${named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}` : named[0]}`;
}

/** The My matters cards: one per matter the client is on, open ones first. */
export function matterCards(input: { matters: PortalMatter[]; tasks: PortalTask[]; consultants: Map<string, string | null>; timezone: string }): MatterCard[] {
  const cards = input.matters.map((matter): MatterCard => {
    const closed = stageKey(matter) === "closed";
    const open = input.tasks.filter((task) => task.matterId === matter.id && task.status === "open").length;
    const when = matter.openedAt ? `opened ${longDay(matter.openedAt, input.timezone)}` : "";
    const consultant = input.consultants.get(matter.id) ?? null;
    return {
      id: matter.id,
      label: [matter.reference, closed ? "closed" : when].filter(Boolean).join(" · "),
      title: matter.title,
      withLine: withLine(matter.people ?? []),
      steps: closed ? null : stepsFor(matter),
      badge: closed
        ? { tone: "unv", text: "Closed" }
        : matter.onHold
          ? { tone: "chg", text: "On hold" }
          : open
            ? { tone: "blue", text: `${plural(open, "task", "tasks")} for you` }
            : { tone: "unv", text: "Nothing for you yet" },
      consultant: closed || !consultant ? null : `${consultant}, consultant`,
      note: closed && matter.retentionOn ? `Records kept until ${monthYear(matter.retentionOn)}` : null,
      href: closed ? `/portal/documents?matter=${matter.id}` : `/portal?matter=${matter.id}`,
      closed,
    };
  });
  return [...cards.filter((card) => !card.closed), ...cards.filter((card) => card.closed)];
}
