/**
 * The chat view (portal Messages and the matter's Messages tab), redesigned as a chat page at the
 * owner's request (2026-10-18). Built only from the kit's tokens (src/styles/kit/base.css): the
 * blue, tint, canvas, ink, secondary text, hairline, muted, ok/warn/bad pairs, radii and timings.
 * No new palette. Inter for UI text; Erode is the page heading's font and is not used here.
 */
export const CHAT_CSS = `
.main:has(.cv){padding-bottom:0}
.cv{--cv-h:600px;display:grid;grid-template-columns:320px minmax(0,1fr);height:var(--cv-h);min-height:360px;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:12px}
.cv{grid-template-rows:minmax(0,1fr)}
.cv *{min-width:0}
.cv-list,.cv-pane,.cv-log,.cv-threads{min-height:0}
.cv-list{display:flex;flex-direction:column;border-right:1px solid var(--line);background:#fff}
.cv-lh{display:flex;align-items:center;gap:8px;justify-content:space-between;padding:14px 14px 10px}
.cv-lh h2{font-size:15px;font-weight:600}
.cv-threads{flex:1;overflow:auto;padding:0 8px 8px;overscroll-behavior:contain}
.cv-tr{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;padding:10px;border-radius:10px;color:var(--ink);transition:background var(--fast)}
.cv-tr:hover{background:var(--canvas)}
.cv-tr[aria-current="true"]{background:var(--tint)}
.cv-tr b{display:block;font-weight:500;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cv-tr small{display:block;color:var(--t2);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cv-tr .cv-tm{flex:1}
.cv-tr.un b{font-weight:600}
.cv-meta{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:none}
.cv-meta time{font-size:12.5px;color:var(--t2);font-variant-numeric:tabular-nums}
.cv-badge{min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--blue);color:#fff;font-size:12px;font-weight:600;display:inline-grid;place-items:center}
.cv-av{width:32px;height:32px;flex:none;border-radius:50%;display:grid;place-items:center;background:var(--muted);color:var(--ink);font-size:13.5px;font-weight:600}
.cv-av.st{background:var(--tint);color:var(--tint-t)}
.cv-pane{display:flex;flex-direction:column;background:var(--canvas);position:relative}
.cv-ph{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#fff;border-bottom:1px solid var(--line);min-height:58px}
.cv-ph b{display:block;font-weight:500;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cv-ph small{display:block;color:var(--t2);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cv-ph>div{flex:1}
.cv-back{display:none;width:36px;height:36px;border-radius:9px;place-items:center;color:var(--ink)}
.cv-back:hover{background:var(--muted)}
.cv-log{flex:1;overflow:auto;padding:16px 16px 8px;display:flex;flex-direction:column;gap:6px;overscroll-behavior:contain}
.cv-day{align-self:center;margin:10px 0 4px;font-size:12.5px;font-weight:500;color:var(--t2);background:#fff;border-radius:999px;padding:3px 10px;box-shadow:0 0 0 1px var(--line)}
.cv-new{align-self:stretch;display:flex;align-items:center;gap:10px;color:var(--tint-t);font-size:12.5px;font-weight:600;margin:6px 0}
.cv-new::before,.cv-new::after{content:"";flex:1;height:1px;background:var(--tint-t);opacity:.35}
.cv-row{display:flex;gap:8px;align-items:flex-end;max-width:min(78%,640px)}
.cv-row.me{align-self:flex-end;flex-direction:row-reverse}
.cv-row .cv-av{width:28px;height:28px;font-size:12.5px}
.cv-row.cont .cv-av{visibility:hidden}
.cv-b{background:#fff;border-radius:16px 16px 16px 6px;padding:9px 13px;box-shadow:0 0 0 1px var(--line);font-size:14.5px;line-height:1.45;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere}
.cv-row.me .cv-b{background:var(--blue);color:#fff;box-shadow:none;border-radius:16px 16px 6px 16px}
.cv-who{display:block;font-size:12.5px;font-weight:600;color:var(--t2);margin-bottom:2px}
.cv-foot{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px;font-size:12px;color:var(--t2);font-variant-numeric:tabular-nums}
.cv-row.me .cv-foot{color:#fff}
.cv-crit{display:flex;gap:6px;align-items:center;font-size:12.5px;font-weight:600;color:var(--warn);background:var(--warn-bg);border-radius:8px;padding:4px 8px;margin-bottom:6px;width:fit-content}
.cv-row.me .cv-crit{background:#fff}
.cv-ack{margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cv-acked{display:inline-flex;gap:6px;align-items:center;font-size:12.5px;font-weight:500;color:var(--ok);background:var(--ok-bg);border-radius:999px;padding:2px 9px}
.cv-row.me .cv-acked{background:#fff}
.cv-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.cv-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;height:30px;padding:0 10px;border-radius:8px;background:var(--canvas);color:var(--ink);font-size:13px;font-weight:500;box-shadow:inset 0 0 0 1px var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cv-chip:hover{background:var(--muted)}
.cv-row.me .cv-chip{background:#fff}
.cv-fail{color:var(--bad);font-weight:500}
.cv-row.me .cv-fail{color:#fff;text-decoration:underline}
.cv-retry{font:inherit;font-weight:600;text-decoration:underline;color:inherit}
.cv-sending{opacity:.7}
.cv-jump{position:absolute;left:50%;transform:translateX(-50%);bottom:150px;height:32px;padding:0 14px;border-radius:999px;background:var(--ink);color:#fff;font-size:13px;font-weight:500;box-shadow:0 4px 14px rgba(17,17,17,.18);display:inline-flex;gap:6px;align-items:center}
.cv-compose{background:#fff;border-top:1px solid var(--line);padding:10px 12px calc(10px + env(safe-area-inset-bottom))}
.cv-aud{display:flex;gap:6px;align-items:flex-start;font-size:13px;color:var(--t2);margin:0 2px 8px}
.cv-aud b{font-weight:500;color:var(--ink)}
.cv-pick{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}
.cv-pick label{display:inline-flex;gap:6px;align-items:center;height:32px;padding:0 10px;border-radius:999px;background:var(--canvas);font-size:13.5px;cursor:pointer;box-shadow:inset 0 0 0 1px var(--line)}
.cv-pick label:has(input:checked){background:var(--tint);color:var(--tint-t);box-shadow:inset 0 0 0 1px var(--tint-t)}
.cv-pick input{accent-color:var(--blue)}
.cv-sel{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}
.cv-sel .cv-chip button{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;color:var(--t2)}
.cv-row2{display:flex;gap:8px;align-items:flex-end}
.cv-ta{flex:1;resize:none;min-height:44px;max-height:156px;border-radius:12px;border:1px solid #d6d2cd;background:#fff;padding:11px 12px;font:inherit;font-size:15px;line-height:22px;color:var(--ink);transition:border-color var(--fast),box-shadow var(--fast)}
.cv-ta:hover{border-color:#b9b4ae}
.cv-ta:focus{outline:0;border-color:var(--blue);box-shadow:0 0 0 3px var(--tint)}
.cv-ib{width:44px;height:44px;flex:none;border-radius:12px;display:grid;place-items:center;background:var(--muted);color:var(--ink);transition:background var(--fast)}
.cv-ib:hover{background:#e4e2df}
.cv-send{height:44px;border-radius:12px}
.cv-send[disabled],.cv-ib[disabled]{opacity:.55;cursor:not-allowed}
.cv-opts{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:8px;font-size:13px;color:var(--t2)}
.cv-opts label{display:inline-flex;gap:6px;align-items:center;cursor:pointer}
.cv-opts input{accent-color:var(--blue)}
.cv-err{display:flex;gap:8px;align-items:center;justify-content:space-between;margin:0 0 8px;padding:8px 10px;border-radius:10px;background:var(--bad-bg);color:var(--bad);font-size:13.5px}
.cv-info{background:var(--tint);color:var(--tint-t)}
.cv-err .cv-retry{flex:none}
.cv-empty{flex:1;display:grid;place-items:center;text-align:center;padding:32px 20px}
.cv-empty b{display:block;font-weight:500;font-size:16px;margin-bottom:4px}
.cv-empty small{display:block;color:var(--t2);font-size:14px;max-width:40ch;margin:0 auto 12px}
.cv-none{padding:18px 10px;color:var(--t2);font-size:13.5px}
.cv-docs{display:grid;gap:6px;max-height:50vh;overflow:auto}
.cv-docs label{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:10px;background:var(--canvas);font-size:14px;cursor:pointer}
.cv-docs label:has(input:disabled){opacity:.6;cursor:not-allowed}
.cv-docs small{display:block;color:var(--t2);font-size:12.5px}
.cv-docs input{accent-color:var(--blue)}
.cv-sk{display:grid;gap:12px;padding:16px}
.cv-sk i{display:block;height:44px;border-radius:14px;background:linear-gradient(90deg,var(--muted),#f7f6f5,var(--muted));background-size:200% 100%;animation:cvsk 1.2s linear infinite}
.cv-sk i:nth-child(2n){width:70%;justify-self:end}
@keyframes cvsk{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.cv-sk i{animation:none}}
.cv :is(button,a,textarea,input):focus-visible{outline:2px solid var(--tint-t);outline-offset:2px}
.cv-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:900px){
  .cv{grid-template-columns:1fr;border-radius:14px}
  .cv[data-view="thread"] .cv-list{display:none}
  .cv[data-view="list"] .cv-pane{display:none}
  .cv[data-view="thread"]{position:fixed;left:0;right:0;top:var(--cv-top,0px);height:var(--cv-h);z-index:60;border-radius:0;border:0;margin:0}
  .cv-back{display:grid}
  .cv-row{max-width:88%}
  .cv-jump{bottom:140px}
}
`;
