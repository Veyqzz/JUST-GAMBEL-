'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'just-gambel-test-'));
const port=40000+Math.floor(Math.random()*10000);
const server=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),ADMIN_PASSWORD:'test-pass-very-secret',DATA_PATH:path.join(tmp,'data.json')},stdio:['ignore','pipe','pipe']});
let output='';server.stderr.on('data',c=>output+=c);
const base=`http://127.0.0.1:${port}`;
let playerCookie='',adminCookie='';
function extractCookies(res){const out=res.headers.getSetCookie?.()||[];for(const raw of out){const c=raw.split(';')[0];if(c.startsWith('jg_player='))playerCookie=c;if(c.startsWith('jg_admin='))adminCookie=c;}}
async function request(route,body=null,admin=false){const headers={Cookie:[playerCookie,admin?adminCookie:''].filter(Boolean).join('; ')};if(body){headers['Content-Type']='application/json';headers.Origin=base;}const res=await fetch(base+route,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});extractCookies(res);return {code:res.status,data:await res.json()};}
(async()=>{try{
 for(let i=0;i<100;i++){try{await fetch(base+'/health');break}catch{await new Promise(r=>setTimeout(r,35))}}
 let r=await request('/api/bootstrap');assert.equal(r.code,200);assert.ok(playerCookie);assert.equal(r.data.me.balance,1000);const me=r.data.me.id;
 r=await request('/api/profile/name',{name:'TestHero'});assert.equal(r.code,200);
 r=await request('/api/chat/send',{message:'Hallo Welt'});assert.equal(r.code,200);
 r=await request('/api/games/roulette',{pick:'red'});assert.equal(r.code,200);assert.ok(r.data.number>=0&&r.data.number<=36);
 r=await request('/api/games/blackjack',{action:'start'});assert.equal(r.code,429); // 2.5-second game cooldown
 await new Promise(r=>setTimeout(r,2650));
 r=await request('/api/games/blackjack',{action:'start'});assert.equal(r.code,200);assert.ok(r.data.me.blackjack);
 if(r.data.me.blackjack.state==='playing'){r=await request('/api/games/blackjack',{action:'stand'});assert.equal(r.code,200);assert.equal(r.data.me.blackjack.state,'done');}
 await new Promise(r=>setTimeout(r,1900));
 r=await request('/api/games/reactor',{action:'start'});assert.equal(r.code,200);assert.equal(r.data.me.reactor.state,'active');
 r=await request('/api/games/reactor',{action:'push'});assert.equal(r.code,200);
 if(r.data.me.reactor.state==='active') { r=await request('/api/games/reactor',{action:'bank'});assert.equal(r.code,200);assert.equal(r.data.me.reactor.state,'done'); }
 r=await request('/api/admin/login',{password:'wrong'});assert.equal(r.code,401);
 r=await request('/api/admin/login',{password:'test-pass-very-secret'});assert.equal(r.code,200);assert.ok(adminCookie);
 r=await request('/api/admin/dashboard',undefined,true);assert.equal(r.code,200);assert.equal(r.data.players.length,1);
 r=await request('/api/admin/points',{playerId:me,amount:499,mode:'add'},true);assert.equal(r.code,200);
 r=await request('/api/bootstrap');assert.ok(r.data.me.balance>=499);
 r=await request('/api/admin/moderate',{playerId:me,action:'mute',value:true},true);assert.equal(r.code,200);
 r=await request('/api/chat/send',{message:'foo'});assert.equal(r.code,403);
 r=await request('/api/admin/announce',{message:'Hallo alle'},true);assert.equal(r.code,200);
 r=await request('/api/admin/settings',{chatEnabled:false,welcomePoints:999,notice:'Testbanner'},true);assert.equal(r.code,200);
 r=await request('/api/bootstrap');assert.equal(r.data.settings.chatEnabled,false);
 r=await request('/api/admin/clear-chat',{},true);assert.equal(r.code,200);
 r=await request('/api/admin/dashboard',undefined,true);assert.equal(r.data.chat.length,0);assert.ok(r.data.logs.length>=4);
 console.log('PASS: profile, chat, roulette, twenty-one, reactor, auth, points, moderation, settings, logs');
}catch(e){console.error('FAIL',e,'SERVER STDERR',output);process.exitCode=1}finally{server.kill();fs.rmSync(tmp,{recursive:true,force:true})}})();
