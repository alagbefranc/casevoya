/**
 * #263-A: the firm's public pages (its booking pages and its enquiry page) need its published
 * privacy notice. Pure: what the database said about the firm, turned into the banner staff see on
 * Home and in Settings > Client portal, and the copy for a refused switch. The database decides
 * every switch (set_enquiry_page_enabled, save_booking_event_type, unpublish_privacy_notice) and
 * whether a public booking page is open (app.firm_booking_pages_open).
 */
import { longDate } from "@/modules/sheet/matter-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";

export type PublicPagesState = {
  /** A current (published, not unpublished) privacy notice. */
  noticePublished: boolean;
  /** organizations.enquiry_page_enabled. */
  enquiryOn: boolean;
  /** Live booking types: published, not archived, not practice (sample) pages. */
  liveBookingPages: number;
  /** organizations.privacy_notice_due_at: the end of the warning period, or null for none. */
  dueAt: string | null;
};

export type PublicPagesWarning = {
  tone: "warn" | "bad";
  title: string;
  copy: string;
};

/** Where the warning period ends, as a date in the firm's timezone ("27 Nov 2026"). */
export function dueOn(dueAt: string, timeZone: string): string {
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return longDate(isoDateInTimeZone(date, timeZone));
  } catch {
    return longDate(dueAt.slice(0, 10));
  }
}

/**
 * Null once the notice is published, or when no public page is on. Otherwise what is happening to
 * the firm's pages now, and what happens next: inside the warning period its live booking pages
 * stay open until the date; after it they are closed until a notice is published. The enquiry
 * page has never taken enquiries without a notice (CRM-01), so it only says so.
 */
export function publicPagesWarning(state: PublicPagesState, now: number, timeZone: string): PublicPagesWarning | null {
  if (state.noticePublished) return null;
  const booking = state.liveBookingPages > 0;
  if (!booking && !state.enquiryOn) return null;
  const due = state.dueAt ? Date.parse(state.dueAt) : Number.NaN;
  const pages = state.liveBookingPages === 1 ? "Your booking page is" : "Your booking pages are";
  const enquiry = state.enquiryOn ? " Your enquiry page also needs it: until then it isn’t taking enquiries." : "";
  if (booking && Number.isFinite(due) && due > now) {
    const date = dueOn(state.dueAt as string, timeZone);
    return {
      tone: "warn",
      title: `Publish your privacy notice by ${date}`,
      copy: `${pages} live without a privacy notice. Public booking pages now link to the firm’s notice. From ${date}, they stop taking new bookings until you publish one; nothing is switched off before then, and bookings already made stay.${enquiry}`,
    };
  }
  if (booking) {
    return {
      tone: "bad",
      title: "Your booking pages are closed until you publish a privacy notice",
      copy: `Visitors see that booking isn’t available. Your booking types are still set up and bookings already made stay; publishing a notice reopens the pages straight away.${enquiry}`,
    };
  }
  return {
    tone: "warn",
    title: "Your enquiry page isn’t taking enquiries",
    copy: "It needs your published privacy notice, which the page links to. Until you publish one, visitors see that the form isn’t available.",
  };
}

/** Copy for a switch the database refused because no notice is published (errcode 55000). */
export const NOTICE_REQUIRED = {
  enquiry: "Publish your privacy notice first (Settings > Client portal). The enquiry page links to it.",
  booking: "Publish your privacy notice first (Settings > Client portal). Booking pages link to it. You can save this type unpublished.",
  unpublish: "Turn off your enquiry page and unpublish your booking pages first. They can’t be on without a privacy notice.",
} as const;

export function noticeRequiredError(message: string): keyof typeof NOTICE_REQUIRED | null {
  if (/before you turn on the enquiry page/.test(message)) return "enquiry";
  if (/before you publish a booking page/.test(message)) return "booking";
  if (/before you unpublish the privacy notice/.test(message)) return "unpublish";
  return null;
}
