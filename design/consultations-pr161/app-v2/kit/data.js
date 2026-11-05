// All data fictional: demo firm "Northline Immigration" (sample only).
const A=(window.CV_BASE||'../')+'assets/';
window.CV={
 av:{amara:A+'av-amara-consultant.png',daniel:A+'av-daniel-casemanager.png',lena:A+'av-lena-finance.png',olena:A+'av-olena-dependant.png',priya:A+'av-priya-applicant.png',rafael:A+'av-rafael-sponsor.png',grace:A+'av-grace-consultant.png','Grace Lin':A+'av-grace-consultant.png',kofi:A+'av-kofi-client.png','Kofi Mensah':A+'av-kofi-client.png',tomas:A+'av-tomas-client.png','Tomás Duarte':A+'av-tomas-client.png',ana:A+'av-ana-client.png','Ana Ferreira':A+'av-ana-client.png',graceo:A+'av-graceo-client.png','Grace Okafor':A+'av-graceo-client.png',sofia:A+'av-sofia-client.png','Sofia Reyes':A+'av-sofia-client.png',jordan:A+'av-jordan-admin.png','Jordan Reid':A+'av-jordan-admin.png'},
 me:{name:'Amara',full:'Amara Osei',role:'Licensed consultant'},
 stages:['New','Contacted','Consultation scheduled','Consultation completed','Qualified','Proposal sent','Converted','Lost'],
 leads:[
  {id:'L1',n:'Wei & Lin Zhang',src:'Website form',prog:'Study permit',c:'#0075DE',v:2400,st:0,who:'daniel',chip:['dt','Today']},
  {id:'L2',n:'Kofi Mensah',src:'Referral',prog:'Express Entry',c:'#111',v:3800,st:0,who:'amara'},
  {id:'L3',n:'Sofia Reyes',src:'Hosted page',prog:'Spousal sponsorship',c:'#62aef0',v:4200,st:1,who:'amara',chip:['od','3d'],ai:'Send consultation booking link'},
  {id:'L4',n:'Hamid Rahimi',src:'Phone',prog:'Work permit',c:'#0075DE',v:2900,st:1,who:'daniel',dup:true},
  {id:'L5',n:'Ana Ferreira',src:'Website form',prog:'Visitor record',c:'#8c8781',v:900,st:2,who:'amara',chip:['dt','Thu 10:30']},
  {id:'L6',n:'Tomás Duarte',src:'Referral',prog:'PR — family',c:'#62aef0',v:5200,st:3,who:'amara',ai:'Draft a proposal from consultation notes'},
  {id:'L7',n:'Grace Okafor',src:'Event',prog:'Study permit',c:'#0075DE',v:2400,st:4,who:'daniel',chip:['od','1d']},
  {id:'L8',n:'Yusuf Demir',src:'Website form',prog:'Express Entry',c:'#111',v:3600,st:4,who:'amara'},
  {id:'L9',n:'Mei Tanaka',src:'Referral',prog:'Work permit',c:'#0075DE',v:3100,st:5,who:'amara',ai:'Follow up on proposal sent 6 days ago'},
  {id:'L10',n:'Priya Sharma',src:'Referral',prog:'Spousal sponsorship',c:'#62aef0',v:4600,st:6,who:'amara',img:'priya'},
 ],
 matter:{client:'Priya Sharma',ref:'NL-2026-0142',prog:'Spousal sponsorship · outland',consultant:'amara',stage:'Evidence collection',gov:'Not submitted',money:'Advance held CAD 1,500',deadline:'Fri 30 Oct, 17:00 ET'},
 docs:[
  {n:'Passport — bio page',cat:'Identity',who:'priya',up:['gr','Uploaded · scanned'],rev:['ok','Accepted by firm'],v:'v1'},
  {n:'Marriage certificate',cat:'Relationship',who:'priya',up:['gr','Uploaded · scanned'],rev:['rev','Awaiting review'],v:'v2',act:1},
  {n:'Proof of relationship — photos',cat:'Relationship',who:'rafael',up:['gr','Uploaded · scanned'],rev:['chg','Changes requested'],v:'v1'},
  {n:'Sponsor proof of income (T4)',cat:'Sponsor income',who:'rafael',up:['unv','Not uploaded'],rev:['gr','Requested'],v:'—'},
  {n:'Police certificate (India)',cat:'Admissibility',who:'priya',up:['unv','Not uploaded'],rev:['gr','Requested'],v:'—'},
  {n:'Olena — birth certificate',cat:'Dependent',who:'olena',up:['gr','Uploaded · scanned'],rev:['bad','Expired'],v:'v2'}
 ],
 people:[['priya','Priya Sharma','Applicant'],['rafael','Rafael Sharma','Sponsor'],['olena','Olena Sharma','Dependent · locked']],
 staff:{amara:'Amara Osei',daniel:'Daniel Ruiz',lena:'Lena Park'}
};
