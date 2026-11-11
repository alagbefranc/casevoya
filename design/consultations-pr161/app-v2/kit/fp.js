// Final-pass helpers (17 Oct 2026): page header, panel, accessible tables, compact linked counts, filter bar, dialogs, fields.
// Used by the Agreements, Finance, Inbox, Reports, Templates, Clients, Tasks, Documents, Vo/AI, Admin and Compliance screens.
const PH=(t,s,art)=>`<div class="ph${art?' v':''}">${art?ART(art,64):''}<div><h1 class="display">${t}</h1>${s?`<p>${s}</p>`:''}</div></div>`;
const SEC=(ic,t,inner,r='',cls='')=>`<section class="panel ${cls}"><h2>${I(ic)}${t}${r?`<span class="r">${r}</span>`:''}</h2>${inner}</section>`;
const PAD=h=>`<div class="fp-pad">${h}</div>`;
const RT=c=>c.startsWith('>');
const TBL=(cap,cols,rows,o={})=>`<div class="tw" role="region" aria-label="${cap}" tabindex="0"><table class="t ${o.cls||''}"><caption class="sr">${cap}</caption><thead><tr>${cols.map(c=>`<th scope="col"${RT(c)?' style="text-align:right"':''}>${RT(c)?c.slice(1):c}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map((r,j)=>`<tr${o.attr?o.attr(r,j):''}>${r.map((v,i)=>`<td${cols[i]&&RT(cols[i])?' class="num" style="text-align:right"':''}${i==0&&o.th?' scope="row"':''}>${v}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${cols.length}">${o.empty||'Nothing here yet.'}</td></tr>`}</tbody></table></div>`;
const KPI=items=>`<div class="fp-kpi">${items.map(([l,v,s,h,k])=>`<a class="fp-k ${k||''}" href="${h||'#'}"><small>${l}</small><b class="num">${v}</b>${s?`<span>${s}</span>`:''}</a>`).join('')}</div>`;
const FBAR=(ph,chips=[],on=0)=>`<div class="bar fp-bar" role="search">${I('search','s')}<input placeholder="${ph}" aria-label="${ph}">${chips.map((f,i)=>`<button class="fchip ${i==on?'on':''}" aria-pressed="${i==on}">${f}</button>`).join('')}</div>`;
const DLG=(id,t,body,foot,cls='')=>`<dialog class="dlg ${cls}" id="${id}" aria-labelledby="${id}H"><div class="dh"><h2 id="${id}H">${t}</h2><button class="x" aria-label="Close" onclick="closeDlg('${id}')">${I('close','s')}</button></div><div class="db">${body}</div><div class="df">${foot}</div></dialog>`;
const FLD=(id,l,inp,hint='')=>`<div class="fld"><label for="${id}">${l}</label>${hint?`<small class="hint" id="${id}-h">${hint}</small>`:''}${inp}</div>`;
const INP=(id,v='',ph='',t='text')=>`<input class="inp" id="${id}" type="${t}" value="${v}" placeholder="${ph}">`;
const SELECT=(id,opts)=>`<select class="sel" id="${id}">${opts.map(o=>`<option>${o}</option>`).join('')}</select>`;
const DL=rows=>`<dl class="fp-dl">${rows.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const NUM=v=>`<span class="num">${v}</span>`;
const CAD=n=>'CAD '+(+n).toLocaleString('en-CA',{minimumFractionDigits:2,maximumFractionDigits:2});
const BTN=(t,{p,sm=1,ic,toast:ts,sub,dlg,href}={})=>href?`<a class="btn ${p?'p':''} ${sm?'sm':''}" href="${href}">${ic?I(ic,'s'):''}${t}</a>`:`<button class="btn ${p?'p':''} ${sm?'sm':''}" ${dlg?`data-dlg="${dlg}"`:''} ${ts?`data-toast="${ts}" data-sub="${sub||''}"`:''}>${ic?I(ic,'s'):''}${t}</button>`;
const STEPS=(items)=>`<ol class="fp-steps">${items.map(([t,s,st])=>`<li class="${st||''}"><span class="d" aria-hidden="true">${st=='done'?I('check-circle','s'):''}</span><div><b>${t}</b>${s?`<small>${s}</small>`:''}</div>${st=='now'?'<span class="sr">current step</span>':''}</li>`).join('')}</ol>`;
function fpBind(root=document){
 // React Bits HoldButton on destructive confirms ([data-confirm-hold]); CountUp on whole-number KPIs; SpotlightCard on KPI tiles (hover devices only)
 root.querySelectorAll('[data-confirm-hold]').forEach(b=>{if(b.dataset.fph||typeof k2Hold!='function')return;b.dataset.fph=1;const fn=b.onclick;b.onclick=null;k2Hold(b,900,()=>fn&&fn.call(b))});
 root.querySelectorAll('.fp-k b.num').forEach(b=>{const t=b.textContent.trim();if(/^\d{1,4}$/.test(t)&&!b.dataset.count){b.dataset.count=t}});if(typeof countUp=='function')countUp(root);
 if(typeof k2Spot=='function')k2Spot('.fp-k');
 root.querySelectorAll('.fp-bar').forEach(b=>{const cs=[...b.querySelectorAll('.fchip')];cs.forEach(c=>c.onclick=()=>{cs.forEach(x=>{x.classList.toggle('on',x==c);x.setAttribute('aria-pressed',x==c)});b.dispatchEvent(new CustomEvent('fpchip',{detail:c.textContent,bubbles:true}))})});
 root.querySelectorAll('[data-toast]').forEach(b=>{if(b.dataset.fpb)return;b.dataset.fpb=1;b.addEventListener('click',e=>{e.preventDefault();toast2(b.dataset.toast,{sub:b.dataset.sub||''})})});
 root.querySelectorAll('[data-dlg]').forEach(b=>{if(b.dataset.fpd)return;b.dataset.fpd=1;b.addEventListener('click',e=>{e.preventDefault();openDlg(b.dataset.dlg,b)})});
 root.querySelectorAll('[data-run]').forEach(b=>{if(b.dataset.fpr)return;b.dataset.fpr=1;b.addEventListener('click',()=>{runBtn(b,b.dataset.run||'ok');const t=b.dataset.done;if(t)setTimeout(()=>toast2(t,{kind:'ok',sub:b.dataset.sub||''}),1150)})});
 if(window.k2Spot)k2Spot('.fp-spot');if(window.k2Reveal)k2Reveal(root)}
const RUN=(t,done,{p=1,sub='',ic=''}={})=>`<button class="btn ${p?'p':''} sm" data-run="ok" data-done="${done}" data-sub="${sub}"><span class="lab">${ic?I(ic,'s')+' ':''}${t}</span><span class="spin" aria-hidden="true"></span></button>`;
addEventListener('load',()=>{try{fpBind(document)}catch(e){}});
/* a11y (final pass): a table wrapper that scrolls sideways must be reachable by keyboard (WCAG 2.1.1) */
function fpScrollFocus(root=document){root.querySelectorAll('.tw:not([tabindex])').forEach(w=>{if(w.scrollWidth>w.clientWidth+1){w.tabIndex=0;w.setAttribute('role','region');const c=w.querySelector('caption');w.setAttribute('aria-label',(c&&c.textContent.trim())||'Table, scroll sideways')}})}
addEventListener('load',()=>{try{fpScrollFocus()}catch(e){}});addEventListener('resize',()=>{try{fpScrollFocus()}catch(e){}});
/* Live filter for an FBAR + the table after it (final pass; used by Tasks). rules: {chipLabel: RegExp tested on row text}; 'All' shows every row. */
function fpLiveFilter(bar,rules={}){if(!bar)return;const tw=bar.parentElement.querySelector('.tw')||bar.nextElementSibling;const rows=[...(tw?tw.querySelectorAll('tbody tr'):[])];if(!rows.length)return;
 const inp=bar.querySelector('input'),chips=[...bar.querySelectorAll('.fchip')];let cur=chips.findIndex(c=>c.classList.contains('on'));
 const live=document.createElement('p');live.className='sr';live.setAttribute('aria-live','polite');bar.after(live);
 const emp=document.createElement('div');emp.className='fp-fe';emp.hidden=true;emp.innerHTML=typeof EMP=='function'?EMP('filter-empty','Nothing matches','Try another filter or clear the search.',`<button class="btn s sm" type="button">Clear filters</button>`):'Nothing matches';tw.after(emp);
 const run=()=>{const q=(inp.value||'').trim().toLowerCase(),lab=chips[cur]?chips[cur].textContent.trim():'All',re=rules[lab];let n=0;
  rows.forEach(r=>{const t=r.textContent,ok=(!q||t.toLowerCase().includes(q))&&(!re||re.test(t));r.hidden=!ok;n+=ok});
  emp.hidden=!!n;tw.hidden=!n;live.textContent=`${n} of ${rows.length} shown${lab!='All'?' · '+lab:''}${q?' · “'+inp.value+'”':''}`};
 chips.forEach((c,i)=>c.addEventListener('click',()=>{chips.forEach((x,j)=>{x.classList.toggle('on',i==j);x.setAttribute('aria-pressed',i==j)});cur=i;run()}));
 inp.addEventListener('input',run);emp.querySelector('button')?.addEventListener('click',()=>{inp.value='';chips[0]?.click()});run()}
