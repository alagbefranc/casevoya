/**
 * The Sheet's loading screen, shown while a staff page loads (the Suspense fallback of the Sheet
 * routes). It is the favicon, animated: the blue tile breathes with soft rings, the white "vo" mark
 * writes itself in from left to right, and a shine passes over the tile. The background is the
 * shell's dark at once, so moving between pages never flashes a light or empty page; the mark
 * fades in after a beat, so quick loads show only the dark shell. Geometry matches favicon.svg
 * (32-unit tile, mark at 3.52/11.14, 24.95 wide) scaled to 56px.
 */
const CSS = `
.cv-load{position:fixed;inset:0;display:grid;place-items:center;background:#111;z-index:50}
.cv-load .cv-mark{position:relative;width:56px;height:56px;opacity:0;animation:cvLoadIn .2s ease-out .15s forwards}
.cv-load .cv-tile{position:relative;width:56px;height:56px;border-radius:12.25px;background:#0075de;overflow:hidden;box-shadow:0 8px 24px rgba(0,117,222,.35);animation:cvBreathe 1.8s ease-in-out infinite}
.cv-load .cv-tile img{position:absolute;left:6.16px;top:19.5px;width:43.66px;height:18.13px;animation:cvWrite 1.8s cubic-bezier(.6,0,.3,1) infinite}
.cv-load .cv-tile::after{content:"";position:absolute;inset:-20%;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,.35) 50%,transparent 60%);transform:translateX(-100%);animation:cvShine 1.8s ease-in-out infinite}
.cv-load .cv-ring{position:absolute;inset:0;border-radius:14px;border:2px solid #0075de;animation:cvRing 1.8s ease-out infinite}
.cv-load .cv-ring+.cv-ring{animation-delay:.9s}
.cv-load .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@keyframes cvLoadIn{to{opacity:1}}
@keyframes cvBreathe{0%,100%{transform:scale(.94)}50%{transform:scale(1)}}
@keyframes cvWrite{0%{clip-path:inset(0 100% 0 0)}45%,80%{clip-path:inset(0 0 0 0);opacity:1}100%{clip-path:inset(0 0 0 0);opacity:0}}
@keyframes cvShine{0%,40%{transform:translateX(-100%)}75%,100%{transform:translateX(100%)}}
@keyframes cvRing{0%{transform:scale(.9);opacity:.7}100%{transform:scale(1.9);opacity:0}}
@media (prefers-reduced-motion:reduce){.cv-load .cv-mark,.cv-load .cv-tile,.cv-load .cv-tile img,.cv-load .cv-ring{animation:none;opacity:1}.cv-load .cv-ring,.cv-load .cv-tile::after{display:none}}
`;

export function SheetLoader() {
  return (
    <div className="cv-load" role="status" aria-live="polite">
      <style>{CSS}</style>
      <div className="cv-mark">
        <span className="cv-ring" aria-hidden="true" />
        <span className="cv-ring" aria-hidden="true" />
        <div className="cv-tile">
          <img src="/assets/brand/vo-mark-white.svg" alt="" width={44} height={18} />
        </div>
      </div>
      <span className="sr">Loading</span>
    </div>
  );
}
