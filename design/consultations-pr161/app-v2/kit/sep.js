/* Erode's U+00B7 glyph sits off-centre (ink hugs the next word), so render "·" separators as a drawn dot. */
(function(){function fix(root){const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.nodeValue.includes('\u00b7')&&!n.parentNode.closest('script,style,textarea,input')?1:3});const ns=[];while(w.nextNode())ns.push(w.currentNode);
for(const n of ns){const parts=n.nodeValue.split(/\s*\u00b7\s*/);const f=document.createDocumentFragment();parts.forEach((t,i)=>{if(i){const s=document.createElement('span');s.className='sep';s.setAttribute('aria-hidden','true');f.append(' ',s,' ')}f.append(t)});const d=getComputedStyle(n.parentNode).display;if(/flex|grid/.test(d)){const w2=document.createElement('span');w2.append(f);n.replaceWith(w2)}else n.replaceWith(f)}}
let q=0;const run=()=>{q=0;mo.disconnect();fix(document.body);mo.observe(document.body,{childList:true,subtree:true,characterData:true})};
const mo=new MutationObserver(()=>{if(!q)q=requestAnimationFrame(run)});
addEventListener('DOMContentLoaded',run);if(document.readyState!='loading')run();})();
