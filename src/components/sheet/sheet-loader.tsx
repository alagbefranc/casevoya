/**
 * The Sheet's first-load screen: a skeleton of the app shell, shown by the /sheet layout's
 * Suspense while a page loads from scratch (sign-in, refresh, a typed or emailed link). It has the
 * real frame's geometry (264px dark sidebar, the light rounded content panel, the 28px status
 * strip), so the page lands in place with no jump. The sidebar's logo is the favicon, animated
 * (the white "vo" writes itself in), and the grey placeholders shimmer. Client navigations between
 * Sheet pages never show it; they keep the current page and run the top progress bar instead.
 */
const CSS = `
.cv-sk{position:fixed;inset:0;z-index:50;background:#111;display:grid;grid-template-columns:264px 1fr;grid-template-rows:1fr 28px;padding:10px 10px 0 0}
.cv-sk-side{grid-row:1/3;padding:20px 18px;display:flex;flex-direction:column;gap:14px;overflow:hidden}
.cv-sk-brand{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.cv-sk-tile{position:relative;width:28px;height:28px;border-radius:6.1px;background:#0075de;overflow:hidden;flex:none}
.cv-sk-tile img{position:absolute;left:3.08px;top:9.75px;width:21.83px;height:9.07px;animation:cvWrite 1.8s cubic-bezier(.6,0,.3,1) infinite}
.cv-sk-tiles{display:flex;gap:8px;margin-bottom:8px}
.cv-sk-tiles i{width:39px;height:39px;border-radius:10px;background:rgba(255,255,255,.09)}
.cv-sk-side b{display:block;height:12px;border-radius:6px;background:rgba(255,255,255,.09)}
.cv-sk-side b.h{height:14px;background:rgba(255,255,255,.13);margin-top:10px}
.cv-sk-panel{background:#fff;border-radius:14px;padding:26px 32px;overflow:hidden;display:flex;flex-direction:column;gap:16px;min-width:0}
.cv-sk-panel b{display:block;border-radius:8px;background:linear-gradient(90deg,#efedeb 25%,#f7f6f5 50%,#efedeb 75%);background-size:300% 100%;animation:cvShimmer 1.4s ease-in-out infinite}
.cv-sk-row{display:flex;gap:12px;align-items:center}
.cv-sk-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:8px 0}
.cv-sk-cards b{height:118px;border-radius:12px}
.cv-sk-list{display:flex;flex-direction:column;gap:12px;margin-top:6px}
.cv-sk-list b{height:44px;border-radius:10px}
.cv-sk .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@keyframes cvShimmer{0%{background-position:100% 0}100%{background-position:0 0}}
@keyframes cvWrite{0%{clip-path:inset(0 100% 0 0)}45%,80%{clip-path:inset(0 0 0 0);opacity:1}100%{clip-path:inset(0 0 0 0);opacity:0}}
@media (max-width:900px){
 .cv-sk{display:flex;flex-direction:column;padding:0}
 .cv-sk-side{flex-direction:row;align-items:center;padding:14px 16px;gap:0}
 .cv-sk-side>:not(.cv-sk-brand){display:none}
 .cv-sk-brand{margin:0}
 .cv-sk-panel{flex:1;border-radius:14px 14px 0 0;padding:22px 16px}
 .cv-sk-cards{grid-template-columns:minmax(0,1fr)}
 .cv-sk-cards b:nth-child(n+2){display:none}
}
@media (prefers-reduced-motion:reduce){.cv-sk-panel b,.cv-sk-tile img{animation:none}}
`;

const W = (width: string, height = 12) => ({ width, height: `${height}px` });
const SIDE: [string, boolean?][] = [["62%"], ["54%"], ["58%"], ["40%", true], ["64%"], ["50%"], ["56%"], ["44%", true], ["52%"], ["66%"], ["48%"], ["38%", true], ["58%"], ["50%"]];

export function SheetLoader() {
  return (
    <div className="cv-sk" role="status" aria-live="polite">
      <style>{CSS}</style>
      <aside className="cv-sk-side" aria-hidden="true">
        <div className="cv-sk-brand">
          <span className="cv-sk-tile">
            <img src="/assets/brand/vo-mark-white.svg" alt="" width={22} height={9} />
          </span>
          <b style={W("96px", 14)} />
        </div>
        <div className="cv-sk-tiles">
          {[0, 1, 2, 3, 4].map((tile) => (
            <i key={tile} />
          ))}
        </div>
        {SIDE.map(([width, heading], index) => (
          <b key={index} className={heading ? "h" : undefined} style={W(width, heading ? 14 : 12)} />
        ))}
      </aside>
      <div className="cv-sk-panel" aria-hidden="true">
        <div className="cv-sk-row">
          <b style={W("150px", 30)} />
          <b style={W("110px", 30)} />
          <span style={{ flex: 1 }} />
          <b style={W("86px", 34)} />
        </div>
        <b style={W("min(340px,70%)", 40)} />
        <b style={W("min(520px,90%)", 14)} />
        <b style={W("min(420px,75%)", 14)} />
        <div className="cv-sk-cards">
          {[0, 1, 2].map((card) => (
            <b key={card} />
          ))}
        </div>
        <div className="cv-sk-list">
          {[0, 1, 2, 3, 4].map((row) => (
            <b key={row} />
          ))}
        </div>
      </div>
      <span className="sr">Loading</span>
    </div>
  );
}
