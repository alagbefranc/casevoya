// Casevoya assistant mascots — hand-built vector, palette B. States: idle | thinking | done | review
const MASCOT_NAMES={vo:'Vo',wren:'Wren',pip:'Pip'};
function mascot(kind='vo',state='idle',size=48){
 const eyes=(cx1,cx2,cy,r=3.4)=>`<g class="m-eyes" style="transform-origin:50px ${cy}px"><ellipse cx="${cx1}" cy="${cy}" rx="${r}" ry="${r*1.15}" fill="#111"/><ellipse cx="${cx2}" cy="${cy}" rx="${r}" ry="${r*1.15}" fill="#111"/><circle cx="${cx1+1.1}" cy="${cy-1.3}" r="1" fill="#fff"/><circle cx="${cx2+1.1}" cy="${cy-1.3}" r="1" fill="#fff"/></g>`;
 const badge=state=='done'?`<g class="m-badge"><circle cx="80" cy="22" r="11" fill="#205c38"/><path d="M75 22.5l3.4 3.4 6.4-7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g>`:state=='review'?`<g class="m-badge"><circle cx="80" cy="22" r="11" fill="#ffb110"/><path d="M80 16v7" stroke="#111" stroke-width="2.6" stroke-linecap="round"/><circle cx="80" cy="27.5" r="1.6" fill="#111"/></g>`:state=='thinking'?`<g class="m-dots"><circle cx="70" cy="18" r="3" fill="#0075DE"/><circle cx="79" cy="14" r="3" fill="#0075DE"/><circle cx="88" cy="18" r="3" fill="#0075DE"/></g>`:'';
 let body='';
 if(kind=='vo'){ // the 'o' of the logo as a pebble, the 'v' swoosh as a tuft
  body=`<g class="m-body" style="transform-origin:50px 90px"><path d="M38 20 C 42 28, 46 32, 50 31 C 55 26, 60 18, 68 14" fill="none" stroke="#0075DE" stroke-width="7" stroke-linecap="round"/><ellipse cx="50" cy="60" rx="32" ry="30" fill="#0075DE"/><ellipse cx="50" cy="64" rx="21" ry="17" fill="#fff"/>${eyes(42,58,60)}<path class="m-mouth" d="M45 70 q5 4 10 0" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round"/><ellipse cx="34" cy="70" rx="3.4" ry="2" fill="#62aef0" opacity=".7"/><ellipse cx="66" cy="70" rx="3.4" ry="2" fill="#62aef0" opacity=".7"/></g>`;
 } else if(kind=='wren'){ // a small migrating bird
  body=`<g class="m-body" style="transform-origin:50px 90px"><ellipse cx="50" cy="60" rx="30" ry="26" fill="#0075DE"/><path class="m-wing" d="M30 60 q14 -18 30 -2 q-14 12 -30 2z" fill="#62aef0" style="transform-origin:40px 60px"/><path d="M78 56 l12 4 -12 4z" fill="#ffb110"/>${eyes(60,70,52,3)}</g>`;
 } else { // pip: a folded case-file page
  body=`<g class="m-body" style="transform-origin:50px 90px"><path d="M24 18h38l16 16v52a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4z" fill="#fff" stroke="#0075DE" stroke-width="4"/><path d="M62 18v16h16" fill="#e6f3fe" stroke="#0075DE" stroke-width="4" stroke-linejoin="round"/>${eyes(40,56,56)}<path class="m-mouth" d="M43 66 q5 4 10 0" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round"/></g>`;
 }
 return `<svg class="mascot m-${state}" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${MASCOT_NAMES[kind]||'Vo'}, the Casevoya assistant${state=='thinking'?', drafting':state=='done'?', draft ready':state=='review'?', needs review':''}">${body}${badge}</svg>`;
}
