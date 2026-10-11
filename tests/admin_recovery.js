'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jg-recovery-'));
const port=41000+Math.floor(Math.random()*10000);
const server=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),ADMIN_PASSWORD:'recovery-test-password',DATA_PATH:path.join(tmp,'data.json')},stdio:['ignore','pipe','pipe']});
let errs='';server.stderr.on('data',x=>errs+=x);
const base=`http://127.0.0.1:${port}`;
const users={owner:{},moderator:{}};
async function req(user,route,body){let h={Cookie:Object.entries(users[user]).map(([k,v])=>k+'='+v).join('; ')};if(body){h['Content-Type']='application/json';h['Origin']=base;}
 const response=await fetch(base+route,{method:body?'POST':'GET',headers:h,body:body?JSON.stringify(body):undefined});
 for(const c of response.headers.getSetCookie?.()||[]){const [k,v]=c.split(';')[0].split('=');if(k.startsWith('jg_'))users[user][k]=v;}
 return {status:response.status,data:await response.json()};
}
(async()=>{try{
 for(let i=0;i<100;i++){try{await fetch(base+'/health');break;}catch{await new Promise(r=>setTimeout(r,30))}}
 const ownerId=(await req('owner','/api/bootstrap')).data.me.id;
 assert.equal((await req('owner','/api/admin/login',{password:'recovery-test-password'})).status,200);
 assert.equal((await req('owner','/api/admin/moderate',{playerId:ownerId,action:'ban',value:true})).status,403,'self-ban must fail');
 assert.equal((await req('owner','/api/bootstrap')).data.me.banned,false);
 assert.equal((await req('moderator','/api/bootstrap')).status,200);
 assert.equal((await req('moderator','/api/admin/login',{password:'recovery-test-password'})).status,200);
 assert.equal((await req('moderator','/api/admin/moderate',{playerId:ownerId,action:'ban',value:true})).status,200,'other session can ban');
 assert.equal((await req('owner','/api/bootstrap')).data.me.banned,true);
 assert.equal((await req('owner','/api/games/roulette',{pick:'red'})).status,403,'banned cannot play');
 assert.equal((await req('owner','/api/admin/dashboard')).status,200,'banned with admin auth can access dashboard');
 assert.equal((await req('owner','/api/admin/moderate',{playerId:ownerId,action:'ban',value:false})).status,200,'banned admin can unban self');
 assert.equal((await req('owner','/api/bootstrap')).data.me.banned,false);
 console.log('PASS: self-ban forbidden, blocked games while banned, owner unban recovery works');
}catch(e){console.error('FAIL',e,errs);process.exitCode=1;}finally{server.kill();fs.rmSync(tmp,{recursive:true,force:true})}})();
