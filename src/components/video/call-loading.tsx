import "./call.css";

/**
 * DES-04: the call page while it loads (`/call/<ref>` checks who is asking and reads the booking
 * first). The call's own card with the Designer's shimmering `.sk` placeholders, as the portal and
 * the agreement page load, announced to screen readers. Never a blank page.
 */
export function CallLoading() {
  return (
    <main className="cv-call">
      <section className="cv-call-card" role="status" aria-live="polite" aria-busy="true">
        <span className="sr">Opening the call…</span>
        <div className="sk" style={{ height: 22, width: "60%", margin: "0 0 12px" }} />
        <div className="sk" style={{ height: 14, width: "85%" }} />
        <div className="sk" style={{ height: 14, width: "50%", margin: "10px 0 20px" }} />
        <div className="sk" style={{ height: 160, borderRadius: 14 }} />
      </section>
    </main>
  );
}
