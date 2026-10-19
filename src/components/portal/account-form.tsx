"use client";

import { useState, useTransition } from "react";
import { saveMyContactPreferences } from "@/modules/portal-invitations/actions";
import { setMyWhatsAppNotices } from "@/modules/whatsapp/actions";
import type { PortalPrefs } from "@/modules/portal/load";

export function AccountForm({
  organizationId,
  name,
  email,
  phone,
  prefs,
}: {
  organizationId: string;
  name: string;
  email: string | null;
  phone: string | null;
  prefs: PortalPrefs | null;
}) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const saved: PortalPrefs = prefs ?? { emailNotices: true, smsNotices: false, deadlineReminders: true, locale: "en-CA", whatsapp: false };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const locale = form.querySelector<HTMLButtonElement>('[data-locale][aria-pressed="true"]')?.dataset.locale;
        const on = (id: string) => form.querySelector<HTMLButtonElement>(`#${id}`)?.getAttribute("aria-checked") === "true";
        start(async () => {
          // WhatsApp first: choosing it records consent (and WhatsApp only turns routine email off);
          // the email switch below is saved last, so the client's own choice there wins.
          const whatsapp = on("pref-wa");
          if (whatsapp || saved.whatsapp) {
            const wa = await setMyWhatsAppNotices({ organizationId, channel: whatsapp ? (on("pref-email") ? "both" : "whatsapp") : "email" });
            if ("error" in wa) {
              setMessage(wa.error);
              return;
            }
          }
          const result = await saveMyContactPreferences({
            organizationId,
            emailNotices: on("pref-email"),
            smsNotices: on("pref-sms"),
            deadlineReminders: on("pref-deadlines"),
            locale: locale === "fr-CA" ? "fr-CA" : "en-CA",
          });
          setMessage("error" in result ? (result.error ?? "Those choices could not be saved.") : "Saved");
        });
      }}
    >
      <div className="panel">
        <h2>Profile</h2>
        <div className="pad">
          <div className="kv">
            <span>Name</span><b>{name}</b>
            <span>Email</span><b>{email || "No email on file"}</b>
            <span>Mobile</span><b>{phone || "No mobile on file"}</b>
          </div>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h2>Language</h2>
        <div className="pad">
          <div className="seg" role="group" aria-label="Portal language">
            <button type="button" data-locale="en-CA" aria-pressed={saved.locale !== "fr-CA"} onClick={(event) => pressLocale(event.currentTarget)}>English</button>
            <button type="button" data-locale="fr-CA" aria-pressed={saved.locale === "fr-CA"} onClick={(event) => pressLocale(event.currentTarget)}>Français</button>
          </div>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h2>What your firm may send you</h2>
        <div className="pad">
          <Pref id="pref-email" label="Email notices" detail="Requests, deadlines and invoices." on={saved.emailNotices} />
          <Pref
            id="pref-wa"
            label="WhatsApp notices"
            detail={phone ? `To ${phone}. Only that you have something new in your portal, never details of your file. Turn it off any time.` : "Add a mobile number before choosing WhatsApp."}
            on={saved.whatsapp === true}
          />
          <Pref id="pref-sms" label="Text message reminders" detail={phone ? `To ${phone}. Never document details.` : "Add a phone number before choosing texts."} on={saved.smsNotices} />
          <Pref id="pref-deadlines" label="Deadline reminders" detail="A reminder before something is due." on={saved.deadlineReminders} />
          <button className="btn p" type="submit" disabled={pending} style={{ marginTop: 12 }}>{pending ? "Saving" : "Save choices"}</button>
          {message ? <p className="lbl" role="status" style={{ marginTop: 8 }}>{message}</p> : null}
        </div>
      </div>
    </form>
  );
}

function pressLocale(button: HTMLButtonElement) {
  const group = button.parentElement;
  group?.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
}

function Pref({ id, label, detail, on }: { id: string; label: string; detail: string; on: boolean }) {
  return (
    <div className="li">
      <div><b>{label}</b><small>{detail}</small></div>
      <span className="r">
        <button type="button" className="k2-sw" role="switch" aria-checked={on} id={id}>
          <span className="k2-th" aria-hidden="true" />
          <span className="k2-sr">{label}</span>
        </button>
      </span>
    </div>
  );
}
