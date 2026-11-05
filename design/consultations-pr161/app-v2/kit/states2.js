// Per-screen states (PRD §4 "every core screen requires loading, empty, error, denied, offline and retry states"; DESIGN §11).
// Any Sheet, portal or admin page accepts ?state=loading|empty|filtered|error|offline|denied|success|stale|maintenance (&phase=now for in progress).
// The page renders normally first; the state then replaces (or sits above) its content, so every screen shows its own copy.
const FP_S={ // page: [empty art, what belongs here, one authorised action, noun]
 index:['portal-caught-up','Nothing needs you today','Due tasks, documents to review and unsigned agreements appear here as they come in.','Open all matters','your overview'],
 pipeline:['clients-empty','No leads yet','New enquiries from your form, hosted page or CSV import land in the first column.','Add a lead','leads'],
 matters:['matters-empty','No matters yet','Matters start from a signed service agreement and a program template.','New matter','matters'],
 matter:['matters-empty','This matter has no records yet','Requests, documents and events appear as the team works on the file.','Request a document','this matter'],
 calendar:['calendar-link','No appointments this week','Consultations and verified deadlines show here.','New appointment','the calendar'],
 consultations:['calendar-link','No consultations booked','Clients book from your hosted page. Staff can book for them too.','Book for a client','consultations'],
 queue:['review-queue-empty','The team queue is clear','Work assigned to each person appears here with due dates.','Open tasks','the team queue'],
 tasks:['portal-nothing-due','No open tasks','Client tasks and internal tasks appear here with owners and due dates.','New task','tasks'],
 clients:['clients-empty','No clients yet','People join when you convert a lead or invite someone to a matter.','Invite a client','clients'],
 inbox:['inbox-empty','Inbox zero','Client messages, imported email to triage and bounced notices appear here.','Compose a message','the inbox'],
 documents:['review-queue-empty','No documents waiting','Uploads that need a review across every matter appear here.','Open matters','documents'],
 agreements:['templates-empty','No agreements yet','Quotes and service agreements start from an approved template.','New quote','agreements'],
 finance:['invoice-plain','No invoices yet','Invoices follow delivered work. Advances go to the client account instead.','New invoice','finance'],
 reports:['reports-empty','No data for this period','Reports fill in as matters move. Pending cases never count as outcomes.','Change the period','reports'],
 templates:['templates-empty','No templates yet','Program, message and checklist templates are versioned and reviewed.','New template','templates'],
 ai:['source-review-clear','No AI runs yet','Each Vo run is logged here with its sources and who reviewed it.','Open Vo drafts','AI runs'],
 drafts:['source-review-clear','No drafts to review','Vo drafts appear here and are never sent on their own.','Open matters','Vo drafts'],
 automations:['automations-empty','No automations yet','Automations create tasks and send approved templates. People approve anything that matters.','New automation','automations'],
 'intake-builder':['forms-mapping','No intake forms yet','Forms are versioned; published versions are pinned to matters.','New form','intake forms'],
 invitations:['team-badges','No invitations','Staff and client invitations expire after 7 days and work once.','Invite someone','invitations'],
 licence:['licence-card','No licences recorded','Add each consultant’s licence before they sign agreements or release submissions.','Add a licence','licences'],
 roles:['team-badges','No custom roles','The ten default roles cover most firms.','Open settings','roles'],
 grants:['privacy-shield','No access grants','Grants give a named person time-limited access to one matter or record set.','New grant','access grants'],
 settings:['integrations-plug','Nothing to set up here','Connections, notifications, AI and security settings live in these tabs.','Open integrations','settings'],
 government:['p3-letter','No government records yet','Statuses are recorded by the firm with evidence. Nothing syncs automatically.','Record a status','government status'],
 notifications:['portal-caught-up','You’re all caught up','Mentions, uploads and due dates appear here.','Notification settings','notifications'],
 complaints:['complaints-empty','No complaints recorded','Complaints about professional service are logged here, apart from software support.','Record a complaint','complaints'],
 privacy:['privacy-shield','No privacy requests','Access and correction requests are tracked here with their due dates.','Record a request','privacy requests'],
 exports:['migration-box','No exports yet','Client-file exports include the audit trail and need a second sign-in step.','New export','exports'],
 migration:['migration-box','No imports yet','Bring clients and matters from a spreadsheet or another system.','Start an import','imports'],
 admin:['admin-calm','No firms yet','Firms appear here once they sign up for a trial.','Open verification','platform data'],
 portal:['portal-nothing-due','Nothing to do right now','Northline will let you know when they need something from you.','Message Northline','your home'],
 'portal-matters':['matters-empty','No matters yet','Your matters appear once Northline opens your file.','Message Northline','your matters'],
 'portal-tasks':['portal-nothing-due','No tasks for you','Northline adds tasks here when they need something.','Message Northline','your tasks'],
 'portal-documents':['portal-docs-empty','No documents yet','Documents you send and documents Northline shares appear here.','Upload a document','your documents'],
 'portal-messages':['portal-messages-empty','No messages yet','Messages with Northline stay here, in one place.','Write to Northline','messages'],
 'portal-appointments':['calendar-link','No appointments','Book a time with your consultant when you need one.','Book a time','appointments'],
 'portal-agreements':['templates-empty','No agreements yet','Agreements to sign and signed copies appear here.','Message Northline','agreements'],
 'portal-payments':['invoice-plain','Nothing to pay','Invoices and receipts from Northline appear here.','Message Northline','payments'],
 'portal-upload':['portal-docs-empty','No document requests','Northline asks for documents here when they need them.','Message Northline','document requests'],
 'portal-intake':['forms-mapping','No questionnaire yet','Northline sends your questions here when your file opens.','Message Northline','your questionnaire']};
function fpState(){const st=new URLSearchParams(location.search).get('state');if(!st)return;
 const pg=(location.pathname.split('/').pop()||'index.html').replace('.html','')||'index';
 if(['portal-pay'].includes(pg))return; // pages that draw their own ?state= (payment flow)
 if(window.FP_OWN&&window.FP_OWN(st))return; // afternoon batch: a tab can draw its own crafted state (kit/aft.js AX_OWN)
 let root=document.querySelector('#pc')||document.querySelector('#content');
 if(!root){const m=document.querySelector('#main');if(!m)return;root=document.createElement('div');root.id='pc';[...m.children].filter(e=>!e.matches('header.top')).forEach(e=>root.append(e));m.append(root)}
 const c=FP_S[pg]||FP_S[pg.replace(/-.*/,'')]||['filter-empty','Nothing here yet','Records appear here as your team works.','Go back',document.title.split('·')[0].trim().toLowerCase()];
 const portal=!!document.querySelector('#pc'),who=portal?'Northline':'your firm owner, Amara Osei';
 const h1=(root.querySelector('h1')||{}).textContent||document.title.split('·')[0].trim();const head=`<div class="ph"><h1 class="display">${h1}</h1></div>`;
 const B=(t,p,a='')=>`<button class="btn ${p?'p':''} sm" ${a}>${t}</button>`;
 const back=`onclick="location.search=''"`;
 const S={
  loading:()=>{root.setAttribute('aria-busy','true');return `<div class="fp-st" role="status" aria-live="polite"><span class="sr">Loading ${c[4]}…</span><div class="sk h"></div><div class="sk" style="width:60%"></div><div class="fp-kpi" style="margin-top:22px">${'<div class="sk r" style="height:74px;margin:0"></div>'.repeat(4)}</div>${'<div class="sk r"></div>'.repeat(6)}</div>`},
  empty:()=>`${head}<div class="panel">${EMP(c[0],c[1],c[2],B(c[3],1,back))}</div>`,
  filtered:()=>`${head}<div class="bar">${I('search','s')}<input aria-label="Search" value="Hamid R."><span class="fchip on">Owner: Grace Lin</span><span class="fchip on">Overdue</span></div><div class="panel">${EMP('filter-empty','No results match these filters','Nothing in '+c[4]+' matches “Hamid R.”, owner Grace Lin and Overdue.',B('Clear filters',1,back))}</div>`,
  error:()=>`${head}<div class="alert bad" role="alert">${I('alert')}<div><b>We couldn’t load ${c[4]}</b>The server didn’t answer in time (request req_7f3a). Nothing was lost; anything you typed is still here. Try again, or check Service status if it keeps happening.</div><div class="acts"><button class="btn sm p" id="fpRetry"><span class="lab">${I('refresh','s')}Try again</span><span class="spin" aria-hidden="true"></span></button></div></div><div class="panel">${EMP('error-unplugged','This part didn’t load','The rest of Casevoya still works.','')}</div>`,
  offline:()=>{const sy=new URLSearchParams(location.search).get('sync');
   if(sy=='synced')return `<div class="alert ok" role="status">${I('check-circle')}<div><b>You’re back online</b>2 changes made offline were sent at 09:52 and confirmed by the server. Nothing was lost.</div><div class="acts"><button class="btn sm" onclick="this.closest('.alert').remove()">Dismiss</button></div></div>`+root.innerHTML;
   const q=sy=='queued'?`<ul class="fp-q" style="margin:8px 0 0;padding-left:18px;font-size:13.5px"><li>Note on NL-2026-0142 · waiting to send</li><li>Photo of passport page 2 · 2.1 MB · waiting to upload</li></ul>`:'';
   return `<div class="alert warn" role="status">${I('wifi-off')}<div><b>You’re offline${sy=='queued'?' · 2 changes waiting':''}</b>Showing ${c[4]} as of 09:41. Changes you make are kept on this device and sent when you’re back online. Payments, signatures and submissions wait until you reconnect.${q}</div>${sy=='queued'?`<div class="acts"><button class="btn sm" onclick="toast2('Still offline',{sub:'We’ll try again when you reconnect.'})">Try now</button></div>`:''}</div>`+root.innerHTML},
  denied:()=>`${head}<div class="panel">${EMP('privacy-shield','You don’t have permission to see '+c[4],'Your role doesn’t include this. Ask '+who+' if you need access; the request is logged.',B('Ask for access',1,'onclick="toast2(\'Request sent\',{kind:\'ok\',sub:\'Logged in the audit trail.\'})"'))}</div>`,
  success:()=>`<div class="alert ok" role="status">${I('check-circle')}<div><b>Saved</b>The server confirmed your change at 09:42. It’s in the audit trail.</div><div class="acts"><button class="btn sm" onclick="this.closest('.alert').remove()">Dismiss</button></div></div>`+root.innerHTML,
  maintenance:()=>{const now=new URLSearchParams(location.search).get('phase')=='now';return (now?`<div class="alert warn" role="alert">${I('alert')}<div><b>Casevoya is in planned maintenance until 03:00 ET</b>You can read your files. Saving, uploads and sending are paused, and anything queued goes out when we’re back.</div><div class="acts"><a class="btn sm" href="https://casevoya.ca/status">Status</a></div></div>`:`<div class="alert info" role="status">${I('calendar')}<div><b>Planned maintenance on Sunday 25 October, 02:00–03:00 ET</b>Casevoya will be offline for about an hour. Reminders in that window are sent afterwards. Nothing you need to do.</div><div class="acts"><a class="btn sm" href="https://casevoya.ca/status">Details</a></div></div>`)+root.innerHTML},
  stale:()=>`<div class="alert warn" role="status">${I('history')}<div><b>This may be out of date</b>Last verified 12 Oct 2026, 16:05. Recheck before you rely on it.</div><div class="acts"><button class="btn sm">Recheck now</button></div></div>`+root.innerHTML};
 if(!S[st])return;root.innerHTML=S[st]();document.documentElement.dataset.state=st;
 const r=document.querySelector('#fpRetry');if(r)r.onclick=()=>{runBtn(r,'fail',1000);setTimeout(()=>toast2('Still not loading',{kind:'bad',sub:'We’ll keep trying every 30 seconds. Your work is safe.'}),1050)};
 if(st=='success')setTimeout(()=>toast2('Saved',{kind:'ok',sub:'Confirmed by the server'}),300)}
addEventListener('load',()=>setTimeout(fpState,60));

/* PO14: portal pages load the French string table (kit/i18n-fr.js). */
(function(){const pg=(location.pathname.split('/').pop()||'').replace('.html','');if(!pg.startsWith('portal'))return;const s=document.createElement('script');s.src=(document.currentScript&&document.currentScript.src||'../kit/states2.js').replace(/states2\.js.*$/,'i18n-fr.js');document.head.append(s)})();
