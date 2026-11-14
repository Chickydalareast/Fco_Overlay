import { WebSocketServer } from 'ws';

const MAX_MESSAGE_BYTES=64*1024;
const MAX_SOCKET_BACKLOG=256*1024;
const PING_MS=25_000;
const TIMEOUT_MS=65_000;

// v0.3G: the RFC6455 protocol (handshake, framing, masking, fragmentation,
// UTF-8, close codes) is handled by the maintained `ws` library. This module
// keeps the small app-level API used by server/index.mjs: JSON messages,
// heartbeat, payload limits and backpressure protection.
const wss=new WebSocketServer({noServer:true,maxPayload:MAX_MESSAGE_BYTES,perMessageDeflate:false,clientTracking:false});

/**
 * Upgrade one HTTP request. Returns a peer {send(obj), close(code)} or null if
 * the handshake was rejected (the socket is then already answered/closed).
 */
export function upgradeWebSocket(request,socket,head,{onMessage,onClose}) {
  let ws=null;
  let closeEmitted=false;
  let invalidMessages=0;
  let lastSeen=Date.now();
  let heartbeat=null;
  const peer={
    send(message){
      if(!ws||ws.readyState!==ws.OPEN)return false;
      // A stalled client (e.g. sleeping laptop) must not grow server memory.
      if(ws.bufferedAmount>MAX_SOCKET_BACKLOG){ws.terminate();return false;}
      const payload=JSON.stringify(message);
      if(Buffer.byteLength(payload)>MAX_MESSAGE_BYTES){ws.close(1009,'Message too large');return false;}
      ws.send(payload);
      return true;
    },
    close(code=1000){
      if(!ws)return;
      try{ws.close(code);}catch{ws.terminate();}
    }
  };
  const emitClose=()=>{
    if(closeEmitted)return;
    closeEmitted=true;clearInterval(heartbeat);onClose(peer);
  };
  try {
    // With no verifyClient hook, ws completes the upgrade synchronously and
    // calls back immediately; an invalid handshake is answered with 400.
    wss.handleUpgrade(request,socket,head,(client)=>{ws=client;});
  } catch { socket.destroy(); return null; }
  if(!ws)return null;
  ws.on('message',(data,isBinary)=>{
    lastSeen=Date.now();
    if(isBinary){ws.close(1003,'Text JSON only');return;}
    let parsed;
    try{parsed=JSON.parse(data.toString('utf8'));}
    catch{
      if(++invalidMessages>=3){ws.close(1007,'Invalid JSON');return;}
      peer.send({type:'command.error',reason:'Invalid JSON or UTF-8 encoding'});
      return;
    }
    invalidMessages=0;
    try{onMessage(peer,parsed);}catch(error){console.error('[ws] Handler error:',error);}
  });
  ws.on('pong',()=>{lastSeen=Date.now();});
  ws.on('ping',()=>{lastSeen=Date.now();});
  ws.on('close',emitClose);
  // On a protocol error (e.g. message > 64 KiB) ws already sends the proper
  // close frame (1009, 1007...). Terminating here would cut the TCP socket
  // before that frame arrives (seen on Windows as 1006). 'close' always follows.
  ws.on('error',()=>{});
  heartbeat=setInterval(()=>{
    if(Date.now()-lastSeen>TIMEOUT_MS){ws.terminate();return;}
    try{ws.ping();}catch{}
  },PING_MS);
  heartbeat.unref?.();
  return peer;
}
