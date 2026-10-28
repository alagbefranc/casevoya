"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { EnquiryPage, type EnquiryField, type EnquiryPageData } from "@/components/sheet/designer/enquiry";
import { ENQUIRY_HEIGHT_MESSAGE } from "@/modules/leads/share";

/** What the server renders: the page's data without the live wiring. */
export type EnquiryLiveProps = {
  base: Omit<EnquiryPageData, "errors" | "submit" | "live">;
  firmSlug: string;
  firmName: string;
};

type Problems = { title: string; items: { field: EnquiryField; label: string }[] } | null;

const FIELD_OF: Record<string, EnquiryField> = {
  name_required: "n",
  contact_required: "c",
  email_invalid: "c",
  phone_invalid: "c",
  consent_required: "ok",
};

/**
 * CRM-01: where the visitor came from: the utm_* in this page's address (the embed script copies
 * the website page's into the iframe's), and the referrer's host, or for the embed the host of the
 * page it sits on.
 */
export function pageAttribution(embedded: boolean, location: { search: string; hostname: string } = window.location, referrer: string = document.referrer): Record<string, string> {
  const params = new URLSearchParams(location.search);
  const out: Record<string, string> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const value = params.get(key);
    if (value) out[key] = value.slice(0, 200);
  }
  const host = (value: string | null) => {
    try {
      return value ? new URL(value.includes("://") ? value : `https://${value}`).hostname : null;
    } catch {
      return null;
    }
  };
  if (embedded) {
    const site = host(params.get("cv_host")) ?? host(referrer);
    if (site) out.embed_host = site;
    const came = host(params.get("cv_ref"));
    if (came && came !== site) out.referrer_host = came;
  } else {
    const came = host(referrer);
    if (came && came !== location.hostname) out.referrer_host = came;
  }
  return out;
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`;
}

function fix(items: { field: EnquiryField; label: string }[]): Problems {
  return items.length ? { title: items.length === 1 ? "Fix 1 thing" : `Fix ${items.length} things`, items } : null;
}

/** The same checks the server makes first, so the summary can name every problem at once. */
export function enquiryProblems(values: { name: string; contact: string; reply: boolean }): Problems {
  const items: { field: EnquiryField; label: string }[] = [];
  if (!values.name.trim()) items.push({ field: "n", label: "Enter your name" });
  const contact = values.contact.trim();
  if (!contact) items.push({ field: "c", label: "Enter an email or phone number" });
  else if (contact.includes("@") ? !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact) : !/^[0-9+() .-]{3,40}$/.test(contact)) {
    items.push({ field: "c", label: contact.includes("@") ? "Enter a valid email address" : "Enter a valid phone number" });
  }
  if (!values.reply) items.push({ field: "ok", label: "Tick the box so we can reply to you" });
  return fix(items);
}

function Sent({ firmName, practice, onAgain }: { firmName: string; practice: boolean; onAgain: () => void }) {
  return (
    <div className={"card"} role={"status"} aria-live={"polite"}>
      <b style={{ fontWeight: "500" }}>{"Enquiry sent"}</b>
      <p style={{ margin: "0" }}>{`${firmName} will reply using the details you gave.`}</p>
      <small style={{ color: "#615d59" }}>{"Please don’t send passport details or documents until they ask."}</small>
      {practice ? <small style={{ color: "#615d59" }}>{"This was a practice enquiry: it is a sample lead in your pipeline."}</small> : null}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button className={"btn sm"} type={"button"} onClick={onAgain}>
          {"Send another enquiry"}
        </button>
      </div>
    </div>
  );
}

export function EnquiryLive({ base, firmSlug, firmName }: EnquiryLiveProps) {
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Problems>(null);
  const [sent, setSent] = useState(false);
  const opened = useRef(0);
  const key = useRef("");
  const shell = useRef<HTMLDivElement>(null);

  useEffect(() => {
    opened.current = Date.now();
    key.current = newKey();
  }, []);

  // The embedded form tells the page around it how tall it is, so the iframe fits the form. Only
  // a number is sent; the embed script checks the message comes from this app's origin.
  useEffect(() => {
    if (!base.embedded || window.parent === window || !shell.current) return;
    const node = shell.current;
    const post = () => window.parent.postMessage({ type: ENQUIRY_HEIGHT_MESSAGE, firm: firmSlug, height: Math.ceil(node.getBoundingClientRect().height) }, "*");
    post();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(post);
    observer?.observe(node);
    window.addEventListener("load", post);
    return () => {
      observer?.disconnect();
      window.removeEventListener("load", post);
    };
  }, [base.embedded, firmSlug]);

  // When the summary appears, move focus to it (the Designer's error summary pattern).
  useEffect(() => {
    if (problems) shell.current?.querySelector<HTMLElement>("#es")?.focus();
  }, [problems]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const values = { name: text("name"), contact: text("contact"), reply: form.get("reply") === "on" };
    const found = enquiryProblems(values);
    if (found) return setProblems(found);
    setProblems(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/enquiry/${encodeURIComponent(firmSlug)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...values,
          preferred: text("preferred").toLowerCase(),
          service: text("service"),
          country: text("country"),
          language: text("language"),
          marketing: form.get("marketing") === "on",
          source: base.embedded ? "web_form" : "hosted_page",
          key: key.current,
          website: String(form.get("website") ?? ""),
          elapsedMs: Math.max(0, Date.now() - opened.current),
          attribution: pageAttribution(base.embedded === true),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
      if (response.ok && body.ok) {
        setSent(true);
        return;
      }
      const field = body.error ? FIELD_OF[body.error] : undefined;
      const message = (body.message || "Your enquiry couldn’t be sent. Try again.").replace(/\.$/, "");
      setProblems(field ? fix([{ field, label: message }]) : { title: message, items: [] });
    } catch {
      setProblems({ title: "Your enquiry couldn’t be sent. Check your connection and try again", items: [] });
    } finally {
      setBusy(false);
    }
  };

  const data: EnquiryPageData = {
    ...base,
    errors: problems ? { ...problems, shown: true } : { title: "", items: [], shown: false },
    submit: { label: busy ? "Sending…" : "Send enquiry", busy },
    live: {
      onSubmit: submit,
      done: sent ? (
        <Sent
          firmName={firmName}
          practice={Boolean(base.practice)}
          onAgain={() => {
            key.current = newKey();
            opened.current = Date.now();
            setSent(false);
          }}
        />
      ) : null,
    },
  };
  return (
    <div ref={shell}>
      <EnquiryPage data={data} />
    </div>
  );
}
