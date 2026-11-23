#!/usr/bin/env node
/* Массовая бойня: the server's battle run. stdin {fighters:[{cls,stats}], order:[...], seed} → stdout {log:[[k, victim, killer, tExec]], end}.
   The simulation below is the same text as in the game (MBCore). Generated from mb_core.js — edit that, not this. */
'use strict';
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const CLASSES={knight:{range:0},duelist:{range:0},berserker:{range:0},mage:{range:58,proj:'arcane'},necro:{range:52,proj:'shadow'},
  ranger:{range:62,proj:'arrow'},paladin:{range:0},assassin:{range:0},monk:{range:0},shaman:{range:54,proj:'lightning'},gunner:{range:66,proj:'bullet'},
  orc:{range:0},vampire:{range:0},gladiator:{range:0},samurai:{range:0}};
/* ===== МАССОВАЯ БОЙНЯ: the battle simulation. The same text runs in the game and on the server (mb_engine.js, Node).
   MBCore(L) needs L.mulberry32 and L.CLASSES (range, proj). Nothing here draws. ===== */
function MBCore(L){
/* ---------- 2. the timeline: the k-th death happens at T[k] seconds; 3–5 minutes for 20…500 fighters ---------- */
// few fighters: 2…4 minutes; a crowd: up to 5:30 (2 → 2:00, 30 → 4:00, 500 → 5:30)
function mbDuration(N){if(N<=2)return 120;if(N<30)return Math.round(120+120*Math.log(N/2)/Math.log(15));return Math.round(240+90*Math.min(1,Math.log(N/30)/Math.log(500/30)));}
function mbTimeline(N){
  const D=mbDuration(N),deaths=N-1,T=new Array(Math.max(0,deaths));if(deaths<=0)return {D:0,T,fin:0};
  const fin=N<=2?D:Math.min(40,D*0.12);T[deaths-1]=D;                 // the final duel ends the battle
  const spot=Math.min(deaths-1,9),mass=deaths-1-spot,spotEnd=D-fin;    // the last 9 deaths before the duel come one by one
  const spotStart=mass?Math.max(D*0.7,spotEnd-spot*14):D*0.25,step=spot?(spotEnd-spotStart)/spot:0;
  for(let i=0;i<spot;i++)T[mass+i]=spotStart+step*(i+0.5);
  const a=6,b=Math.max(a+1,spotStart-4);                                // mass phase: many deaths early, fewer later
  for(let k=0;k<mass;k++){const q=(k+1)/mass,u=1-Math.pow(1-q,1/2.2);T[k]=a+u*(b-a);}
  return {D,T,fin};
}

/* ---------- 6. the battle world ---------- */
function mbWorld(entrants,order,seed,prize,opts){opts=opts||{};order=order||[];
  const N=entrants.length,TL=mbTimeline(N),R0=Math.max(150,Math.min(1100,Math.sqrt(N)*48)),rnd=L.mulberry32(seed>>>0);
  const W={N,T:TL.T,D:TL.D,fin:TL.fin,R0,R:R0,t:opts.t0!=null?opts.t0:-2.5,rnd,seed,order:order.slice(),plan:[],server:!!opts.server,prize,alive:N,next:0,assign:0,ev:[],fx:[],proj:[],mins:[],pops:[],decals:[],done:false,winner:null,slow:0,duel:false,cell:48,grid:new Map()};
  // spawn: spread over the disc with a minimum gap, never on top of each other
  const pts=[],minD=Math.min(26,R0*1.6/Math.sqrt(N)),cs=minD,occ=new Map(),key=(x,y)=>((x/cs)|0)+','+((y/cs)|0);
  for(let tries=0;pts.length<N&&tries<N*400;tries++){const a=rnd()*Math.PI*2,r=Math.sqrt(rnd())*R0*0.9,x=Math.cos(a)*r,y=Math.sin(a)*r;let ok=true;
    for(let dx=-1;dx<=1&&ok;dx++)for(let dy=-1;dy<=1&&ok;dy++){const l=occ.get((((x/cs)|0)+dx)+','+(((y/cs)|0)+dy));if(l)for(const p of l)if((p[0]-x)**2+(p[1]-y)**2<minD*minD){ok=false;break;}}
    if(!ok)continue;pts.push([x,y]);const k=key(x,y);(occ.get(k)||occ.set(k,[]).get(k)).push([x,y]);}
  while(pts.length<N){const a=rnd()*Math.PI*2,r=Math.sqrt(rnd())*R0*0.9;pts.push([Math.cos(a)*r,Math.sin(a)*r]);}
  const dieAt=new Array(N).fill(Infinity),rank=new Array(N);
  order.forEach((idx,k)=>{if(idx==null)return;rank[idx]=k;if(k<N-1)dieAt[idx]=TL.T[k];});
  W.f=entrants.map((e,i)=>{const st=Object.assign({str:0,vit:0,arm:0,crit:0,hast:0,eva:0},e.stats||{}),C=L.CLASSES[e.cls];
    return {i,name:e.name,me:!!e.me,cls:e.cls,C,st,ranged:!!C.range,proj:C.proj||'',x:pts[i][0],y:pts[i][1],face:rnd()<0.5?1:-1,fv:rnd()<0.5?1:-1,
      hp:1,alive:true,dieAt:dieAt[i],k:rank[i],state:'idle',anim:0,dur:0.5,atkCd:0.5+rnd()*2,tgt:null,tgtT:0,doom:null,hunt:[],flash:0,
      spd:24+st.eva*0.9+st.hast*0.3,adur:Math.max(0.32,0.55-st.hast*0.012),cd:Math.max(0.55,1.15-st.hast*0.03),
      pDodge:0.06+st.eva*0.014,pBlock:0.07+st.arm*0.014+(e.cls==='knight'?0.08:0),pCrit:0.05+st.crit*0.012,dmgK:0.85+st.str*0.04,tough:1+st.vit*0.05,
      ph:rnd()*10,deadT:0,killer:null,kills:0,wan:[0,0],wanT:0,style:C.style,kind:C.weapon,aim:0,alt:0,buffT:0,buffId:'',path:e.path||'',
      sk:(e.sk||[]).map(q=>Object.assign({},q,{t:1.5+rnd()*Math.max(1,q.cd)}))};});
  W.me=W.f.find(f=>f.me)||null;W.winner=order.length===N&&order[N-1]!=null?W.f[order[N-1]]:null;
  // props scattered over the arena
  W.props=[];const PK=['bones','skull','rock','rock','bones','sword','brazier','banner'];
  for(let i=0;i<Math.round(R0*R0/2600);i++){const a=rnd()*Math.PI*2,r=Math.sqrt(rnd())*R0*0.97;W.props.push({k:PK[(rnd()*PK.length)|0],x:Math.cos(a)*r,y:Math.sin(a)*r});}
  return W;
}
function mbGrid(W){const G=W.grid,cs=W.cell;G.clear();for(const f of W.f){if(!f.alive)continue;const k=((Math.floor(f.x/cs))*73856093)^((Math.floor(f.y/cs))*19349663);let l=G.get(k);if(!l)G.set(k,l=[]);l.push(f);}}
function mbNear(W,f,maxR,pred){const cs=W.cell,cx=Math.floor(f.x/cs),cy=Math.floor(f.y/cs);let best=null,bd=Infinity;
  for(let ring=0;ring*cs<=maxR+cs;ring++){for(let dx=-ring;dx<=ring;dx++)for(let dy=-ring;dy<=ring;dy++){if(Math.max(Math.abs(dx),Math.abs(dy))!==ring)continue;
      const l=W.grid.get(((cx+dx)*73856093)^((cy+dy)*19349663));if(!l)continue;
      for(const o of l){if(o===f||!o.alive||(pred&&!pred(o)))continue;const d=(o.x-f.x)**2+(o.y-f.y)**2;if(d<bd){bd=d;best=o;}}}
    if(best&&Math.sqrt(bd)<ring*cs)break;}
  return best&&Math.sqrt(bd)<=maxR?best:null;}

/* the director: a death comes due → send the nearest fighter who outlives that moment */
function mbAssign(W,k){const vi=W.order[k];if(vi==null)return false;   // server mode: this death is not known yet
  const v=W.f[vi];if(!v.alive)return true;
  if(W.server){const kl=W.f[W.plan[k]];if(kl&&kl!==v&&kl.alive){v.doom={by:kl,T:W.T[k],t0:W.t,h0:Math.max(0.35,v.hp)};kl.hunt.push(v);v.tgt=kl;return true;}}
  mbSendKiller(W,v,W.T[k]);return true;}
function mbSendKiller(W,v,T){
  const ok=o=>o.dieAt>Math.max(T,W.t)+1.5;
  let killer=mbNear(W,v,90,o=>ok(o)&&!o.hunt.length)||mbNear(W,v,140,ok)||mbNear(W,v,400,o=>ok(o)&&o.hunt.length<2);
  if(!killer){let bd=Infinity;for(const o of W.f){if(o===v||!o.alive||!ok(o))continue;const d=(o.x-v.x)**2+(o.y-v.y)**2+(o.hunt.length*4000);if(d<bd){bd=d;killer=o;}}}
  if(!killer)killer=W.winner&&W.winner!==v?W.winner:W.f.find(o=>o!==v&&o.alive);
  v.doom={by:killer,T,t0:W.t,h0:Math.max(0.35,v.hp)};killer.hunt.push(v);v.tgt=killer;
}
/* skills: the fighter's own upgraded skills, cast when they fit the distance. They hurt like any blow and never decide a death */
function mbSkillOk(s,d,want){const k=s.kind;return k==='summon'?d<=110:k==='melee'?d<=want+8:k==='dash'?d<=80:k==='ranged'?d<=85:k==='aoe'?d<=Math.max(18,(s.r||30)*0.8):d<=60;}
function mbHop(W,f,tg,over,mult){const dx=tg.x-f.x,dy=tg.y-f.y,d=Math.hypot(dx,dy)||1,R=W.R-10;let x=tg.x+dx/d*over,y=tg.y+dy/d*over;const r=Math.hypot(x,y);if(r>R){x*=R/r;y*=R/r;}
  const from={x:f.x,y:f.y};f.x=x;f.y=y;f.face=dx>=0?1:-1;mbHit(W,f,tg,false,mult||1);return from;}
function mbNearOf(W,c,me,r){let best=null,bd=r*r;for(const o of W.f){if(!o.alive||o===me||o===c)continue;const d=(o.x-c.x)**2+(o.y-c.y)**2;if(d<bd){bd=d;best=o;}}return best;}
function mbCast(W,f,s,tg,d){
  f.state='attack';f.anim=0;f.dur=0.5;f.hitDone=true;f.atk=tg;f.aim=Math.atan2(tg.y-f.y,tg.x-f.x);
  const ev={type:'cast',f,id:s.id,lv:s.lv,kind:s.kind,tg,from:{x:f.x,y:f.y}};
  const SK=1.6+0.15*(s.lv||1);   // a skill hits far harder than a plain blow: level 1 ×1.75 … level 5 ×2.35
  if(s.kind==='melee')mbHit(W,f,tg,false,SK);
  else if(s.kind==='dash'){if(s.hops>1){f.hops=[];let cur=tg;for(let k=0;k<s.hops;k++){f.hops.push(cur);cur=mbNearOf(W,cur,f,60)||cur;}f.hopT=0;f.hopN=0;f.hopK=SK*0.8;f.dur=s.hops*0.17+0.2;ev.god=1;}else{mbHop(W,f,tg,10,SK);ev.to={x:f.x,y:f.y};}}
  else if(s.kind==='ranged'){const life=Math.max(0.15,d/140);ev.travel=life;W.proj.push({a:f,b:tg,x0:f.x+f.face*8,y0:f.y-16,t:0,life,skill:SK,col:MB_PCOL[f.proj]||MB_PCOL.arcane});}
  else if(s.kind==='aoe'){const r=s.r||30;let n=0;for(const o of W.f){if(!o.alive||o===f||n>=6)continue;if((o.x-f.x)**2+(o.y-f.y)**2<=r*r){mbHit(W,f,o,false,SK*0.75);n++;}}}
  else if(s.kind==='summon'){const mine=W.mins.filter(m=>m.own===f).length,n=Math.max(0,Math.min(s.n||2,4-mine));
    for(let k=0;k<n;k++){const a=W.rnd()*6.28;W.mins.push({skel:1,kind:'skel',own:f,name:f.name,alive:true,hp:1,max:1,tgt:null,x:f.x+Math.cos(a)*14,y:f.y+Math.sin(a)*8,face:f.face,life:s.dur||10,
      spawnT:0.35,state:'spawn',anim:0,hitT:0,hitAnim:0,atkT:0.4,pCrit:0.05,dmgK:0.55,st:{str:0}});}}
  else{f.buffT=3;f.buffId=s.id;}
  W.ev.push(ev);
}
/* deaths drawn within the same 2 seconds count as simultaneous (the crowd phase); further apart they keep the drawn order */
const MB_WIN=2;
function mbDue(W,v){return W.t>=W.T[v.k]&&W.T[v.k]-W.T[W.next]<=MB_WIN;}
function mbKill(W,v,k,crit){
  v.alive=false;v.state='dead';v.deadT=W.t;v.killer=k;v.hp=0;v.doom=null;k.kills++;
  const i=k.hunt.indexOf(v);if(i>=0)k.hunt.splice(i,1);
  v.done=true;while(W.next<W.N-1&&W.order[W.next]!=null&&W.f[W.order[W.next]].done)W.next++;W.alive--;W.ev.push({t:W.t,type:'kill',v,k,left:W.alive});
  for(let j=0;j<14;j++){const a=W.rnd()*6.28,s=20+W.rnd()*50;W.fx.push({k:'p',x:v.x,y:v.y-10,vx:Math.cos(a)*s,vy:Math.sin(a)*s*0.6-30,g:90,life:0.5+W.rnd()*0.4,t:0,col:['#d6404e','#8a1a2a','#ff6070','#e2dccc'][j%4]});}
  W.fx.push({k:'skull',x:v.x,y:v.y-26,t:0,life:1.1});
  if(W.decals.length>900)W.decals.shift();W.decals.push({x:v.x+(W.rnd()-0.5)*6,y:v.y+1,s:W.rnd()});
  if(W.alive===2){W.duel=true;const [a,b]=W.f.filter(f=>f.alive);a.tgt=b;b.tgt=a;W.ev.push({t:W.t,type:'duel',a,b});}
  if(W.alive===1){W.done=true;W.winner=k;W.slow=1.4;W.ev.push({t:W.t,type:'win',w:k});}
  if(crit)W.pops.push({x:v.x,y:v.y-30,txt:'ДОБИТ',col:'#ff6070',t:0,life:1,big:1});
}
function mbHit(W,a,b,fromProj,mult){mult=mult||1;
  if(!a.alive||!b.alive)return;
  if(b.skel){const crit=W.rnd()<a.pCrit,dmg=(0.16+W.rnd()*0.1)*(crit?1.8:1)*a.dmgK*mult,n=Math.max(1,Math.round(dmg*500));b.hp-=dmg;b.hitT=0.12;b.kx=(b.x-a.x)>0?2:-2;
    if(W.pops.length<120)W.pops.push({x:b.x,y:b.y-22,txt:String(n)+(crit?'!':''),col:crit?'#ffd24a':'#cfe8d6',t:0,life:0.7,big:crit});
    if(b.hp<=0){b.alive=false;for(let j=0;j<10;j++)W.fx.push({k:'p',x:b.x,y:b.y-10,vx:(W.rnd()-0.5)*90,vy:-30-W.rnd()*50,g:160,life:0.6,t:0,col:j%3?'#e8f0e0':'#6ef0a0'});W.ev.push({type:'skeldie',m:b});}
    else W.ev.push({type:'hit',a,b,crit});return;}
  const due=b.doom&&b.doom.by===a&&mbDue(W,b);
  if(due){mbKill(W,b,a,true);return;}
  const r=W.rnd(),pop=(txt,col,big)=>{if(W.pops.length<120)W.pops.push({x:b.x+(W.rnd()-0.5)*6,y:b.y-28,txt,col,t:0,life:0.8,big});};
  // the picture must agree with the draw: whoever outlives his attacker fights like it — more dodges and blocks, less damage taken
  const fa=(a.own||a).dieAt,fb=b.dieAt,fated=fb>fa+1,low=!b.doom&&b.hp<0.4?0.14:0,ed=(fated?0.12:0)+low,eb=(fated?0.1:0)+low;   // hurt but not his turn: he fights on the defensive
  if(r<b.pDodge+ed){pop('уклон','#a59cb8');b.dodge=0.25;b.dx=(W.rnd()<0.5?-1:1)*9;return;}
  if(r<b.pDodge+ed+b.pBlock+eb){pop('блок','#7ab8ff');for(let j=0;j<4;j++)W.fx.push({k:'p',x:b.x-b.face*3,y:b.y-14,vx:(W.rnd()-0.5)*60,vy:-20-W.rnd()*30,g:120,life:0.3,t:0,col:j%2?'#fff':'#ffe08a'});return;}
  const crit=W.rnd()<a.pCrit,dmg=(0.035+W.rnd()*0.025)*(crit?1.9:1)*a.dmgK*mult/b.tough*(fated?0.8:1);
  // nobody drops to zero from a stray blow: only the fighter whose turn has come falls, and only to the one sent for him
  const nh=b.hp-dmg;b.hp=Math.max(b.doom?0.03:0.06,nh);
  // a fighter whose turn hasn't come gets his second wind when he's nearly down: everyone sees why he still stands
  if(!b.doom&&b.hp<0.2&&W.t-(b.swT||-99)>12){b.swT=W.t;b.hp=0.55+W.rnd()*0.2;b.buffT=1.2;b.buffId='second_wind';b.kx=(b.x-a.x)>0?7:-7;
    if(W.pops.length<120)W.pops.push({x:b.x,y:b.y-36,txt:'второе дыхание',col:'#7be38a',t:0,life:1.2,big:0});
    for(let j=0;j<14;j++){const an=j/14*6.28;W.fx.push({k:'p',x:b.x+Math.cos(an)*8,y:b.y-6+Math.sin(an)*4,vx:Math.cos(an)*14,vy:-40-W.rnd()*30,g:-20,life:0.8,t:0,col:j%2?'#b8ffcc':'#3ecf6a'});}
    W.ev.push({type:'wind',f:b});}if(W.t-(b.flAt||-9)>0.5){b.flash=0.12;b.flAt=W.t;}   // a crowd hits often: blink at most twice a second
  const n=Math.max(1,Math.round(dmg*(800+a.st.str*30)));if(mult>1)pop(String(n)+(crit?'!':''),crit?'#ffd24a':MB_SKCOL[a.cls]||'#ff9a3a',1);else pop(crit?n+'!':String(n),crit?'#ffd24a':'#f0e7d3',crit);
  for(let j=0;j<(crit?8:4);j++)W.fx.push({k:'p',x:b.x,y:b.y-12,vx:(W.rnd()-0.5)*70,vy:-10-W.rnd()*40,g:110,life:0.35,t:0,col:crit?'#ffd24a':'#ff6070'});
  b.kx=(b.x-a.x)>0?2:-2;W.ev.push({type:'hit',a,b,crit});
}
const MB_SKCOL={knight:'#8fd3ff',mage:'#ff9a3a',necro:'#7be38a',gladiator:'#ffd24a',samurai:'#c8a0ff'};   // skill damage numbers, in the class's colour
const MB_PCOL={arcane:['#e8d8ff','#b07aff','#6a3ab0'],shadow:['#d8ffd8','#7be38a','#2a6a3a'],arrow:['#fff','#e2dccc','#6a5030'],lightning:['#fff','#8fd3ff','#4d65b4'],bullet:['#fff','#ffd24a','#a06020']};
function mbStep(W,dt){
  if(W.slow>0){W.slow-=dt;dt*=0.25;}
  W.t+=dt;if(W.t<0)return;
  mbGrid(W);
  const lead=k=>W.N-1-k<=10?10:8;
  while(W.assign<W.N-1&&W.T[W.assign]-lead(W.assign)<=W.t){if(mbAssign(W,W.assign)===false)break;W.assign++;}
  W.R+=(Math.max(70,W.R0*Math.sqrt(W.alive/W.N)*1.05)-W.R)*Math.min(1,dt*0.4);
  for(const f of W.f){
    if(!f.alive)continue;
    f.flash=Math.max(0,f.flash-dt);if(f.dodge>0)f.dodge-=dt;if(f.buffT>0)f.buffT-=dt;
    if(f.doom&&!f.doom.by.alive){const T=f.doom.T;f.doom=null;mbSendKiller(W,f,T);}   // my killer fell first: someone else comes for me
    if(!f.doom&&f.hp<1)f.hp=Math.min(1,f.hp+dt*(f.tgt&&!f.tgt.skel&&Math.hypot(f.tgt.x-f.x,f.tgt.y-f.y)<30?0.01:0.05));   // slowly in a fight, faster when nobody is on him
    if(f.doom)f.hp=Math.min(f.hp,Math.max(0.03,f.doom.h0*Math.max(0,f.doom.T-W.t)/Math.max(1,f.doom.T-f.doom.t0)+0.12));
    // whom to fight: my victim first, then my killer, then whoever is near
    let tg=f.hunt.length?f.hunt[0]:(f.doom?f.doom.by:f.tgt);
    if(!tg||!tg.alive||(!f.hunt.length&&!f.doom&&!W.duel&&W.t>f.tgtT)){tg=mbNear(W,f,150)||null;f.tgtT=W.t+3+W.rnd()*4;
      if(!f.hunt.length&&!f.doom&&W.mins.length){let sb=null,sd=45*45;for(const m of W.mins){if(!m.alive||m.own===f||m.spawnT>0)continue;const d=(m.x-f.x)**2+(m.y-f.y)**2;if(d<sd&&(m.tgt===f||W.rnd()<0.35)){sd=d;sb=m;}}
        if(sb){tg=sb;f.tgtT=W.t+2+W.rnd()*2;}}}
    f.tgt=tg;
    let mx=0,my=0,sp=f.spd;
    if(tg){const dx=tg.x-f.x,dy=tg.y-f.y,d=Math.hypot(dx,dy)||1,want=f.ranged?40:11;
      // a hunter hurries when his victim's moment is near; a doomed fighter stops backing away and faces his killer
      const hunting=f.hunt.length&&f.hunt[0]===tg,soon=hunting&&W.t>tg.doom.T-2.5;if((soon&&d>want+6)||(hunting&&d>120))sp*=soon&&W.t>tg.doom.T+1?2.6:2;
      const doomed=f.doom&&f.doom.by===tg;
      if(d>want+2){mx=dx/d;my=dy/d;if(doomed&&W.t>f.doom.T-3){mx*=0.8;my*=0.8;}}else if(f.ranged&&d<want-14&&!doomed){mx=-dx/d*0.7;my=-dy/d*0.7;}
      else{const s=Math.sin(W.t*1.3+f.ph)*0.35;mx=-dy/d*s;my=dx/d*s;}
      if(Math.abs(dx)>2)f.face=dx>0?1:-1;f.fv=dy>4?1:dy<-4?-1:f.fv;
      // attack
      f.atkCd-=dt;
      if(hunting&&tg.doom&&mbDue(W,tg))f.atkCd=Math.min(f.atkCd,0);
      if(f.sk.length){for(const q of f.sk)q.t-=dt;
        if(f.state!=='attack'){const q=f.sk.find(q=>q.t<=0&&mbSkillOk(q,d,want));if(q){q.t=q.cd*(0.8+W.rnd()*0.5);mbCast(W,f,q,tg,d);}}}
      if(f.state!=='attack'&&d<=want+(f.ranged?14:5)&&f.atkCd<=0){f.aim=Math.atan2(dy,dx);f.alt=f.alt?0:1;f.state='attack';f.anim=0;f.dur=f.adur*(f.ranged?1.3:1);f.hitDone=false;f.atkCd=f.cd*(0.75+W.rnd()*0.5)*(f.hunt.length&&W.t>=tg.dieAt?0.6:1);f.atk=tg;}
    }else{ // nobody near: walk toward the middle
      if(W.t>f.wanT){f.wanT=W.t+2+W.rnd()*3;const a=W.rnd()*6.28;f.wan=[Math.cos(a)*0.5-f.x/W.R0,Math.sin(a)*0.5-f.y/W.R0];}mx=f.wan[0];my=f.wan[1];}
    // the arena closes in
    const rc=Math.hypot(f.x,f.y);if(rc>W.R-8){mx-=f.x/rc*1.2;my-=f.y/rc*1.2;sp=Math.max(sp,f.spd*1.3);}
    // keep apart from neighbours
    const cs=W.cell,cx=Math.floor(f.x/cs),cy=Math.floor(f.y/cs);
    for(let ax=-1;ax<=1;ax++)for(let ay=-1;ay<=1;ay++){const l=W.grid.get(((cx+ax)*73856093)^((cy+ay)*19349663));if(!l)continue;
      for(const o of l){if(o===f)continue;const dx=f.x-o.x,dy=f.y-o.y,dd=dx*dx+dy*dy;if(dd<81&&dd>0.01){const d=Math.sqrt(dd);mx+=dx/d*(9-d)/9*1.5;my+=dy/d*(9-d)/9*1.5;}}}
    if(f.dodge>0){f.x+=(f.dx||0)*dt*4;}
    if(f.kx){f.x+=f.kx*dt*6;f.kx*=0.8;if(Math.abs(f.kx)<0.1)f.kx=0;}
    const m=Math.hypot(mx,my);
    if(f.hops&&f.hops.length){f.hopT-=dt;if(f.hopT<=0){const t2=f.hops.shift();f.hopT=0.17;const tg2=t2&&t2.alive?t2:mbNear(W,f,60);
      if(tg2){const from=mbHop(W,f,tg2,12,f.hopK||1.5);W.ev.push({type:'hop',f,from,to:{x:f.x,y:f.y},n:f.hopN++});}else f.hops.length=0;}}
    if(f.state==='attack'){f.anim+=dt;const p=f.anim/f.dur;
      if(p>=0.45&&!f.hitDone){f.hitDone=true;const b=f.atk;
        if(b&&b.alive){if(f.ranged){const d=Math.hypot(b.x-f.x,b.y-f.y),life=Math.max(0.15,d/150);W.proj.push({a:f,b,x0:f.x+f.face*8,y0:f.y-16,t:0,life,col:MB_PCOL[f.proj]||MB_PCOL.arcane});W.ev.push({type:'shot',f,tg:b,travel:life});}
          else if(Math.hypot(b.x-f.x,b.y-f.y)<f.C.range+22){mbHit(W,f,b);W.ev.push({type:'blow',f,tg:b});W.fx.push({k:'slash',x:f.x+f.face*7,y:f.y-12,face:f.face,t:0,life:0.16});}}}
      if(f.anim>=f.dur)f.state='idle';
      if(m>0.01){f.x+=mx/m*sp*dt*0.25;f.y+=my/m*sp*dt*0.25;}
    }else if(m>0.15){const k=Math.min(1,m);f.x+=mx/m*sp*k*dt;f.y+=my/m*sp*k*dt;f.state='run';}
    else f.state='idle';
  }
  for(let i=W.mins.length-1;i>=0;i--){const m=W.mins[i];m.life-=dt;m.hitT=Math.max(0,m.hitT-dt);if(m.hitAnim>0)m.hitAnim-=dt;
    if(!m.alive||m.life<=0||!m.own.alive){W.mins.splice(i,1);continue;}
    if(m.spawnT>0){m.spawnT-=dt;if(m.spawnT<=0)m.state='idle';continue;}
    let tg=m.own.tgt&&m.own.tgt.alive&&!m.own.tgt.skel?m.own.tgt:mbNear(W,m,60,o=>o!==m.own);m.tgt=tg;
    const ox=m.own.x+(W.mins.indexOf(m)%2?10:-10),oy=m.own.y+6;let tx=ox,ty=oy;
    if(tg){tx=tg.x-Math.sign(tg.x-m.x||1)*9;ty=tg.y;}
    const dx=tx-m.x,dy=ty-m.y,d=Math.hypot(dx,dy);
    if(d>2){const sp=Math.min(d,38*dt);m.x+=dx/d*sp;m.y+=dy/d*sp;m.state='move';m.anim+=dt;}else m.state='idle';
    if(tg){m.face=tg.x>=m.x?1:-1;m.atkT-=dt;if(m.atkT<=0&&Math.hypot(tg.x-m.x,tg.y-m.y)<14){m.atkT=1/0.9;m.hitAnim=0.15;mbHit(W,m,tg);}}
  }
  // projectiles
  for(let i=W.proj.length-1;i>=0;i--){const p=W.proj[i];p.t+=dt;if(p.t>=p.life){W.proj.splice(i,1);if(p.b.alive)mbHit(W,p.a,p.b,true,p.skill||1);
    for(let j=0;j<5;j++)W.fx.push({k:'p',x:p.b.x,y:p.b.y-14,vx:(W.rnd()-0.5)*60,vy:(W.rnd()-0.5)*50,g:20,life:0.3,t:0,col:p.col[1]});}}
  for(let i=W.fx.length-1;i>=0;i--){const q=W.fx[i];q.t+=dt;if(q.k==='p'){q.vy+=(q.g||0)*dt;q.x+=q.vx*dt;q.y+=q.vy*dt;}if(q.t>=q.life)W.fx.splice(i,1);}
  for(let i=W.pops.length-1;i>=0;i--){const q=W.pops[i];q.t+=dt;if(q.t>=q.life)W.pops.splice(i,1);}
  if(W.fx.length>1500)W.fx.splice(0,W.fx.length-1500);
}


/* server mode: the server's draw arrives piece by piece — [k, victim, killer, tExec] — at most ~12 s ahead of the battle */
function mbFeedLog(W,rows){for(const r of rows){const k=r[0],v=r[1],kl=r[2];if(W.order[k]!=null)continue;W.order[k]=v;W.plan[k]=kl;const f=W.f[v];if(f){f.k=k;f.dieAt=W.T[k];}}}
return {mbDuration,mbTimeline,mbWorld,mbStep,mbFeedLog,mbDue};
}

let raw='';process.stdin.on('data',d=>raw+=d);process.stdin.on('end',()=>{
  try{const q=JSON.parse(raw),M=MBCore({mulberry32,CLASSES}),N=q.fighters.length;
    const ents=q.fighters.map((f,i)=>({name:'f'+i,cls:CLASSES[f.cls]?f.cls:'knight',stats:Object.assign({str:0,vit:0,arm:0,crit:0,hast:0,eva:0},f.stats||{})}));
    const W=M.mbWorld(ents,q.order,q.seed>>>0,'',{t0:0});const log=[];
    while(!W.done&&W.t<W.D+300){M.mbStep(W,1/30);for(const e of W.ev.splice(0))if(e.type==='kill')log.push([e.v.k,e.v.i,e.k.i,Math.round(W.t*100)/100]);}
    log.sort((a,b)=>a[0]-b[0]);
    process.stdout.write(JSON.stringify({log,end:Math.round(W.t*100)/100,done:W.done}));
  }catch(e){process.stdout.write(JSON.stringify({error:String(e&&e.stack||e)}));}});
