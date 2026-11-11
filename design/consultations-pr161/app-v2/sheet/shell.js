// The Sheet: app shell. Dark sidebar with app tiles (Foreplay-style), one floating light sheet, optional right bar, status bar.
window.CV_BASE='../../';
const PAGE=(location.pathname.split('/').pop()||'index.html').replace('.html','')||'index';
const Q=new URLSearchParams(location.search);
function shell(o={}){
 const here=(h)=>{const [f,q]=h.split('?');if(f.replace('.html','')!=PAGE)return false;if(!q)return !Q.get('view')&&!(PAGE=='matter'&&Q.get('m'));const [k,v]=q.split('=');return Q.get(k)==v};
 const A=(h,ic,t,k='')=>`<a href="${h}" class="${here(h)?'on':''}">${ic.startsWith('av:')?AV(ic.slice(3)):I(ic)}<span>${t}</span>${k}</a>`;
 const tiles=[['intake-builder.html','#0075DE','file-check','Intake','I'],['matter.html?tab=documents','#2f6db3','folder','Documents','D'],['calendar.html','#3a3a3a','calendar','Calendar','C'],['matter.html?tab=billing','#484848','invoice','Invoices','B'],['drafts.html','#0a4b93','sparkles','Vo drafts','V']];
 const grp=(ic,t,items)=>`<div class="grp"><button aria-expanded="true">${I(ic)}<span>${t}</span>${I('chevron-down','s ch')}</button><div class="tree">${items}</div></div>`;
 const side=o.admin?ADMIN_SIDE(A,grp):`<aside class="side" id="side" aria-label="Main">
 <div class="brand"><a href="index.html"><img src="../../assets/brand/casevoya-wordmark-white.svg" alt="Casevoya" width="126" height="20"></a><button id="mClose" aria-label="Close menu" style="color:#8b8680">${I('close')}</button></div>
 <div class="tiles">${tiles.map(([h,c,ic,t,k])=>`<a class="tile" href="${h}" style="background:${c}" aria-label="${t}">${I(ic)}<span class="tip">${t}<kbd>${k}</kbd></span></a>`).join('')}</div>
 <nav class="nav">${A('index.html','home','Home')}<a href="#" onclick="palette();return false">${I('search')}<span>Search…</span><span class="k" aria-label="Command K"><svg class="cmdk" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>K</span></a>${A('notifications.html','bell','Notifications','<span class="k">5</span>')}${A('drafts.html','sparkles','Vo drafts','<span class="k b">3</span>')}</nav>
 ${grp('folder','Work',A('matters.html','menu','All matters')+A('matter.html','av:priya','Priya Sharma')+A('matters.html?q=Kofi','av:Kofi Mensah','Kofi Mensah')+A('clients.html','users','Clients')+A('tasks.html','task','Tasks','<span class="k">7</span>')+A('government.html','globe','Government status')+`<a class="add" href="#" onclick="toast2('New matter',{sub:'Starts from a versioned program template (prototype).'});return false">${I('plus','s')}<span>New matter</span></a>`)}
 ${grp('inbox','Records',A('inbox.html','inbox','Inbox','<span class="k">4</span>')+A('documents.html','folder','Documents')+A('agreements.html','signature','Agreements')+A('finance.html','wallet','Finance','<span class="k">2</span>'))}
 ${grp('users','Leads',A('pipeline.html','kanban','Pipeline','<span class="k">10</span>')+A('consultations.html','calendar','Consultations')+A('calendar.html','calendar','Calendar'))}
 ${grp('dashboard','Boards',A('queue.html','users','Team queue')+A('matters.html?view=due','flag','Due this week')+A('matters.html?view=review','eye','Awaiting my review')+`<a class="add" href="#" onclick="toast2('Create board',{sub:'Saves the current filters as a board (prototype).'});return false">${I('plus','s')}<span>Create board</span></a>`)}
 ${grp('settings','Practice',A('reports.html','reports','Reports')+A('templates.html','templates','Templates','<span class="k b" aria-label="2 sources need review">2</span>')+A('ai.html','sparkles','Vo and AI')+A('automations.html','lightning','Automations')+A('intake-builder.html','file','Intake forms')+A('invitations.html','user-plus','People and invitations')+A('licence.html','id-card','Licences')+A('roles.html','shield','Roles and permissions')+A('grants.html','key','Access grants')+A('settings.html','settings','Settings'))}
 ${grp('privacy','Compliance',A('complaints.html','flag','Complaints')+A('privacy.html','privacy','Privacy requests')+A('exports.html','download','Client-file exports')+A('migration.html','import','Migration import')+A('states.html','grid','System states'))}
 <div class="me">${AV('amara')}<div>Amara Osei<small>Licensed consultant</small></div></div></aside>`;
 const crumbs=(o.crumbs||[]).map(([ic,t,dd],i)=>`${i?'<span class="cs" aria-hidden="true">/</span>':''}<button class="crumb">${!ic?'':ic.startsWith('av:')?AV(ic.slice(3)):I(ic,'s')}${t}${dd?I('sort','dd'):''}</button>`).join('');
 const top=`<header class="top">${o.back?`<a class="back" href="${o.back}" aria-label="Back">${I('chevron-left','s')}</a>`:''}${crumbs}${(o.pills||[]).map(p=>`<span class="pill">${p}</span>`).join('')}<span class="acts">${o.actions||''}</span></header>`;
 const tabs=o.tabs?`<div class="tabs" role="tablist">${o.tabs.map(([id,t])=>`<button role="tab" data-t="${id}">${t}</button>`).join('')}<i class="ul"></i></div>`:'';
 document.body.insertAdjacentHTML('afterbegin',`<div class="mhead"><a href="index.html"><img src="../../assets/brand/casevoya-wordmark-white.svg" alt="Casevoya" width="126" height="20"></a><span class="mi"><button onclick="palette()" aria-label="Search">${I('search')}</button><button id="mOpen" aria-label="Open menu">${I('menu')}</button></span></div>
 <div class="frame">${side}<main class="sheet ${o.rbar?'wr':''}"><div class="main" id="main">${top}${tabs}<div id="content"></div></div>${o.rbar?'<aside id="rbar" aria-label="Details"></aside>':''}</main>
 <footer class="statusbar"><span><i class="dot"></i>All changes saved</span><span>Reminder queue healthy · 0 retries</span><span>Times in America/Toronto</span><span aria-label="Command K search"><svg class="cmdk" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>K search</span><span class="demo">Demo data · fictional firm “Northline Immigration”</span></footer></div><div class="scrimd" id="scrimd"></div>`);
 // drawer
 const sd=$('#side'),sc=$('#scrimd');$('#mOpen').onclick=()=>{sd.classList.add('open');sc.classList.add('on')};const shut=()=>{sd.classList.remove('open');sc.classList.remove('on')};$('#mClose').onclick=shut;sc.onclick=shut;
 document.querySelectorAll('.grp>button').forEach(b=>b.onclick=()=>{const g=b.parentNode;g.classList.toggle('shut');b.setAttribute('aria-expanded',!g.classList.contains('shut'))});
 // tabs with sliding underline
 if(o.tabs){const bs=[...document.querySelectorAll('.tabs button')],ul=$('.tabs .ul');
  const set=(id,first)=>{bs.forEach(b=>b.classList.toggle('on',b.dataset.t==id));const b=bs.find(b=>b.dataset.t==id)||bs[0];b.classList.add('on');ul.style.left=b.offsetLeft+'px';ul.style.width=b.offsetWidth+'px';if(!first&&o.onTab){o.onTab(id);const u=new URL(location);u.searchParams.set('tab',id);history.replaceState(null,'',u)}};
  bs.forEach(b=>b.onclick=()=>set(b.dataset.t));window.setTab=id=>set(id,true);
  requestAnimationFrame(()=>set(Q.get('tab')||o.tabs[0][0],true));addEventListener('resize',()=>set(($('.tabs button.on')||bs[0]).dataset.t,true));document.fonts&&document.fonts.ready.then(()=>set(($('.tabs button.on')||bs[0]).dataset.t,true))}
 // reveal: stagger panels in
 requestAnimationFrame(()=>{document.querySelectorAll('#content>*').forEach((e,i)=>{if(!e.classList.contains('rv')){e.classList.add('rv');e.style.setProperty('--i',i)}})});
}
// Platform administration shell (PRD §4, DESIGN §5): same Sheet look, clearly labelled header, no client content by default.
const ADMIN_SIDE=(A,grp)=>`<aside class="side adm" id="side" aria-label="Platform administration">
 <div class="brand"><a href="admin.html" class="admk"><img src="../../assets/brand/vo-mark-white.svg" alt="" width="22" height="22"><span>Casevoya admin</span></a><button id="mClose" aria-label="Close menu" style="color:#8b8680">${I('close')}</button></div>
 <div class="admtag">${I('shield','s')}Platform administration</div>
 <nav class="nav">${A('admin.html','home','Overview')}</nav>
 ${grp('building','Tenants',A('admin.html?tab=firms','building','Firms')+A('admin.html?tab=verification','id-card','Verification','<span class="k">3</span>')+A('admin.html?tab=subscriptions','credit-card','Subscriptions','<span class="k">2</span>')+A('admin.html?tab=usage','dashboard','Usage and quotas'))}
 ${grp('health','Operations',A('admin.html?tab=health','health','Service health')+A('admin.html?tab=grants','key','Support grants')+A('admin.html?tab=releases','templates','Template releases')+A('admin.html?tab=incidents','incident','Incidents')+A('admin.html?tab=privacy','privacy','Privacy requests')+A('admin.html?tab=audit','history','Audit')+A('admin.html?tab=config','toggle','Configuration'))}
 <div class="me">${AV('jordan')}<div>Jordan Reid<small>Platform administrator</small></div></div></aside>`;
// Shared right-bar blocks for matter pages
const MATTER_RBAR=()=>`<h4>Assist</h4>${voCard('Rafael’s photos don’t show dates. Draft request: “Please add a short note with the date and place for each photo.”','request DR-12, checklist v3','done','voAssist')}
<h4>Agreement</h4><div class="card" style="display:flex;gap:10px"><span style="color:#f0a200">${I('download','s')}</span><div>Service agreement v2 · executed<small>2 of 2 signed · 28 Sep · DocuSign (planned)</small></div></div>
<h4>Representation</h4><div class="card" style="display:flex;gap:10px">${I('check-circle','s')}<div>Use of representative form on file<small>Recorded separately from the agreement</small></div></div>
<h4>Pinned note</h4><div class="card">Rafael prefers WhatsApp but we only use the portal for documents.<small>Staff only · Daniel</small></div>`;
