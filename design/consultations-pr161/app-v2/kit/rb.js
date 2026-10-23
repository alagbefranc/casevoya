// Vanilla ports of React Bits components (reactbits.dev, MIT + Commons Clause, DavidHDev/react-bits). Defaults from the source, then held to the
// Casevoya motion budget (17 Oct 2026 React Bits pass): every move 300ms or under, reduced motion = no movement, Palette B only.
// This file is the ONE shared source for BlurText and AnimatedList: the Sheet loads it directly, the marketing site loads it from site/kit/reactbits.js.
const RB_RM=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
// Spring-like ease (critically damped, no overshoot) used by CountUp in ui.js and the marketing counters.
const rbSpring=p=>p>=1?1:1-(1+8*p)*Math.exp(-8*p);
// BlurText (shared): per word blur(10px)->blur(5px)->0 and y -12->2->0, the source's two-step keyframes. The whole heading resolves in <=300ms:
// each word runs 200ms and the stagger shares the remaining 100ms. Keeps <br>. Screen readers get the plain heading via aria-label.
function blurText(el,{total=300,word=200,distance=12}={}){if(!el||el.dataset.rbDone)return;el.dataset.rbDone=1;if(RB_RM())return;
 const txt=el.textContent.trim().replace(/\s+/g,' ');el.setAttribute('aria-label',txt);
 el.innerHTML=el.innerHTML.split(/(<br\s*\/?>)/i).map(p=>/^<br/i.test(p)?p:p.replace(/<[^>]+>/g,' ').trim().split(/\s+/).filter(Boolean).map(w=>`<span aria-hidden="true" class="rbw" style="display:inline-block">${w}</span>`).join(' ')).join('');
 const ws=[...el.querySelectorAll('.rbw')];const st=ws.length>1?(total-word)/(ws.length-1):0;
 ws.forEach((s,i)=>s.animate([{filter:'blur(10px)',opacity:0,transform:`translateY(${-distance}px)`},{filter:'blur(5px)',opacity:.5,transform:'translateY(2px)'},{filter:'blur(0)',opacity:1,transform:'none'}],{duration:word,delay:i*st,easing:'cubic-bezier(.23,1,.32,1)',fill:'backwards'}))}
// ClickSpark: 8 sparks, canvas overlay. Duration cut from the source's 500ms to 300ms.
function clickSpark(root,{color='#0075DE',count=8,size=14,radius=30,duration=300}={}){const c=document.createElement('canvas');Object.assign(c.style,{position:'fixed',inset:0,pointerEvents:'none',zIndex:95});document.body.append(c);const x=c.getContext('2d');let sp=[];
 const fit=()=>{c.width=innerWidth*devicePixelRatio;c.height=innerHeight*devicePixelRatio;x.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0)};fit();addEventListener('resize',fit);
 root.addEventListener('click',e=>{if(RB_RM())return;const t=performance.now();for(let i=0;i<count;i++)sp.push({x:e.clientX,y:e.clientY,a:2*Math.PI*i/count,t});if(sp.length==count)requestAnimationFrame(draw)});
 function draw(n){x.clearRect(0,0,innerWidth,innerHeight);sp=sp.filter(s=>{const p=(n-s.t)/Math.min(300,duration);if(p>=1)return false;const e=p*(2-p);const d=e*radius,l=size*(1-e);x.strokeStyle=color;x.lineWidth=2;x.lineCap='round';x.beginPath();x.moveTo(s.x+d*Math.cos(s.a),s.y+d*Math.sin(s.a));x.lineTo(s.x+(d+l)*Math.cos(s.a),s.y+(d+l)*Math.sin(s.a));x.stroke();return true});if(sp.length)requestAnimationFrame(draw);else x.clearRect(0,0,innerWidth,innerHeight)}}
// Magnet, softened for a calm app: fine pointers only, strength never below 8 (source default 2) and the pull is capped at 4px.
function magnet(el,{padding=40,strength=8,max=4}={}){if(!el||RB_RM()||!matchMedia('(hover:hover) and (pointer:fine)').matches)return;strength=Math.max(8,strength);el.style.transition='transform .25s cubic-bezier(.23,1,.32,1)';
 const cl=v=>Math.max(-max,Math.min(max,v));
 addEventListener('pointermove',e=>{const r=el.getBoundingClientRect();const cx=r.left+r.width/2,cy=r.top+r.height/2;const dx=e.clientX-cx,dy=e.clientY-cy;
  if(Math.abs(dx)<r.width/2+padding&&Math.abs(dy)<r.height/2+padding)el.style.transform=`translate(${cl(dx/strength)}px,${cl(dy/strength)}px)`;else el.style.transform=''})}
// SpotlightCard: radial light follows the pointer
function spotlight(el,color='rgba(0,117,222,.10)'){if(!el)return;el.classList.add('rb-spot');el.style.setProperty('--spot',color);el.addEventListener('pointermove',e=>{const r=el.getBoundingClientRect();el.style.setProperty('--mx',e.clientX-r.left+'px');el.style.setProperty('--my',e.clientY-r.top+'px')})}
// AnimatedList (shared; kit2's k2List now calls this). Rows enter with the source's 'pop' preset (12px, scale .8) on its spring curve, 280ms,
// 40ms stagger. With select:true a highlight glides between rows (the source's indicator) and arrow keys, Home/End and Enter work.
const RB_SPRING=CSS.supports&&CSS.supports('transition-timing-function','linear(0, 1)')?'linear(0, 0.0603, 0.2033, 0.3821, 0.5633, 0.7258, 0.8584, 0.9574, 1.0242, 1.0634, 1.0809, 1.0828, 1.0747, 1.0613, 1.046, 1.0313, 1.0186, 1.0085, 1.0012, 0.9965, 0.994, 0.9931, 0.9933, 0.9941, 0.9953, 0.9966, 0.9978, 0.9988, 1)':'cubic-bezier(.34,1.3,.64,1)';
function animatedList(list,{select=true,stagger=40,duration=280,preset='pop'}={}){if(!list||list.dataset.rbList)return;list.dataset.rbList=1;const items=[...list.children];
 const from={pop:'translate3d(0,12px,0) scale(.8)',slide:'translate3d(0,28px,0) scale(.98)',fade:'translate3d(0,4px,0)'}[preset];
 if(!RB_RM()){const io=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;const i=items.indexOf(e.target);e.target.animate([{transform:from,opacity:0},{transform:'none',opacity:1}],{duration,delay:Math.min(i,6)*stagger,easing:RB_SPRING,fill:'backwards'});io.unobserve(e.target)}),{threshold:.1});items.forEach(x=>io.observe(x))}
 if(!select)return;let sel=-1;list.tabIndex=0;list.setAttribute('role',list.getAttribute('role')||'listbox');if(getComputedStyle(list).position=='static')list.style.position='relative';
 const ind=document.createElement('span');ind.className='rb-ind';ind.setAttribute('aria-hidden','true');list.prepend(ind);
 items.forEach((it,i)=>{it.id=it.id||('rbl'+Math.random().toString(36).slice(2,7));it.setAttribute('aria-selected','false');if(!it.getAttribute('role'))it.setAttribute('role','option');it.addEventListener('click',()=>pick(i,false))});
 function pick(i,scroll=true){sel=Math.max(0,Math.min(items.length-1,i));const it=items[sel];items.forEach((x,k)=>x.setAttribute('aria-selected',k==sel));list.setAttribute('aria-activedescendant',it.id);
  ind.style.height=it.offsetHeight+'px';ind.style.transform=`translate3d(0,${it.offsetTop}px,0)`;ind.classList.add('on');if(scroll)it.scrollIntoView({block:'nearest'})}
 list.addEventListener('keydown',e=>{const k={ArrowDown:sel+1,ArrowUp:sel<0?0:sel-1,Home:0,End:items.length-1}[e.key];if(k!=null){e.preventDefault();pick(k)}else if(e.key=='Enter'&&sel>=0){items[sel].querySelector('a,button')?.click()}});
 return {pick}}
// CountUp lives in ui.js (countUp): rbSpring ease, 300ms, respects reduced motion. Dock was removed on 17 Oct: it was never wired to a screen.
