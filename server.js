/** JUST GAMBEL!!! — Free-play multiplayer arcade.
 * No real-money deposits, withdrawals, purchases or wagering.
 * All games use free score and cosmetic credits only.
 * Node.js 18+, no npm dependencies.
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, 'data.json');
const INDEX = path.join(__dirname, 'public', 'index.html');
const LIMIT = 5000000;
const STYLES = [
 {id:'nova',name:'Nova',icon:'✦',color:'#beff76',cost:0},
 {id:'ghost',name:'Ghost',icon:'◈',color:'#b39dff',cost:450},
 {id:'royal',name:'Royal',icon:'♛',color:'#ffd586',cost:1300},
 {id:'inferno',name:'Inferno',icon:'✷',color:'#ff947f',cost:2900},
 {id:'glitch',name:'Glitch',icon:'⌘',color:'#7ce5ff',cost:4800},
 {id:'cosmic',name:'Cosmic',icon:'✧',color:'#ff92cf',cost:8000}
];
const DEFAULTS = {chatEnabled:true, welcomePoints:1000, notice:'Welcome to the arcade. Alles nur Spielpunkte — kein Echtgeld.'};
let db;
try {
 db = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
 if (!Array.isArray(db.players) || !Array.isArray(db.chat)) throw new Error('Invalid database');
 db.logs ||= []; db.feed ||= []; db.settings = {...DEFAULTS,...(db.settings || {})};
} catch (e) {
 if (fs.existsSync(DATA_PATH)) { console.error('Existing data cannot be parsed. Refusing to overwrite.',e); process.exit(1); }
 db = {players:[],chat:[],logs:[],feed:[],settings:{...DEFAULTS}};
}
function save() { const tmp=DATA_PATH+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(db,null,2)); fs.renameSync(tmp,DATA_PATH); }
const uid=()=>crypto.randomUUID();
const token=()=>crypto.randomBytes(32).toString('hex');
const hash=(s)=>crypto.createHash('sha256').update(s).digest('hex');
const rand=(n)=>crypto.randomInt(n);
const now=()=>Date.now();
const adminSessions=new Map();
const sse=new Map(); const throttle=new Map(); const authLimits=new Map();
let sseNext=1;
// Ephemeral two-player puzzle rooms. No wagers, violence, or paid credits.
const rooms=new Map();
const MAX_ROOMS=100;
function roomOf(id){return [...rooms.values()].find(r=>r.players.includes(id))||null;}
function roomShort(r){return {id:r.id,name:r.name,hostName:db.players.find(p=>p.id===r.hostId)?.name||'Player',players:r.players.length,capacity:2,locked:!!r.passHash,status:r.status,round:r.round,createdAt:r.createdAt};}
function roomsPublic(){return [...rooms.values()].sort((a,b)=>b.createdAt-a.createdAt).map(roomShort);}
function roomView(r,id){if(!r||!r.players.includes(id))return null;
 const safePlayers=r.players.map(pid=>({id:pid,name:db.players.find(p=>p.id===pid)?.name||'Player',picked:Object.hasOwn(r.picks,pid)}));
 return {...roomShort(r),hostId:r.hostId,players:safePlayers,isHost:r.hostId===id,myPick:r.picks[id]??null,lastReveal:r.lastReveal||null,winnerId:r.winnerId||null,maxRounds:5};}
function syncRooms(){broadcast('rooms',roomsPublic());for(const {res,playerId} of sse.values())event(res,'my-room',roomView(roomOf(playerId),playerId));}
function roomLeave(r,id){r.players=r.players.filter(pid=>pid!==id);delete r.picks[id];r.lastReveal=null;
 if(!r.players.length){rooms.delete(r.id);return;}
 if(r.hostId===id)r.hostId=r.players[0];
 if(r.status==='active'){r.status='lobby';r.round=0;r.picks={};r.winnerId=null;}
 else if(r.status==='finished'){r.status='lobby';r.round=0;r.winnerId=null;r.picks={};}
 r.updatedAt=now();}

function send(res,status,payload){if(res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));}
const err=(res,status,message)=>send(res,status,{error:message});
function cookieMap(req){const out={}; for(const part of (req.headers.cookie||'').split(';')){let i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=part.slice(i+1).trim();}return out;}
function setCookie(res,k,v,age){const secure=process.env.NODE_ENV==='production'?' Secure;':'';res.setHeader('Set-Cookie',`${k}=${v}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age};${secure}`);}
function player(req,res){const c=cookieMap(req).jg_player;let p=(c&&/^[0-9a-f]{64}$/.test(c))?db.players.find(v=>v.secret===hash(c)):null;
 if(!p){ const raw=token();let name;do{name='Guest'+(10000+rand(90000));}while(db.players.some(x=>x.name.toLowerCase()===name.toLowerCase()));
 p={id:uid(),secret:hash(raw),name,balance:db.settings.welcomePoints,earned:0,played:0,wins:0,createdAt:now(),lastAction:0,style:'nova',owned:['nova'],muted:false,banned:false,blackjack:null,reactor:null};
 db.players.push(p);save();setCookie(res,'jg_player',raw,3600*24*365);
 }return p;
}
function admin(req){const v=cookieMap(req).jg_admin;const expiry=adminSessions.get(v);if(!v||!expiry)return false;if(expiry<now()){adminSessions.delete(v);return false;}return true;}
function safePlayer(p){const s=STYLES.find(x=>x.id===p.style)||STYLES[0];return {id:p.id,name:p.name,balance:p.balance,earned:p.earned,played:p.played,wins:p.wins,style:p.style,owned:p.owned,icon:s.icon,color:s.color,muted:!!p.muted,banned:!!p.banned,blackjack:blackjackView(p),reactor:reactorView(p)};}
function publicPlayer(p){const s=STYLES.find(x=>x.id===p.style)||STYLES[0];return {id:p.id,name:p.name,balance:p.balance,played:p.played,wins:p.wins,icon:s.icon,color:s.color};}
function adminPlayer(p){return {...publicPlayer(p),muted:!!p.muted,banned:!!p.banned,createdAt:p.createdAt,earned:p.earned};}
function leaderboard(){return db.players.filter(x=>!x.banned).slice().sort((a,b)=>b.balance-a.balance).slice(0,10).map(publicPlayer);}
function online(){return new Set([...sse.values()].map(s=>s.playerId)).size;}
function event(res,type,value){try{res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);}catch{}}
function broadcast(type,value){for(const {res} of sse.values())event(res,type,value);}
function personal(p){for(const {res,playerId} of sse.values())if(playerId===p.id)event(res,'me',safePlayer(p));}
function sync(){broadcast('leaderboard',leaderboard());broadcast('feed',db.feed.slice(0,12));broadcast('stats',{online:online(),players:db.players.length});broadcast('admin-refresh',{refresh:true});}
function feed(msg){db.feed.unshift({id:uid(),text:msg,time:now()});db.feed=db.feed.slice(0,50);}
function log(action,target='',detail=''){db.logs.unshift({id:uid(),time:now(),action,target,detail});db.logs=db.logs.slice(0,300);}
async function readBody(req){let chunks=[],bytes=0;for await(const part of req){bytes+=part.length;if(bytes>16000)throw {status:413,message:'Request too large'};chunks.push(part);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{throw {status:400,message:'Bad JSON'};}}
function originOK(req){const o=req.headers.origin;if(!o)return true;try{return new URL(o).host===req.headers.host;}catch{return false;}}
function text(v,max=240){return String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);}
function points(p,v){v=Math.trunc(v);p.balance=Math.max(0,Math.min(LIMIT,p.balance+v));}
function rate(key,ms){const before=throttle.get(key)||0;if(now()-before<ms)return false;throttle.set(key,now());return true;}
function card(){return {r:1+rand(13),s:['♠','♥','♦','♣'][rand(4)]};}
function cardValue(cards){let total=0,aces=0;for(const c of cards){if(c.r===1){total+=11;aces++;}else total+=Math.min(c.r,10);}while(total>21&&aces){total-=10;aces--;}return total;}
function blackjackView(p){const x=p.blackjack;if(!x)return null;return {state:x.state,you:x.you,dealer:x.state==='playing'?[x.dealer[0]]:x.dealer,total:cardValue(x.you),dealerTotal:x.state==='playing'?null:cardValue(x.dealer),outcome:x.outcome||null};}
function reactorView(p){const x=p.reactor;if(!x)return null;return {state:x.state,step:x.step,pending:x.pending,outcome:x.outcome||null};}
function finishGame(p,reward,isWin=false){points(p,reward);p.earned+=reward;p.played++;if(isWin)p.wins++; if(reward>=300)feed(`${p.name} scored +${reward} PTS ✨`);save();personal(p);sync();}
function adminData(){return {players:db.players.map(adminPlayer),logs:db.logs.slice(0,100),chat:db.chat.slice(-100),settings:db.settings,stats:{players:db.players.length,online:online(),totalGames:db.players.reduce((n,p)=>n+p.played,0),totalPoints:db.players.reduce((n,p)=>n+p.balance,0),banned:db.players.filter(p=>p.banned).length,muted:db.players.filter(p=>p.muted).length}};}
function authPass(a,b){const x=Buffer.from(hash(a),'hex'),y=Buffer.from(hash(b),'hex');return crypto.timingSafeEqual(x,y);}
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost');const route=url.pathname;
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
 if(req.method==='GET'&&(route==='/'||route==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});return res.end(fs.readFileSync(INDEX));}
 if(req.method==='GET'&&route==='/health')return send(res,200,{ok:true,name:'JUST GAMBEL!!!'});
 if(!route.startsWith('/api/'))return err(res,404,'Not found');
 if(req.method==='POST'&&!originOK(req))return err(res,403,'Wrong origin');
 const p=player(req,res);
 // Gebannte Spieler dürfen keine Games/Chat nutzen, aber eingeloggte Admins behalten
 // Zugriff auf Admin-Endpunkte, damit der Owner seinen Account wiederherstellen kann.
 if(p.banned&&route!=='/api/bootstrap'&&route!=='/api/events'&&route!=='/api/admin/login'&&route!=='/api/admin/logout'&&!(route.startsWith('/api/admin/')&&admin(req)))return err(res,403,'Account suspended by an admin');
 if(req.method==='GET'&&route==='/api/bootstrap')return send(res,200,{rooms:roomsPublic(),myRoom:roomView(roomOf(p.id),p.id),me:safePlayer(p),shop:STYLES,admin:admin(req),leaderboard:leaderboard(),chat:db.chat.slice(-70),feed:db.feed.slice(0,12),stats:{online:online(),players:db.players.length},settings:{chatEnabled:db.settings.chatEnabled,notice:db.settings.notice}});
 if(req.method==='GET'&&route==='/api/events'){
 res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
 const id=sseNext++;sse.set(id,{res,playerId:p.id});event(res,'connected',{online:online()});broadcast('stats',{online:online(),players:db.players.length});
 event(res,'rooms',roomsPublic());event(res,'my-room',roomView(roomOf(p.id),p.id));
 const timer=setInterval(()=>{try{res.write(': keepalive\n\n')}catch{}},20000);
 res.on('close',()=>{clearInterval(timer);sse.delete(id);broadcast('stats',{online:online(),players:db.players.length})});return;
 }
 if(req.method==='GET'&&route==='/api/admin/dashboard')return admin(req)?send(res,200,{...adminData(),rooms:roomsPublic()}):err(res,403,'Admin only');
 if(req.method!=='POST')return err(res,405,'Method not allowed');
 const b=await readBody(req);
 if(route==='/api/profile/name'){
 const name=text(b.name,24);
 if(!/^[\p{L}\p{N} _.-]{3,20}$/u.test(name)||/^(admin|owner|system|staff|mod|support)$/i.test(name))return err(res,400,'Name: 3–20 characters, letters/numbers/spaces/_/.-');
 if(db.players.some(x=>x.id!==p.id&&x.name.toLowerCase()===name.toLowerCase()))return err(res,409,'Name already taken');
 p.name=name;save();personal(p);sync();return send(res,200,{me:safePlayer(p)});
 }
 if(route==='/api/profile/style'){
 const s=STYLES.find(s=>s.id===b.style);if(!s)return err(res,400,'Unknown style');
 if(!p.owned.includes(s.id)){if(p.balance<s.cost)return err(res,400,'Not enough free points');points(p,-s.cost);p.owned.push(s.id);}
 p.style=s.id;save();personal(p);sync();return send(res,200,{me:safePlayer(p)});
 }
 if(route==='/api/chat/send'){
 if(!db.settings.chatEnabled)return err(res,403,'Chat is paused');
 if(p.muted)return err(res,403,'Chat muted for your account');
 if(!rate('chat:'+p.id,1500))return err(res,429,'Chat cooldown (1.5 s)');
 const message=text(b.message);if(message.length<1)return err(res,400,'Write a message');
 const msg={id:uid(),by:p.id,name:p.name,kind:'player',message,time:now(),color:STYLES.find(s=>s.id===p.style).color};
 db.chat.push(msg);db.chat=db.chat.slice(-100);save();broadcast('chat',msg);return send(res,200,{ok:true});
 }
 if(route==='/api/games/roulette'){
 if(!['red','black','green'].includes(b.pick))return err(res,400,'Choose red, black or green');
 if(!rate('game:'+p.id,2500))return err(res,429,'Game cooldown (2.5 s)');
 const number=rand(37),color=number===0?'green':number%2?'red':'black',correct=color===b.pick;
 const reward=correct?(color==='green'?420:165):0;
 finishGame(p,reward,correct);return send(res,200,{number,color,correct,reward,me:safePlayer(p)});
 }
 if(route==='/api/games/wheel'){
 if(!rate('game:'+p.id,2500))return err(res,429,'Game cooldown (2.5 s)');
 const options=[0,0,40,60,100,150,250,480],reward=options[rand(options.length)];
 finishGame(p,reward,reward>=250);return send(res,200,{reward,segment:options.indexOf(reward),me:safePlayer(p)});
 }
 if(route==='/api/games/blackjack'){
 const action=b.action;
 if(action==='start'){
 if(p.blackjack?.state==='playing')return err(res,409,'Finish your current 21 round first');
 if(!rate('game:'+p.id,1800))return err(res,429,'Game cooldown');
 p.blackjack={state:'playing',you:[card(),card()],dealer:[card(),card()],outcome:null};
 if(cardValue(p.blackjack.you)===21){p.blackjack.state='done';p.blackjack.outcome='BLACKJACK';finishGame(p,350,true);}
 else{save();personal(p);}
 return send(res,200,{me:safePlayer(p)});
 }
 if(!p.blackjack||p.blackjack.state!=='playing')return err(res,409,'Start a new round');
 if(action==='hit'){
 p.blackjack.you.push(card());
 if(cardValue(p.blackjack.you)>21){p.blackjack.state='done';p.blackjack.outcome='BUST';finishGame(p,0,false);}
 else if(cardValue(p.blackjack.you)===21){return doStand(p,res);}
 else{save();personal(p);}
 return send(res,200,{me:safePlayer(p)});
 }
 if(action==='stand')return doStand(p,res);
 return err(res,400,'Invalid action');
 }
 if(route==='/api/games/reactor'){
 const action=b.action;const x=p.reactor;
 if(action==='start'){
 if(x?.state==='active')return err(res,409,'Your reactor is running');
 if(!rate('game:'+p.id,1800))return err(res,429,'Game cooldown');
 p.reactor={state:'active',step:0,pending:0,outcome:null};save();personal(p);return send(res,200,{me:safePlayer(p)});
 }
 if(!x||x.state!=='active')return err(res,409,'Start the reactor first');
 if(action==='push'){
 if(x.step>=6)return err(res,409,'Bank your full reactor score');
 x.step++;
 const failure=[0,8,13,19,27,36,43][x.step];
 if(rand(100)<failure){x.state='done';x.pending=0;x.outcome='OVERLOAD';finishGame(p,0,false);}
 else{x.pending+=40+x.step*55;x.outcome='SAFE';save();personal(p);}
 return send(res,200,{me:safePlayer(p)});
 }
 if(action==='bank'){
 if(x.step===0)return err(res,400,'Charge at least once');
 x.state='done';x.outcome='BANKED';const reward=x.pending;finishGame(p,reward,true);return send(res,200,{me:safePlayer(p),reward});
 }
 return err(res,400,'Invalid action');
 }

 // New single-player challenge: hidden signal amongst four doors.
 if(route==='/api/games/signal'){
 const pick=Number(b.pick);if(!Number.isInteger(pick)||pick<1||pick>4)return err(res,400,'Choose a signal 1–4');
 if(!rate('game:'+p.id,1900))return err(res,429,'Game cooldown');
 const answer=1+rand(4),correct=pick===answer,reward=correct?180:0;
 finishGame(p,reward,correct);return send(res,200,{answer,correct,reward,me:safePlayer(p)});
 }
 // Logic puzzle: solve a server-created expression before it expires.
 if(route==='/api/games/math'){
 if(b.action==='start'){
 if(p.math?.state==='active'&&p.math.expiresAt>now())return err(res,409,'Solve the current puzzle');
 if(!rate('game:'+p.id,1600))return err(res,429,'Game cooldown');
 const a=5+rand(36),c=5+rand(36),operation=rand(2)?'+':'×';
 p.math={state:'active',a,c,operation,solution:operation==='+'?a+c:a*c,expiresAt:now()+30000};
 save();return send(res,200,{puzzle:{a,c,operation,expiresAt:p.math.expiresAt}});
 }
 if(b.action==='answer'){
 const m=p.math;if(!m||m.state!=='active')return err(res,409,'Start a puzzle');
 m.state='done';const correct=m.expiresAt>=now()&&Number.isSafeInteger(b.answer)&&b.answer===m.solution;
 const reward=correct?160:0;finishGame(p,reward,correct);
 return send(res,200,{correct,answer:m.solution,reward,me:safePlayer(p)});
 }
 return err(res,400,'Unknown puzzle action');
 }
 // Public/private invite rooms. Hosted round-based matching puzzle.
 if(route==='/api/rooms/create'){
 if(roomOf(p.id))return err(res,409,'Leave your existing room first');
 if(rooms.size>=MAX_ROOMS)return err(res,503,'Room limit reached');
 if(!rate('room-create:'+p.id,3000))return err(res,429,'Please wait before creating another room');
 const name=text(b.name,38);if(name.length<3||name.length>35)return err(res,400,'Room name: 3–35 characters');
 const locked=!!b.locked,password=String(b.password||'');
 if(locked&&(password.length<4||password.length>48))return err(res,400,'Password must be 4–48 characters');
 const salt=token().slice(0,24),r={id:crypto.randomBytes(3).toString('hex').toUpperCase(),name,hostId:p.id,players:[p.id],passHash:locked?hash(salt+password):null,salt,status:'lobby',round:0,picks:{},safeTile:null,lastReveal:null,winnerId:null,createdAt:now(),updatedAt:now()};
 rooms.set(r.id,r);syncRooms();return send(res,200,{room:roomView(r,p.id)});
 }
 if(route==='/api/rooms/join'){
 if(roomOf(p.id))return err(res,409,'Leave your existing room first');
 const r=rooms.get(String(b.id||'').toUpperCase());if(!r)return err(res,404,'Room no longer exists');
 if(r.status!=='lobby'||r.players.length>=2)return err(res,409,'Room not joinable');
 if(r.passHash&&hash(r.salt+String(b.password||''))!==r.passHash)return err(res,403,'Wrong room password');
 r.players.push(p.id);r.updatedAt=now();syncRooms();return send(res,200,{room:roomView(r,p.id)});
 }
 if(route==='/api/rooms/leave'){
 const r=roomOf(p.id);if(!r)return err(res,404,'Not inside a room');
 roomLeave(r,p.id);syncRooms();return send(res,200,{ok:true});
 }
 if(route==='/api/rooms/start'){
 const r=roomOf(p.id);if(!r)return err(res,404,'Not in a room');
 if(r.hostId!==p.id)return err(res,403,'Only the host can start');
 if(r.players.length!==2)return err(res,409,'Two players are required');
 if(r.status==='active')return err(res,409,'Match already running');
 r.status='active';r.round=1;r.picks={};r.safeTile=1+rand(3);r.lastReveal=null;r.winnerId=null;r.updatedAt=now();
 syncRooms();return send(res,200,{room:roomView(r,p.id)});
 }
 if(route==='/api/rooms/pick'){
 const r=roomOf(p.id),pick=Number(b.pick);
 if(!r||r.status!=='active')return err(res,409,'No active match');
 if(!Number.isInteger(pick)||pick<1||pick>3)return err(res,400,'Choose door 1, 2 or 3');
 if(Object.hasOwn(r.picks,p.id))return err(res,409,'Already selected this round');
 r.picks[p.id]=pick;
 if(r.players.every(pid=>Object.hasOwn(r.picks,pid))){
  const [a,bid]=r.players,winA=r.picks[a]===r.safeTile,winB=r.picks[bid]===r.safeTile;
  r.lastReveal={round:r.round,safeTile:r.safeTile,picks:{[a]:r.picks[a],[bid]:r.picks[bid]},result:winA===winB?'TIE':'WIN'};
  if(winA!==winB){
   r.winnerId=winA?a:bid;r.status='finished';
   finishGame(db.players.find(x=>x.id===r.winnerId),300,true);
   finishGame(db.players.find(x=>x.id===(winA?bid:a)),0,false);
  } else if(r.round>=5){
   r.status='finished';finishGame(db.players.find(x=>x.id===a),0,false);finishGame(db.players.find(x=>x.id===bid),0,false);
  } else {r.round++;r.safeTile=1+rand(3);r.picks={};}
 }
 r.updatedAt=now();syncRooms();return send(res,200,{room:roomView(r,p.id)});
 }
 if(route==='/api/admin/login'){
 if(!ADMIN_PASSWORD)return err(res,503,'Admin password not configured');
 const ip=req.socket.remoteAddress||'unknown',times=(authLimits.get(ip)||[]).filter(t=>now()-t<900000);
 if(times.length>=9)return err(res,429,'Too many attempts');
 if(!authPass(String(b.password||''),ADMIN_PASSWORD)){times.push(now());authLimits.set(ip,times);return err(res,401,'Wrong password');}
 authLimits.delete(ip);const raw=token();adminSessions.set(raw,now()+6*3600000);setCookie(res,'jg_admin',raw,6*3600);
 log('ADMIN LOGIN','','Session opened');save();return send(res,200,{ok:true});
 }
 if(route==='/api/admin/logout'){
 const raw=cookieMap(req).jg_admin;adminSessions.delete(raw);setCookie(res,'jg_admin','',0);return send(res,200,{ok:true});
 }
 if(!admin(req))return err(res,403,'Admin only');
 if(route==='/api/admin/close-room'){
 const r=rooms.get(String(b.id||'').toUpperCase());if(!r)return err(res,404,'Room not found');
 rooms.delete(r.id);log('CLOSE ROOM',r.id,r.name);save();syncRooms();return send(res,200,{ok:true});
 }
 if(route==='/api/admin/points'){
 const target=db.players.find(x=>x.id===b.playerId),amount=Number(b.amount),mode=b.mode;
 if(!target||!Number.isSafeInteger(amount)||amount<0||amount>500000||!['add','remove','set'].includes(mode))return err(res,400,'Invalid player/points (0–500,000)');
 if(mode==='add')points(target,amount);if(mode==='remove')points(target,-amount);if(mode==='set')target.balance=amount;
 log('POINTS '+mode.toUpperCase(),target.name,String(amount));save();personal(target);sync();return send(res,200,{ok:true,balance:target.balance});
 }
 if(route==='/api/admin/moderate'){
 const target=db.players.find(x=>x.id===b.playerId);if(!target||!['mute','ban'].includes(b.action)||typeof b.value!=='boolean')return err(res,400,'Invalid moderation command');
 // Aktuellen Admin-Spieler nicht selbst sperren. Entsperren bleibt erlaubt.
 if(b.action==='ban'&&b.value&&target.id===p.id)return err(res,403,'Du kannst deinen eigenen Account nicht bannen.');
 target[b.action==='mute'?'muted':'banned']=b.value;log(b.action.toUpperCase(),target.name,String(b.value));save();personal(target);sync();return send(res,200,{ok:true});
 }
 if(route==='/api/admin/announce'){
 const message=text(b.message,180);if(!message)return err(res,400,'Empty announcement');
 const msg={id:uid(),by:'system',name:'JUST GAMBEL STAFF',kind:'system',message,time:now(),color:'#ffd587'};
 db.chat.push(msg);db.chat=db.chat.slice(-100);log('ANNOUNCEMENT','',message);save();broadcast('chat',msg);broadcast('admin-refresh',{});return send(res,200,{ok:true});
 }
 if(route==='/api/admin/delete-message'){
 const before=db.chat.length;db.chat=db.chat.filter(x=>x.id!==b.messageId);if(before===db.chat.length)return err(res,404,'Message not found');
 log('DELETE CHAT',String(b.messageId).slice(0,40),'');save();broadcast('chat-sync',db.chat.slice(-70));return send(res,200,{ok:true});
 }
 if(route==='/api/admin/clear-chat'){
 db.chat=[];log('CLEAR CHAT','','All messages cleared');save();broadcast('chat-sync',[]);return send(res,200,{ok:true});
 }
 if(route==='/api/admin/settings'){
 if(typeof b.chatEnabled==='boolean')db.settings.chatEnabled=b.chatEnabled;
 if(b.welcomePoints!==undefined){const n=Number(b.welcomePoints);if(!Number.isSafeInteger(n)||n<0||n>100000)return err(res,400,'Welcome points 0–100,000');db.settings.welcomePoints=n;}
 if(b.notice!==undefined)db.settings.notice=text(b.notice,140);
 log('SETTINGS','','Website config changed');save();broadcast('settings',{chatEnabled:db.settings.chatEnabled,notice:db.settings.notice});return send(res,200,{ok:true,settings:db.settings});
 }
 return err(res,404,'Unknown endpoint');
 }catch(e){if(e?.status)return err(res,e.status,e.message);console.error('Server error',e);if(!res.headersSent)err(res,500,'Server error');else res.end();}
});
function doStand(p,res){const x=p.blackjack;while(cardValue(x.dealer)<17)x.dealer.push(card());
 const mine=cardValue(x.you),theirs=cardValue(x.dealer);
 const won=theirs>21||mine>theirs,draw=mine===theirs;
 x.state='done';x.outcome=won?'WIN':draw?'PUSH':'DEALER WINS';finishGame(p,won?250:0,won);
 return send(res,200,{me:safePlayer(p)});
}
server.listen(PORT,HOST,()=>console.log(`JUST GAMBEL!!! listening on http://localhost:${PORT} | free-play only | admin ${ADMIN_PASSWORD?'enabled':'disabled'}`));
