"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { saveMyContactPreferences } from "@/modules/portal-invitations/actions";
import { setMyWhatsAppNotices } from "@/modules/whatsapp/actions";
import type { PortalPrefs } from "@/modules/portal/load";

export function AccountForm({
  organizationId,
  name,
  email,
  phone,
  prefs,
  firm = "your firm",
  timezone = null,
}: {
  organizationId: string;
  name: string;
  email: string | null;
  phone: string | null;
  prefs: PortalPrefs | null;
  /** The firm's name, for "What {firm} may send you". */
  firm?: string;
  /** The time zone times are shown in. */
  timezone?: string | null;
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
      <div className="split rv" style={{ "--i": "1", "--n": "2", gap: "22px", alignItems: "start" } as CSSProperties}>
        <div className="panel">
          <h2><Icon name="user" />Profile</h2>
          <div className="pad">
            <div className="kv">
              <span>Name</span><b>{name}</b>
              <span>Email</span><b>{email || "No email on file"}</b>
              <span>Mobile</span><b className="num">{phone || "No mobile on file"}</b>
              {timezone ? <><span>Time zone</span><b>{timezone}</b></> : null}
            </div>
            <p className="lbl" style={{ marginTop: 12 }}>
              Your legal name and date of birth come from your passport. To change them, <a href="/portal/correction" style={{ textDecoration: "underline" }}>request a correction</a>.
            </p>
          </div>
        </div>
        <div className="panel">
          <h2><Icon name="globe" />Language</h2>
          <div className="pad">
            <div className="seg" role="group" aria-label="Portal language">
              <button type="button" data-locale="en-CA" aria-pressed={saved.locale !== "fr-CA"} onClick={(event) => pressLocale(event.currentTarget)}>English</button>
              <button type="button" data-locale="fr-CA" aria-pressed={saved.locale === "fr-CA"} onClick={(event) => pressLocale(event.currentTarget)}>Français</button>
            </div>
            <p className="lbl" style={{ marginTop: 10 }}>Emails and reminders follow this choice once you save. Your documents stay in the language they were written in.</p>
          </div>
        </div>
      </div>
      <div className="panel rv" style={{ "--i": "2", marginTop: 22 } as CSSProperties}>
        <h2><Icon name="bell" />What {firm} may send you</h2>
        <div className="pad">
          <div className="li">
            <div><b>About your application</b><small>Requests, deadlines, signatures and invoices in your portal. Needed to run your file, so they can’t be turned off.</small></div>
            <span className="r"><span className="bd ok"><i />Always on</span></span>
          </div>
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

function Icon({ name }: { name: string }) {
  return (
    <svg className="ic s" aria-hidden="true">
      <use href={`/assets/icons-coreui/sprite.svg#i-${name}`}></use>
    </svg>
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
