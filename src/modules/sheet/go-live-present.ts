import { publishedOn } from "@/modules/portal-policies/present";
import { BILLING_TAB, PLAN_DIALOG } from "@/modules/sheet/billing-banner";

/**
 * Go live (20261101100200): a firm is in test mode until its owner switches it to live. These are
 * the words for the Test mode banner on every staff page, the status bar badge and the Go live
 * panel in Settings > Subscription. public.firm_go_live_status() decides what is done; this only
 * words it. Pure.
 */
export type GoLiveKey = "licence" | "subscription" | "policies" | "card_payments";

export type GoLiveStatus = {
  live: boolean;
  liveAt: string | null;
  sampleMode: boolean;
  ready: boolean;
  owner: boolean;
  items: { key: GoLiveKey; done: boolean }[];
};

export type GoLiveItem = { key: GoLiveKey; title: string; note: string; done: boolean; href: string; go: string };

export type GoLivePanelData = {
  live: boolean;
  /** "Live since 30 Oct 2026" or "Test mode". */
  badge: string;
  intro: string;
  items: GoLiveItem[];
  /** "2 of 4 done". */
  progress: string;
  ready: boolean;
  /** Only the firm owner switches, either way. */
  owner: boolean;
  /** What happens to test data, one line each. */
  data: string[];
  /** Under the button: what is left, or what switching does. */
  why: string;
};

export type GoLiveBannerData = { title: string; body: string; link: { href: string; label: string } | null };

export const GO_LIVE_ANCHOR = "go-live";
export const GO_LIVE_HREF = `${BILLING_TAB}#${GO_LIVE_ANCHOR}`;
export const TEST_CONFIRM = "switch to test mode";

const KEYS: readonly GoLiveKey[] = ["licence", "subscription", "policies", "card_payments"];

/** Reads public.firm_go_live_status(); anything unexpected is test mode with nothing done. */
export function readGoLiveStatus(value: unknown): GoLiveStatus | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const list = Array.isArray(raw.items) ? (raw.items as Record<string, unknown>[]) : [];
  const done = new Map(list.filter((item) => item && typeof item.key === "string").map((item) => [item.key as string, item.done === true]));
  const items = KEYS.map((key) => ({ key, done: done.get(key) === true }));
  return {
    live: raw.live === true,
    liveAt: typeof raw.live_at === "string" ? raw.live_at : null,
    sampleMode: raw.sample_mode === true,
    ready: raw.ready === true && items.every((item) => item.done),
    owner: raw.owner === true,
    items,
  };
}

function item(key: GoLiveKey, done: boolean, firm: string): GoLiveItem {
  switch (key) {
    case "licence":
      return {
        key,
        done,
        title: "Your CICC licence",
        note: done ? "On file, and the latest check doesn’t block it." : "Add your licence number from the CICC register, or review a check that blocks it.",
        href: "/sheet/licence",
        go: "Review licence",
      };
    case "subscription":
      return {
        key,
        done,
        title: "A plan with a card on file",
        note: done
          ? "Your trial or plan is billed to the card on file."
          : "Choose a plan and add a card in Stripe Checkout. The 14-day trial still starts at $0 today.",
        href: PLAN_DIALOG,
        go: "Choose a plan",
      };
    case "policies":
      return {
        key,
        done,
        title: "Client portal terms and privacy notice",
        note: done ? "Both are published, so invited clients can join." : `Publish ${firm}’s portal terms of use and privacy notice so invited clients can accept them.`,
        href: "/sheet/settings?tab=portal",
        go: "Publish them",
      };
    case "card_payments":
      return {
        key,
        done,
        title: "Live card payments (Stripe)",
        note: done
          ? "A live Stripe account with card payments on: clients pay real cards into the firm’s account."
          : "Set up the firm’s live Stripe account and finish Stripe’s details. An account connected in test mode doesn’t count: disconnect it first.",
        href: `${BILLING_TAB}#card-payments`,
        go: "Set up Stripe",
      };
  }
}

/** What happens to the firm's test data when it goes live (and back). */
export const GO_LIVE_DATA = [
  "Nothing is deleted or moved. Sample records (the practice tour) stay marked Sample and are left out of counts, limits and reports.",
  "Payments made in Stripe test mode stay in the firm’s history marked test mode. They never count toward live totals, and no real card was charged.",
  "Real matters, clients, documents and invoices you already made stay exactly as they are.",
];

export function goLivePanel(status: GoLiveStatus, input: { firmName: string; timeZone: string }): GoLivePanelData {
  const items = status.items.map((row) => item(row.key, row.done, input.firmName));
  const left = items.filter((row) => !row.done);
  const count = `${items.length - left.length} of ${items.length} done`;
  if (status.live) {
    const since = status.liveAt ? publishedOn(status.liveAt, input.timeZone) : null;
    return {
      live: true,
      badge: since ? `Live since ${since}` : "Live",
      intro: `${input.firmName} is live: real clients, real card payments and the firm’s own records.${left.length ? " Something on the list below needs attention again; it doesn’t switch the firm back." : ""}`,
      items,
      progress: count,
      ready: status.ready,
      owner: status.owner,
      data: GO_LIVE_DATA,
      why: status.owner
        ? "Switching back to test mode only puts the Test mode badge back. Clients, records and payments stay as they are. You’ll confirm it’s you."
        : "Only the firm owner can switch the firm back to test mode.",
    };
  }
  return {
    live: false,
    badge: "Test mode",
    intro: `${input.firmName} is in test mode until its owner switches it to live. Finish each step below; each one links to the page that does it.`,
    items,
    progress: count,
    ready: status.ready,
    owner: status.owner,
    data: GO_LIVE_DATA,
    why: !status.owner
      ? status.ready
        ? "Ready: only the firm owner can switch the firm to live."
        : `Only the firm owner can switch the firm to live. Still to do: ${left.map((row) => row.title.toLowerCase()).join("; ")}.`
      : status.ready
        ? `Everything is done. Switching checks each step again, turns sample mode off${status.sampleMode ? "" : " (already off)"} and is recorded in the audit log. You’ll confirm it’s you.`
        : `Still to do: ${left.map((row) => row.title.toLowerCase()).join("; ")}.`,
  };
}

/** The banner on every staff page while the firm is in test mode; null once it is live. */
export function goLiveBanner(status: GoLiveStatus | null, input: { firmName: string; canManage: boolean }): GoLiveBannerData | null {
  if (!status || status.live) return null;
  const done = status.items.filter((row) => row.done).length;
  const steps = `${done} of ${status.items.length} go-live steps done`;
  return {
    title: `Test mode: ${input.firmName} isn’t live yet`,
    body: status.ready
      ? `${steps}. ${status.owner ? "Switch to live when you’re ready." : "Your firm owner can switch the firm to live."}`
      : `${steps}. ${input.canManage ? "See what’s left and switch to live in Settings › Subscription." : "Your firm owner switches the firm to live in Settings › Subscription."}`,
    link: input.canManage ? { href: GO_LIVE_HREF, label: status.ready && status.owner ? "Go live" : "See what’s left" } : null,
  };
}

/** What a refused switch says, from the action's answer or the database's error. */
export function goLiveRefusal(input: { missing?: string[]; message?: string }): { error: string; stepUp: boolean } {
  if (input.message && /step-up/i.test(input.message)) return { error: "Confirm it’s you with your authenticator, then try again.", stepUp: true };
  if (input.missing?.length) {
    const words = input.missing.map((key) => (KEYS.includes(key as GoLiveKey) ? item(key as GoLiveKey, false, "the firm").title.toLowerCase() : key));
    return { error: `Still to do: ${words.join("; ")}.`, stepUp: false };
  }
  if (input.message && /confirm switching back/i.test(input.message)) return { error: "Tick the box to confirm switching back to test mode.", stepUp: false };
  return { error: "The firm couldn’t be switched. Try again.", stepUp: false };
}
