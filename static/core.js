function makeSim(R){
const GW=68,GH=34,CS=10,WW=680,WH=340;const P=makeSim.P||{TOL:9,sea:4,fa:11,fm:2.2,dmg:0.5,hun:95,stc:0.012,exc:0.03,grad:10};const TOL=P.TOL;
const SP=[{n:'Frostbacks',c:'#7F77DD',sp:1.5,se:34,st:1.7,tp:6},{n:'Meadowfolk',c:'#D4537E',sp:1.7,se:30,st:1.3,tp:18},{n:'Sunchasers',c:'#BA7517',sp:2.0,se:24,st:1.9,tp:30}];
const S={GW,GH,CS,WW,WH,SP,water:new Uint8Array(GW*GH),wd:new Float32Array(GW*GH),T:new Float32Array(GW*GH),food:[],cr:[],tick:0,fronts:[],boost:0,kills:[0,0,0]};
const cell=(x,y)=>Math.min(GH-1,Math.max(0,y/CS|0))*GW+Math.min(GW-1,Math.max(0,x/CS|0));
const wrapd=(a,m)=>{a=Math.abs(a);return a>m/2?m-a:a};
function updT(){const sea=P.sea*Math.sin(S.tick/3000)+S.boost;
for(let gy=0;gy<GH;gy++)for(let gx=0;gx<GW;gx++){const x=gx*CS+5,y=gy*CS+5;let t=18+P.grad*(2*y/WH-1)+sea;
for(const f of S.fronts){const dx=wrapd(x-f.x,WW),dy=wrapd(y-f.y,WH);t+=f.a*Math.exp(-(dx*dx+dy*dy)/14000)}S.T[gy*GW+gx]=t}}
function mk(s,x,y){const d=SP[s];return {s,x,y,d:R()*6.28,e:60,w:80+R()*20,dr:false,age:0,g:1,sp:d.sp,se:d.se,st:d.st,tp:d.tp}}
S.gen=function(){S.water.fill(0);S.food=[];S.cr=[];S.tick=0;S.boost=0;S.kills=[0,0,0];
for(let k=0;k<6;k++){const cx=R()*GW,cy=3+R()*(GH-6),r=2.2+R()*2.8,p1=R()*6,p2=R()*6;
for(let gy=0;gy<GH;gy++)for(let gx=0;gx<GW;gx++){const dx=wrapd(gx-cx,GW),dy=gy-cy,a=Math.atan2(dy,gx-cx);
if(Math.sqrt(dx*dx+dy*dy*1.6)<r*(1+0.3*Math.sin(a*3+p1)+0.2*Math.sin(a*5+p2)))S.water[gy*GW+gx]=1}}
S.wd.fill(1e9);let q=[];for(let i=0;i<GW*GH;i++)if(S.water[i]){S.wd[i]=0;q.push(i)}
for(let h=0;h<q.length;h++){const i=q[h],gx=i%GW,gy=i/GW|0;
for(const [ax,ay] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=(gx+ax+GW)%GW,ny=gy+ay;if(ny<0||ny>=GH)continue;const j=ny*GW+nx;if(S.wd[j]>S.wd[i]+1){S.wd[j]=S.wd[i]+1;q.push(j)}}}
S.fronts=[{x:R()*WW,y:R()*WH,vx:0.12,vy:0.05,a:P.fa},{x:R()*WW,y:R()*WH,vx:-0.09,vy:0.07,a:-P.fa}];updT();
for(let s=0;s<3;s++)for(let i=0;i<25;i++){let x,y,n=0;do{x=R()*WW;y=Math.min(WH-1,Math.max(0,(s+0.5)*WH/3+(R()-0.5)*90))}while(S.water[cell(x,y)]&&n++<50);S.cr.push(mk(s,x,y))}
for(let i=0;i<150;i++){const x=R()*WW,y=R()*WH;if(!S.water[cell(x,y)])S.food.push([x,y])}};
S.step=function(foodRate,mut){const food=S.food,cr=S.cr;
for(const f of S.fronts){f.x=(f.x+f.vx+WW)%WW;f.y=(f.y+f.vy+WH)%WH}
S.boost*=0.9994;if(S.tick%10===0)updT();
let acc=foodRate*P.fm;while(acc>0){if(R()<acc&&food.length<450){const x=R()*WW,y=R()*WH,ci=cell(x,y);
if(!S.water[ci]){const t=S.T[ci];if(R()<(0.2+0.8*Math.exp(-S.wd[ci]/5))*((t<-4||t>40)?0.15:1))food.push([x,y])}}acc-=1}
const born=[];
for(const c of cr){if(c.e<=0)continue;const ci=cell(c.x,c.y),T=S.T[ci],ex=Math.max(0,Math.abs(T-c.tp)-TOL);
let bf=-1,fd=c.se*c.se;for(let i=0;i<food.length;i++){const dx=food[i][0]-c.x,dy=food[i][1]-c.y,d=dx*dx+dy*dy;if(d<fd){fd=d;bf=i}}
let en=null,ed=c.se*c.se;for(const o of cr){if(o.s===c.s||o.e<=0)continue;const dx=o.x-c.x,dy=o.y-c.y,d=dx*dx+dy*dy;if(d<ed){ed=d;en=o}}
if(en&&ed<49){en.e-=P.dmg*c.st*(ex>0?P.away:1);if(en.e<=0){c.e+=25;S.kills[c.s]++}}
if(c.w<40)c.dr=true;if(c.w>=95)c.dr=false;
let mv=c.sp;
if(en&&en.st>c.st*1.25&&ed<P.fl*P.fl){c.d=Math.atan2(c.y-en.y,c.x-en.x)}
else if(c.dr){if(S.wd[ci]<=1){c.w+=2.5;mv=0}else{const gx=ci%GW,gy=ci/GW|0;let b=S.wd[ci],bx=0,by=0;
for(let ay=-1;ay<=1;ay++)for(let ax=-1;ax<=1;ax++){const ny=gy+ay;if(ny<0||ny>=GH)continue;const v=S.wd[ny*GW+(gx+ax+GW)%GW];if(v<b){b=v;bx=ax;by=ay}}
if(bx||by)c.d=Math.atan2(by,bx)}}
else if(en&&en.st<c.st*0.85&&c.e<P.hun&&(bf<0||ed<fd)){c.d=Math.atan2(en.y-c.y,en.x-c.x)}
else if(bf>=0){c.d=Math.atan2(food[bf][1]-c.y,food[bf][0]-c.x);if(fd<Math.max(36,c.sp*c.sp)){food.splice(bf,1);c.e+=28}}
else if(ex>0){let b=1e9;for(const [ax,ay] of [[30,0],[-30,0],[0,30],[0,-30]]){const v=Math.abs(S.T[cell((c.x+ax+WW)%WW,Math.min(WH-1,Math.max(0,c.y+ay)))]-c.tp);if(v<b){b=v;c.d=Math.atan2(ay,ax)}}}
else c.d+=(R()-0.5)*0.5;
if(mv){const nx=(c.x+Math.cos(c.d)*mv+WW)%WW,ny=c.y+Math.sin(c.d)*mv;if(ny<0||ny>=WH||S.water[cell(nx,ny)])c.d+=1.5+R();else{c.x=nx;c.y=ny}}
c.e-=0.08+0.035*c.sp*c.sp+0.0025*c.se+P.stc*c.st*c.st+P.exc*ex;c.w-=0.04*(1+Math.max(0,T-24)/12);c.age++;
if(c.e>110&&ex<=P.rex&&cr.length+born.length<450){c.e/=2;const m=(v,k,lo,hi)=>Math.min(hi,Math.max(lo,v+(R()-0.5)*mut*k));
born.push({s:c.s,x:c.x,y:c.y,d:R()*6.28,e:c.e,w:c.w,dr:false,age:0,g:c.g+1,sp:m(c.sp,1,0.3,5),se:m(c.se,25,5,120),st:m(c.st,1,0.2,5),tp:m(c.tp,P.tpk,-8,42)})}}
S.cr=cr.filter(c=>c.e>0&&c.w>0&&c.age<3000).concat(born);S.tick++};
S.stat=function(){return SP.map((d,s)=>{const a=S.cr.filter(c=>c.s===s),n=a.length||1,av=k=>a.reduce((x,c)=>x+c[k],0)/n;return {n:a.length,sp:av('sp'),se:av('se'),st:av('st'),tp:av('tp'),g:a.reduce((x,c)=>Math.max(x,c.g),0)}})};
return S}
if(typeof module!=='undefined')module.exports=makeSim;
