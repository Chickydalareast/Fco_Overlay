import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {upgradeWebSocket} from '../server/websocket.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

async function wsServer(t){
  const closes=[];const server=http.createServer((req,res)=>{res.writeHead(404);res.end();});
  server.on('upgrade',(req,socket,head)=>{
    const peer=upgradeWebSocket(req,socket,head,{onMessage:(p,msg)=>p.send({echo:msg}),onClose:()=>closes.push(Date.now())});
    if(!peer)closes.push('rejected');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(r=>server.close(r)));
  return {port:server.address().port,closes};
}
const open=port=>new Promise((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);ws.onopen=()=>resolve(ws);ws.onerror=reject;});
const next=ws=>new Promise(resolve=>ws.addEventListener('message',e=>resolve(JSON.parse(e.data)),{once:true}));
const closed=ws=>new Promise(resolve=>ws.addEventListener('close',e=>resolve(e.code),{once:true}));

test('ws library transport: JSON round trip, invalid JSON warning, oversize message closes with 1009',async t=>{
  const {port}=await wsServer(t);
  const ws=await open(port);
  let reply=next(ws);ws.send(JSON.stringify({hello:'operator'}));
  assert.deepEqual(await reply,{echo:{hello:'operator'}});
  reply=next(ws);ws.send('{not json');
  assert.equal((await reply).type,'command.error');
  const code=closed(ws);ws.send('x'.repeat(70*1024));
  assert.equal(await code,1009);
});

test('ws library transport rejects a non-WebSocket upgrade',async t=>{
  const {port,closes}=await wsServer(t);
  const status=await new Promise(resolve=>{
    const req=http.request({host:'127.0.0.1',port,path:'/ws',headers:{Upgrade:'websocket',Connection:'Upgrade','Sec-WebSocket-Key':'bad','Sec-WebSocket-Version':'12'}});
    req.on('response',res=>{res.resume();resolve(res.statusCode);});
    req.on('upgrade',()=>resolve(101));req.on('error',()=>resolve('error'));req.end();
  });
  assert.notEqual(status,101,'invalid handshake must not be upgraded');
  await new Promise(r=>setTimeout(r,50));
  assert.ok(closes.includes('rejected'));
});

test('LiveKit SDK is served locally with a matching SRI hash; no CDN left',()=>{
  const file=path.join(ROOT,'public','vendor','livekit-client-2.23.0.umd.js');
  const sri=`sha384-${crypto.createHash('sha384').update(fs.readFileSync(file)).digest('base64')}`;
  for(const page of ['studio.html','output.html','room.html']){
    const html=fs.readFileSync(path.join(ROOT,'public',page),'utf8');
    assert.ok(html.includes(`src="/vendor/livekit-client-2.23.0.umd.js" integrity="${sri}"`),page);
    assert.ok(!html.includes('jsdelivr'),page);
  }
  assert.ok(!fs.readFileSync(path.join(ROOT,'server','index.mjs'),'utf8').includes('cdn.jsdelivr.net'));
});

test('server: deep health, proxy-aware rate limit, immutable vendor cache, hidden secrets in logs',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fco-v03g-'));
  const port=40000+Math.floor(Math.random()*20000);
  const child=spawn(process.execPath,[path.join(ROOT,'server','index.mjs')],{
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',FC_DB_FILE:path.join(dir,'db.sqlite'),FC_SECRETS_FILE:path.join(dir,'secrets.json'),
      FC_STATE_FILE:path.join(dir,'program.json'),FC_TRUST_PROXY:'1',FC_HIDE_SECRETS:'1',FC_ADMIN_PASSWORD:'admin123',
      LIVEKIT_URL:'',LIVEKIT_API_KEY:'',LIVEKIT_API_SECRET:''},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',d=>{log+=d;});child.stderr.on('data',d=>{log+=d;});
  t.after(async()=>{
    // Windows keeps the SQLite file locked until the child has really exited.
    if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
    try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}catch{/* temp folder; OS cleans it */}
  });
  const base=`http://127.0.0.1:${port}`;
  let health=null;
  for(let i=0;i<50&&!health;i++){await new Promise(r=>setTimeout(r,100));health=await fetch(base+'/api/health').then(r=>r.json()).catch(()=>null);}
  assert.ok(health,'server started');
  assert.equal(health.status,'ok');assert.equal(health.database,'ok');assert.equal(health.version,JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version);
  assert.equal(health.livekit,'not-configured');assert.equal(typeof health.memoryMB,'number');
  const login=(ip,password)=>fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':`9.9.9.9, ${ip}`},body:JSON.stringify({password})});
  for(let i=0;i<10;i++)assert.equal((await login('1.1.1.1','wrong')).status,401);
  assert.equal((await login('1.1.1.1','wrong')).status,429,'same client is limited');
  assert.equal((await login('2.2.2.2','admin123')).status,200,'another client behind the proxy is not');
  const vendor=await fetch(base+'/vendor/livekit-client-2.23.0.umd.js');
  assert.match(vendor.headers.get('cache-control'),/immutable/);
  const studio=await fetch(base+'/studio');
  assert.ok(!studio.headers.get('content-security-policy').includes('jsdelivr'));
  assert.match(log,/OBS URL: \(hidden/);
  const secrets=JSON.parse(fs.readFileSync(path.join(dir,'secrets.json'),'utf8'));
  assert.ok(!log.includes(secrets.output),'output token never printed');
});
