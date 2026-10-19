/**
 * The Sheet's loading screen, shown while a staff page loads (the Suspense fallback of the Sheet
 * routes). The brand tile breathes with a soft ring on the shell's dark background, so moving
 * between pages never flashes an empty page. It fades in after a beat, so quick loads show nothing.
 */
const CSS = `
.cv-load{position:fixed;inset:0;display:grid;place-items:center;background:#111;z-index:50;opacity:0;animation:cvLoadIn .2s ease-out .15s forwards}
.cv-load .cv-mark{position:relative;width:56px;height:56px}
.cv-load img{position:relative;width:56px;height:56px;border-radius:13px;display:block;animation:cvBreathe 1.4s ease-in-out infinite;box-shadow:0 8px 24px rgba(0,117,222,.35)}
.cv-load .cv-ring{position:absolute;inset:0;border-radius:15px;border:2px solid #0075de;animation:cvRing 1.4s ease-out infinite}
.cv-load .cv-ring+.cv-ring{animation-delay:.7s}
.cv-load .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@keyframes cvLoadIn{to{opacity:1}}
@keyframes cvBreathe{0%,100%{transform:scale(.92)}50%{transform:scale(1)}}
@keyframes cvRing{0%{transform:scale(.9);opacity:.7}100%{transform:scale(1.9);opacity:0}}
@media (prefers-reduced-motion:reduce){.cv-load,.cv-load img,.cv-load .cv-ring{animation:none;opacity:1}.cv-load .cv-ring{display:none}}
`;

export function SheetLoader() {
  return (
    <div className="cv-load" role="status" aria-live="polite">
      <style>{CSS}</style>
      <div className="cv-mark">
        <span className="cv-ring" aria-hidden="true" />
        <span className="cv-ring" aria-hidden="true" />
        <img src="/assets/brand/favicon.svg" alt="" width={56} height={56} />
      </div>
      <span className="sr">Loading</span>
    </div>
  );
}
