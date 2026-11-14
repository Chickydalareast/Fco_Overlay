import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createStore} from '../server/state.mjs';
import {upgradeWebSocket} from '../server/websocket.mjs';

const command=(type,extras={})=>({id:`cmd-${crypto.randomUUID()}`,type,...extras});

test('all-camera LIVE cue is atomic, persistent and independent of manual BO score',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fc-v03e-group-'));
  try{
    const file=path.join(temp,'program.json');
    const store=createStore(file);
    const before=store.get();
    const flags=()=>Object.values(store.get().cameras.slots).map(x=>x.visible);
    const on=await store.command(command('camera.setAllVisible',{visible:true}));
    assert.equal(on.ok,true);
    assert.equal(on.program.revision,before.revision+1);
    assert.deepEqual(flags(),[true,true,true,true]);
    assert.equal(store.get().match.teamA.seriesWins,before.match.teamA.seriesWins);
    assert.equal(store.get().match.teamB.seriesWins,before.match.teamB.seriesWins);
    const unchanged=await store.command(command('camera.setAllVisible',{visible:true}));
    assert.equal(unchanged.unchanged,true);
    assert.equal(store.get().revision,before.revision+1);
    assert.deepEqual(Object.values(createStore(file).get().cameras.slots).map(x=>x.visible),[true,true,true,true]);
    const off=await store.command(command('camera.setAllVisible',{visible:false}));
    assert.equal(off.program.revision,before.revision+2);
    assert.deepEqual(flags(),[false,false,false,false]);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('group visibility rejects invalid values; per-camera cue still works',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fc-v03e-valid-'));
  try{
    const store=createStore(path.join(temp,'state.json'));
    const before=store.get().revision;
    const bad=await store.command(command('camera.setAllVisible',{visible:'yes'}));
    assert.equal(bad.ok,false);
    assert.equal(store.get().revision,before);
    await store.command(command('camera.setAllVisible',{visible:true}));
    await store.command(command('camera.setVisible',{slot:'B2',visible:false}));
    assert.deepEqual(Object.values(store.get().cameras.slots).map(x=>x.visible),[true,true,true,false]);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('hardened WS server supports JSON frames and rejects invalid upgrade',async()=>{
  const server=http.createServer((req,res)=>{res.writeHead(404);res.end();});
  let received=null;
  server.on('upgrade',(req,socket,head)=>{
    upgradeWebSocket(req,socket,head,{onMessage:(peer,msg)=>{received=msg;peer.send({ok:true});},onClose:()=>{}});
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const {port}=server.address();
    const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
    const reply=new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('No WS reply')),3000);
      ws.addEventListener('message',e=>{clearTimeout(timeout);resolve(JSON.parse(e.data));},{once:true});
    });
    ws.send(JSON.stringify({hello:'operator'}));
    assert.deepEqual(await reply,{ok:true});
    assert.deepEqual(received,{hello:'operator'});
    ws.close();
    const invalid=await fetch(`http://127.0.0.1:${port}/ws`,{
      headers:{Upgrade:'websocket',Connection:'Upgrade','Sec-WebSocket-Key':'invalid','Sec-WebSocket-Version':'12'}
    }).catch(()=>null);
    assert.ok(invalid===null||!invalid.ok);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
