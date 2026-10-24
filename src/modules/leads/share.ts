/**
 * Where a firm's public pages live and how a firm puts its enquiry form on its own website
 * (CRM-01). Pure: the links, the two snippets (script and iframe), the embed script itself and
 * the Sheet's share dialog data. Snippets are built from the app's own origin and the firm's
 * slug (both checked) and every value is escaped for the HTML it is pasted into.
 */

/** The message the embedded form posts to the page around it with its height. */
export const ENQUIRY_HEIGHT_MESSAGE = "casevoya:enquiry:height";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Escapes text for an HTML attribute or text node. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** An https origin (or http on localhost), without a trailing slash; anything else is refused. */
export function safeOrigin(origin: string): string {
  const url = new URL(origin);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("origin must be https");
  return url.origin;
}

export type EnquiryLinks = {
  /** The hosted page: share it, print it as a QR code. */
  page: string;
  /** The embedded form, for an iframe. */
  embed: string;
  /** The script that inserts and sizes the iframe. */
  script: string;
  scriptSnippet: string;
  iframeSnippet: string;
};

export function enquiryLinks(origin: string, slug: string, firmName: string): EnquiryLinks {
  if (!SLUG.test(slug)) throw new Error("invalid firm slug");
  const base = safeOrigin(origin);
  const page = `${base}/enquiry/${slug}`;
  const embed = `${base}/embed/enquiry/${slug}`;
  const script = `${base}/embed/enquiry.js`;
  const title = escapeHtml(`Enquiry form: ${firmName.replace(/\s+/g, " ").trim()}`);
  return {
    page,
    embed,
    script,
    scriptSnippet: `<div data-casevoya-enquiry="${escapeHtml(slug)}" data-title="${title}"></div>\n<script async src="${escapeHtml(script)}"></script>`,
    iframeSnippet: `<iframe src="${escapeHtml(embed)}" title="${title}" style="width:100%;min-height:900px;border:0" loading="lazy"></iframe>`,
  };
}

/**
 * The embed script served at /embed/enquiry.js. Vanilla, no dependencies: it finds every
 * `[data-casevoya-enquiry="<firm>"]`, puts the firm's embedded form in it as an iframe, and
 * resizes that iframe when the form posts its height, only for messages from `origin` whose
 * source is one of its own iframes. Running it twice mounts nothing twice.
 */
export function enquiryEmbedScript(origin: string): string {
  const base = safeOrigin(origin);
  return `/* Casevoya enquiry form embed. ${base}/embed/enquiry.js */
(function () {
  "use strict";
  var ORIGIN = ${JSON.stringify(base)};
  var TYPE = ${JSON.stringify(ENQUIRY_HEIGHT_MESSAGE)};
  var SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
  if (window.__casevoyaEnquiry) { window.__casevoyaEnquiry.mount(); return; }
  var frames = [];
  // Where the visitor came from, for the firm's lead (CRM-01): this page's utm_*, its host, and
  // the host of the page before it. Nothing else about the visitor is sent.
  function attribution() {
    var out = [];
    try {
      var params = new URLSearchParams(window.location.search);
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach(function (key) {
        var value = params.get(key);
        if (value) out.push(key + "=" + encodeURIComponent(value.slice(0, 200)));
      });
      out.push("cv_host=" + encodeURIComponent(window.location.hostname));
      if (document.referrer) out.push("cv_ref=" + encodeURIComponent(new URL(document.referrer).hostname));
    } catch (error) {}
    return out.length ? "?" + out.join("&") : "";
  }
  function mount() {
    var nodes = document.querySelectorAll("[data-casevoya-enquiry]");
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.getAttribute("data-casevoya-mounted") === "1") continue;
      var slug = String(node.getAttribute("data-casevoya-enquiry") || "").toLowerCase();
      if (!SLUG.test(slug)) continue;
      node.setAttribute("data-casevoya-mounted", "1");
      var frame = document.createElement("iframe");
      frame.src = ORIGIN + "/embed/enquiry/" + slug + attribution();
      frame.title = node.getAttribute("data-title") || "Enquiry form";
      frame.setAttribute("loading", "lazy");
      frame.setAttribute("style", "width:100%;min-height:600px;border:0;display:block;background:transparent");
      node.appendChild(frame);
      frames.push(frame);
    }
  }
  window.addEventListener("message", function (event) {
    if (event.origin !== ORIGIN) return;
    var data = event.data;
    if (!data || data.type !== TYPE || typeof data.height !== "number" || !isFinite(data.height)) return;
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === event.source) {
        frames[i].style.minHeight = "0";
        frames[i].style.height = Math.max(200, Math.min(8000, Math.ceil(data.height))) + "px";
      }
    }
  });
  window.__casevoyaEnquiry = { mount: mount };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
`;
}

export type BookingLink = { title: string; url: string; practice: boolean };

export type EnquiryShareData = {
  firmName: string;
  links: EnquiryLinks;
  /** An SVG data URI of the hosted page's QR code. */
  qr: string | null;
  /** Sample mode: the pages are practice pages, open only to the firm's staff. */
  practice: boolean;
  /** No published privacy notice: the form answers "This form isn't available". */
  privacyMissing: boolean;
  bookings: BookingLink[];
  /**
   * CRM-01: the Settings switch for the enquiry page. `owner` may change it (step-up); everyone
   * else sees whether it is on. Absent when it can't be read.
   */
  page?: { enabled: boolean; owner: boolean; organizationId: string } | null;
};

export function bookingLinks(origin: string, slug: string, types: { title: string; slug: string; is_sample: boolean }[]): BookingLink[] {
  if (!SLUG.test(slug)) return [];
  const base = safeOrigin(origin);
  return [...types.filter((type) => !type.is_sample), ...types.filter((type) => type.is_sample)]
    .filter((type) => SLUG.test(type.slug))
    .map((type) => ({ title: type.title, url: `${base}/book/${slug}/${type.slug}`, practice: type.is_sample }));
}
