/**
 * The chat view (portal Messages and the matter's Messages tab), redesigned as a chat page at the
 * owner's request (2026-10-18; second pass the same day: one composer card, a Vo menu and draft
 * bar, a roomier thread, the matter's details rail hidden while Messages is open). Built only from
 * the kit's tokens (src/styles/kit/base.css): the blue, tint, canvas, ink, secondary text,
 * hairline, muted, ok/warn/bad pairs, radii and timings. No new palette. Inter for UI text.
 */
export const CHAT_CSS = `
.main:has(.cv){padding-bottom:0}
.sheet.wr:has(.cv){grid-template-columns:minmax(0,1fr)}
.sheet.wr:has(.cv) #rbar{display:none}
.cv{--cv-h:600px;display:grid;grid-template-columns:300px minmax(0,1fr);grid-template-rows:minmax(0,1fr);height:var(--cv-h);min-height:420px;background:#fff;border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-bottom:12px;box-shadow:0 1px 2px rgba(17,17,17,.04)}
.cv *{min-width:0}
.cv-list,.cv-pane,.cv-log,.cv-threads{min-height:0}

/* Conversations */
.cv-list{display:flex;flex-direction:column;border-right:1px solid var(--line);background:#fff}
.cv-lh{display:flex;align-items:center;gap:8px;justify-content:space-between;padding:16px 16px 10px}
.cv-lh h2{font-size:15px;font-weight:600;letter-spacing:-.005em}
.cv-search{display:flex;align-items:center;gap:8px;margin:0 12px 8px;height:36px;padding:0 10px;border-radius:10px;background:var(--canvas);color:var(--t2);box-shadow:inset 0 0 0 1px var(--line)}
.cv-search:focus-within{box-shadow:inset 0 0 0 1px var(--blue),0 0 0 3px var(--tint)}
.cv-search input{flex:1;border:0;background:none;font:inherit;font-size:14px;color:var(--ink);outline:0;height:100%}
.cv-threads{flex:1;overflow:auto;padding:2px 8px 8px;overscroll-behavior:contain}
.cv-tr{position:relative;display:flex;gap:11px;align-items:center;width:100%;text-align:left;padding:10px;border-radius:12px;color:var(--ink);transition:background var(--fast)}
.cv-tr:hover{background:var(--canvas)}
.cv-tr[aria-current="true"]{background:var(--tint)}
.cv-tr[aria-current="true"]::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:3px;background:var(--blue)}
.cv-tm{flex:1;display:grid;gap:2px}
.cv-l1,.cv-l2{display:flex;align-items:center;gap:8px;justify-content:space-between}
.cv-tr b{font-weight:500;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cv-tr small{display:block;color:var(--t2);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cv-tr time{flex:none;font-size:12px;color:var(--t2);font-variant-numeric:tabular-nums}
.cv-tr.un b{font-weight:600}
.cv-tr.un small{color:var(--ink)}
.cv-tr.un time{color:var(--blue);font-weight:600}
.cv-badge{flex:none;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--blue);color:#fff;font-size:12px;font-weight:600;display:inline-grid;place-items:center}
.cv-av{width:36px;height:36px;flex:none;border-radius:50%;display:grid;place-items:center;background:var(--muted);color:var(--ink);font-size:14px;font-weight:600}
.cv-av.st{background:var(--tint);color:var(--tint-t)}

/* Thread */
.cv-pane{display:flex;flex-direction:column;background:var(--canvas);position:relative}
.cv-ph{display:flex;align-items:center;gap:12px;padding:12px 20px;background:#fff;border-bottom:1px solid var(--line);min-height:64px}
.cv-ph b{display:block;font-weight:600;font-size:15.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cv-ph small{display:block;color:var(--t2);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cv-ph>div{flex:1}
.cv-back{display:none;width:36px;height:36px;border-radius:10px;place-items:center;color:var(--ink)}
.cv-back:hover{background:var(--muted)}
.cv-log{flex:1;overflow:auto;padding:20px clamp(16px,4%,40px) 12px;display:flex;flex-direction:column;gap:4px;overscroll-behavior:contain}
.cv-day{align-self:center;margin:14px 0 8px;font-size:12px;font-weight:500;color:var(--t2);background:#fff;border-radius:999px;padding:3px 12px;box-shadow:0 0 0 1px var(--line)}
.cv-new{align-self:stretch;display:flex;align-items:center;gap:10px;color:var(--tint-t);font-size:12px;font-weight:600;margin:8px 0}
.cv-new::before,.cv-new::after{content:"";flex:1;height:1px;background:var(--tint-t);opacity:.35}
.cv-row{display:flex;gap:8px;align-items:flex-end;max-width:min(72%,620px);margin-top:8px}
.cv-row.cont{margin-top:0}
.cv-row.me{align-self:flex-end;flex-direction:row-reverse}
.cv-row .cv-av{width:30px;height:30px;font-size:12.5px}
.cv-row.cont .cv-av{visibility:hidden}
.cv-b{background:#fff;border-radius:18px 18px 18px 6px;padding:10px 14px;box-shadow:0 0 0 1px var(--line),0 1px 2px rgba(17,17,17,.04);font-size:14.5px;line-height:1.5;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere}
.cv-row.me .cv-b{background:var(--blue);color:#fff;box-shadow:0 1px 2px rgba(0,80,170,.18);border-radius:18px 18px 6px 18px}
.cv-who{display:block;font-size:12.5px;font-weight:600;color:var(--t2);margin-bottom:3px}
.cv-foot{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:5px;font-size:11.5px;color:var(--t2);font-variant-numeric:tabular-nums}
.cv-row.me .cv-foot{color:#fff;opacity:.85}
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
.cv-jump{position:absolute;left:50%;transform:translateX(-50%);bottom:170px;height:32px;padding:0 14px;border-radius:999px;background:var(--ink);color:#fff;font-size:13px;font-weight:500;box-shadow:0 4px 14px rgba(17,17,17,.18);display:inline-flex;gap:6px;align-items:center}

/* Composer: one card */
.cv-compose{padding:8px clamp(12px,3%,32px) calc(14px + env(safe-area-inset-bottom));background:var(--canvas)}
.cv-box{background:#fff;border:1px solid #dcd8d3;border-radius:16px;box-shadow:0 1px 3px rgba(17,17,17,.05);transition:border-color var(--fast),box-shadow var(--fast)}
.cv-box:focus-within{border-color:var(--blue);box-shadow:0 0 0 3px var(--tint)}
.cv-box.vo{border-color:var(--tint-t)}
.cv-aud{display:flex;gap:6px;align-items:center;font-size:12.5px;color:var(--t2);margin:0;padding:9px 14px 0}
.cv-aud b{font-weight:500;color:var(--ink)}
.cv-aud .ic{flex:none}
.cv-compose>.cv-aud{padding:0 2px 8px}
.cv-pick{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0;padding:10px 12px 8px;border:0;border-bottom:1px solid var(--line)}
.cv-to{font-size:13px;font-weight:500;color:var(--t2);margin-right:2px}
.cv-pick label{display:inline-flex;gap:6px;align-items:center;height:30px;padding:0 10px;border-radius:999px;background:var(--canvas);font-size:13.5px;cursor:pointer;box-shadow:inset 0 0 0 1px var(--line)}
.cv-pick label:has(input:checked){background:var(--tint);color:var(--tint-t);box-shadow:inset 0 0 0 1px var(--tint-t)}
.cv-pick input{accent-color:var(--blue)}
.cv-role{color:var(--t2);font-size:12.5px}
.cv-vo{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin:8px 10px 0;padding:7px 10px;border-radius:10px;background:var(--tint);color:var(--tint-t);font-size:13px}
.cv-vo-t{display:inline-flex;align-items:center;gap:6px;font-weight:600;flex:1}
.cv-src summary{cursor:pointer;font-weight:500;list-style:none;text-decoration:underline;text-underline-offset:2px}
.cv-src summary::-webkit-details-marker{display:none}
.cv-src ul{list-style:none;display:grid;gap:2px;margin-top:6px;color:var(--ink);font-size:12.5px}
.cv-src li::before{content:"· ";color:var(--t2)}
.cv-vo .cv-retry{flex:none}
.cv-sel{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px 0}
.cv-sel .cv-chip button{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;color:var(--t2)}
.cv-ta{display:block;width:100%;resize:none;min-height:52px;max-height:200px;border:0;background:transparent;padding:10px 14px 4px;font:inherit;font-size:15px;line-height:22px;color:var(--ink);outline:0}
.cv-ta::placeholder{color:#a19c96}
.cv-tools{display:flex;align-items:center;gap:6px;padding:6px 8px 8px 8px}
.cv-ib{width:34px;height:34px;flex:none;border-radius:9px;display:grid;place-items:center;color:var(--t2);transition:background var(--fast),color var(--fast)}
.cv-ib:hover{background:var(--muted);color:var(--ink)}
.cv-tg{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:999px;font-size:13px;font-weight:500;color:var(--t2);cursor:pointer;box-shadow:inset 0 0 0 1px var(--line);transition:background var(--fast),color var(--fast)}
.cv-tg:hover{background:var(--canvas);color:var(--ink)}
.cv-tg input{position:absolute;opacity:0;width:1px;height:1px}
.cv-tg:has(input:checked){background:var(--warn-bg);color:var(--warn);box-shadow:inset 0 0 0 1px var(--warn)}
.cv-tg:has(input:focus-visible){outline:2px solid var(--tint-t);outline-offset:2px}
.cv-menu{position:relative}
.cv-vob{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px 0 11px;border-radius:999px;font-size:13px;font-weight:600;color:var(--tint-t);background:var(--tint);cursor:pointer;list-style:none;user-select:none;transition:filter var(--fast)}
.cv-vob::-webkit-details-marker{display:none}
.cv-vob:hover{filter:brightness(.97)}
.cv-vob[aria-disabled="true"]{opacity:.55;cursor:not-allowed}
.cv-vob.busy{opacity:1}
.cv-vob.busy .ic:first-child{animation:cvspin 1.2s linear infinite}
@keyframes cvspin{to{transform:rotate(360deg)}}
.cv-pop{position:absolute;bottom:calc(100% + 8px);left:0;z-index:5;width:280px;padding:6px;border-radius:14px;background:#fff;box-shadow:0 0 0 1px var(--line),0 12px 32px rgba(17,17,17,.14);display:grid;gap:2px}
.cv-pop button{display:grid;gap:1px;text-align:left;padding:9px 10px;border-radius:10px;color:var(--ink)}
.cv-pop button:hover{background:var(--canvas)}
.cv-pop b{font-size:14px;font-weight:500}
.cv-pop small{font-size:12.5px;color:var(--t2)}
.cv-hint{margin-left:auto;font-size:12px;color:#a19c96;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cv-send{height:36px;border-radius:10px;padding:0 16px;flex:none;margin-left:8px}
.cv-send[disabled],.cv-ib[disabled],.cv-tg:disabled{opacity:.5;cursor:not-allowed}
.cv-err{display:flex;gap:8px;align-items:center;justify-content:space-between;margin:0 0 8px;padding:8px 12px;border-radius:12px;background:var(--bad-bg);color:var(--bad);font-size:13.5px}
.cv-info{background:var(--tint);color:var(--tint-t)}
.cv-err .cv-retry{flex:none}

/* Empty, loading, dialogs */
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
@media (prefers-reduced-motion:reduce){.cv-sk i,.cv-vob.busy .ic:first-child{animation:none}}
.cv :is(button,a,textarea,input,summary):focus-visible{outline:2px solid var(--tint-t);outline-offset:2px}
.cv .cv-ta:focus-visible,.cv .cv-search input:focus-visible{outline:0}
.cv-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:1100px){.cv-hint{display:none}.cv-hint+.cv-send{margin-left:auto}}
@media (max-width:900px){
  .cv{grid-template-columns:1fr;border-radius:16px}
  .cv[data-view="thread"] .cv-list{display:none}
  .cv[data-view="list"] .cv-pane{display:none}
  .cv[data-view="thread"]{position:fixed;left:0;right:0;top:var(--cv-top,0px);height:var(--cv-h);z-index:60;border-radius:0;border:0;margin:0}
  .cv-back{display:grid}
  .cv-ph{padding:10px 12px;min-height:58px}
  .cv-log{padding:16px 12px 8px}
  .cv-row{max-width:86%}
  .cv-compose{padding:6px 8px calc(8px + env(safe-area-inset-bottom))}
  .cv-tg span[aria-hidden]{display:none}
  .cv-tg{width:34px;padding:0;justify-content:center}
  .cv-pop{width:min(280px,calc(100vw - 32px))}
  .cv-jump{bottom:150px}
}
`;
