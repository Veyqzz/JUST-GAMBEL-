'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jg-v3-'));
const port=43000+Math.floor(Math.random()*10000);
const sv=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_PATH:path.join(tmp,'data.json'),ADMIN_PASSWORD:'admin-secret-strong'},stdio:['ignore','pipe','pipe']});
let output='';sv.stderr.on('data',x=>output+=x);
const url=`http://127.0.0.1:${port}`;
const people={a:{cookie:''},b:{cookie:''},c:{cookie:''}};
async function request(user,path,body){const headers={Cookie:people[user].cookie};if(body!==undefined){headers['Content-Type']='application/json';headers.Origin=url;}const res=await fetch(url+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});for(const cookie of res.headers.getSetCookie?.()||[]){const c=cookie.split(';')[0];if(c.startsWith('jg_player=')){people[user].cookie=c;break;}}return {status:res.status,data:await res.json()};}
(async()=>{try{
 for(let i=0;i<120;i++){try{await fetch(url+'/health');break}catch{await new Promise(r=>setTimeout(r,30))}}
 const a=(await request('a','/api/bootstrap')).data.me,b=(await request('b','/api/bootstrap')).data.me;
 let r=await request('a','/api/rooms/create',{name:'The Secret Chamber',locked:true,password:'my-strong-password'});assert.equal(r.status,200);
 const id=r.data.room.id;
 r=await request('c','/api/bootstrap');assert.equal(r.data.rooms.length,1);assert.equal(JSON.stringify(r.data.rooms).includes('my-strong-password'),false);
 r=await request('b','/api/rooms/join',{id,password:'wrong'});assert.equal(r.status,403);
 r=await request('b','/api/rooms/join',{id,password:'my-strong-password'});assert.equal(r.status,200);
 r=await request('b','/api/rooms/start',{});assert.equal(r.status,403,'non-host cannot start');
 r=await request('a','/api/rooms/start',{});assert.equal(r.status,200);assert.equal(r.data.room.status,'active');
 r=await request('a','/api/rooms/pick',{pick:1});assert.equal(r.status,200);
 r=await request('a','/api/rooms/pick',{pick:2});assert.equal(r.status,409,'cannot choose twice');
 r=await request('b','/api/rooms/pick',{pick:2});assert.equal(r.status,200);
 for(let n=0;n<4&&r.data.room.status==='active';n++){
  assert.equal((await request('a','/api/rooms/pick',{pick:1})).status,200);
  r=await request('b','/api/rooms/pick',{pick:2});assert.equal(r.status,200);
 }
 const ra=(await request('a','/api/bootstrap')).data,rb=(await request('b','/api/bootstrap')).data;
 assert.equal(ra.me.played,1,'each player receives exactly 1 resolved match');
 assert.equal(rb.me.played,1);
 assert.ok([2000,2300].includes(ra.me.balance+rb.me.balance),'winner +300 or draw +0');
 assert.equal(r.data.room.status,'finished');
 assert.equal(Math.min(ra.me.balance,rb.me.balance),1000,'loser earns 0');
 r=await request('a','/api/rooms/start',{});assert.equal(r.status,200,'rematch works');
 r=await request('b','/api/rooms/leave',{});assert.equal(r.status,200);
 r=await request('a','/api/bootstrap');assert.equal(r.data.myRoom.status,'lobby');
 r=await request('a','/api/rooms/leave',{});assert.equal(r.status,200);
 r=await request('c','/api/bootstrap');assert.equal(r.data.rooms.length,0);
 r=await request('c','/api/games/math',{action:'start'});assert.equal(r.status,200);assert.ok(r.data.puzzle.expiresAt>Date.now());
 const pu=r.data.puzzle;const correct=pu.operation==='+'?pu.a+pu.c:pu.a*pu.c;
 r=await request('c','/api/games/math',{action:'answer',answer:correct+1});assert.equal(r.status,200);assert.equal(r.data.reward,0);
 await new Promise(ok=>setTimeout(ok,2100));
 r=await request('c','/api/games/signal',{pick:2});assert.equal(r.status,200);assert.equal(r.data.correct?r.data.reward===180:r.data.reward===0,true);
 console.log('PASS: private/public list, protected join, two-player host-only start, simultaneous picks, free score on win, 0 on loss, rematch, room leave, math and signal');
}catch(e){console.error('FAIL:',e,'\nERRS:',output);process.exitCode=1;}finally{sv.kill();fs.rmSync(tmp,{recursive:true,force:true})}})();
