import './load-env.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { upgradeWebSocket } from './websocket.mjs';
import { createStore } from './state.mjs';
import { createCameraService } from './camera-room.mjs';
import { openTournamentDB } from './tournament-db.mjs';
import {scheduleBackup,flushBackups} from './backup-scheduler.mjs';
import { acceptRendererReady, acceptRendererMedia, rendererInfo } from './renderer-sync.mjs';

const VERSION='0.5.6';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PUBLIC = path.join(ROOT,'public');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
// Use this behind HTTPS reverse proxies; never trust client-supplied forwarded
// host/protocol headers for generating invite or OBS URLs.
const PUBLIC_ORIGIN=(process.env.FC_PUBLIC_ORIGIN||'').replace(/\/$/,'');
// Behind Caddy/Nginx on the same machine every request comes from 127.0.0.1.
// FC_TRUST_PROXY=1 makes rate limits use the client IP the proxy appended.
const TRUST_PROXY=process.env.FC_TRUST_PROXY==='1';
// Do not print bearer tokens into service logs (journalctl) on a server.
const HIDE_SECRETS=process.env.FC_HIDE_SECRETS==='1' || !!PUBLIC_ORIGIN;
if(PUBLIC_ORIGIN){
  const parsed=new URL(PUBLIC_ORIGIN);
  if(parsed.origin!==PUBLIC_ORIGIN || !['http:','https:'].includes(parsed.protocol) ||
     (parsed.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(parsed.hostname))) {
    throw new Error('FC_PUBLIC_ORIGIN must be a complete HTTPS origin (e.g. https://overlay.example.com)');
  }
}

// v0.3F: keep the live server up. Log unexpected errors instead of letting a
// single bad request kill the process in the middle of a broadcast.
process.on('unhandledRejection',error=>console.error('[server] Unhandled rejection:',error));
process.on('uncaughtException',error=>console.error('[server] Uncaught exception:',error));

const SESSION_FILE = process.env.FC_SECRETS_FILE ? path.resolve(process.env.FC_SECRETS_FILE) : path.join(ROOT,'.runtime','secrets.json');
let secrets = {};
try { secrets=JSON.parse(fs.readFileSync(SESSION_FILE,'utf8')); } catch { /* generated on first boot */ }
if (!secrets.output || !secrets.cameraInvite) {
  secrets.output ||= crypto.randomBytes(24).toString('base64url');
  secrets.cameraInvite ||= crypto.randomBytes(20).toString('base64url');
  fs.mkdirSync(path.dirname(SESSION_FILE),{recursive:true});
  fs.writeFileSync(SESSION_FILE,JSON.stringify(secrets,null,2),{mode:0o600});
}
// Operator request (v0.3F): simple shared Studio password. Override with
// FC_ADMIN_PASSWORD in .env if the server is ever exposed for longer.
const ADMIN_PASSWORD = process.env.FC_ADMIN_PASSWORD || 'admin123';
const OUTPUT_TOKEN = process.env.FC_OUTPUT_TOKEN || secrets.output;
const SESSION_MS=24*60*60*1000;
const tournamentDb = openTournamentDB();
try { tournamentDb.backup('startup'); } catch(error) { console.warn('[db] Startup backup skipped:',error.message); }
const store = createStore(process.env.FC_STATE_FILE ? path.resolve(process.env.FC_STATE_FILE) : path.join(ROOT,'.runtime','program.json'),{database:tournamentDb});
const camera = createCameraService({
  inviteSecret:process.env.FC_CAMERA_INVITE || secrets.cameraInvite,
  livekitUrl:process.env.LIVEKIT_URL || '',livekitKey:process.env.LIVEKIT_API_KEY || '',
  livekitSecret:process.env.LIVEKIT_API_SECRET || '',roomName:process.env.FC_LIVEKIT_ROOM || 'fc-online-camera-primary',
  getProgram:()=>store.get(),registry:()=>tournamentDb.registry(),store:tournamentDb.cameraRequests
});
camera.syncSession();
const joinAttempts=new Map();
const loginAttempt = new Map();
const presenceTimers=new Map();
const clients = new Map();
const upgradeAttempts=new Map();
const sidHash=sid=>crypto.createHash('sha256').update(sid).digest('hex');
const LOOPBACK=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
function clientIp(req) {
  const direct=req.socket.remoteAddress||'unknown';
  if (!TRUST_PROXY || !LOOPBACK.has(direct)) return direct;
  // Rightmost X-Forwarded-For entry = address the local proxy itself saw.
  const forwarded=String(req.headers['x-forwarded-for']||'').split(',').map(x=>x.trim()).filter(Boolean);
  return forwarded.at(-1)||direct;
}
// Daily consistent DB copy while the server keeps running (in addition to
// startup / new-BO backups). Keeps the newest 20 files in .runtime/db-backups.
const backupTimer=setInterval(()=>{void scheduleBackup(tournamentDb.path,'daily').catch(error=>console.warn('[db] Daily backup skipped:',error.message));},24*60*60*1000);
backupTimer.unref?.();
// Bounded in-memory housekeeping for small 1-operator events; prune idle IPs.
const cleanupTimer=setInterval(()=>{
  const now=Date.now();
  for(const map of [joinAttempts,loginAttempt,upgradeAttempts])for(const [ip,times] of map){const recent=times.filter(t=>now-t<60_000);if(recent.length)map.set(ip,recent);else map.delete(ip);}
  try{tournamentDb.adminSessions.prune(now);}catch{}
},60_000);cleanupTimer.unref?.();
let processing = Promise.resolve();

function equals(a,b) {
  const x=Buffer.from(typeof a==='string'?a:''),y=Buffer.from(typeof b==='string'?b:'');
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
function cookies(req) {
  const parsed = {};
  for (const entry of (req.headers.cookie||'').split(';')) {
    const index=entry.indexOf('=');
    if (index!==-1) parsed[entry.slice(0,index).trim()]=entry.slice(index+1).trim();
  }
  return parsed;
}
function isAdmin(req) {
  const sid=cookies(req).fc_session;
  if (!sid || sid.length>100) return false;
  // Sessions live in SQLite: a Node restart no longer logs the operator out.
  try { return tournamentDb.adminSessions.valid(sidHash(sid),Date.now()); } catch { return false; }
}
function sameOrigin(req) {
  if (!req.headers.origin) return true; // non-browser clients have no Origin header
  try {
    const origin=new URL(req.headers.origin);
    const expected=PUBLIC_ORIGIN?new URL(PUBLIC_ORIGIN):new URL(`http://${req.headers.host||'localhost'}`);
    return origin.host===expected.host && (PUBLIC_ORIGIN?origin.protocol===expected.protocol: ['http:','https:'].includes(origin.protocol));
  }catch{return false;}
}
function externalOrigin(req) {
  // For a VPS behind a reverse proxy, set FC_PUBLIC_ORIGIN in .env.
  // The request's X-Forwarded-* headers are intentionally ignored.
  return PUBLIC_ORIGIN||`${req.socket.encrypted?'https':'http'}://${req.headers.host||`localhost:${PORT}`}`;
}
function respond(res,status,data,extra={}) {
  if (res.headersSent) { try{res.end();}catch{} return; }
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    ...extra
  });
  res.end(JSON.stringify(data));
}
async function getBody(req) {
  let buffer='';
  for await (const chunk of req) {
    buffer+=chunk;
    if (Buffer.byteLength(buffer,'utf8')>4096) throw new Error('Request too large');
  }
  return JSON.parse(buffer||'{}');
}
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.webp':'image/webp',
  '.png':'image/png', '.jpg':'image/jpeg', '.woff2':'font/woff2', '.ico':'image/x-icon'
};
function afterCameraChange() {
  broadcastRequests();broadcastRoster();enforcePlayerSessions();
}
async function handle(req,res) {
  let url;
  try {url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);}
  catch {return respond(res,400,{error:'Invalid URL'});}
  if(req.url && req.url.length>4096)return respond(res,414,{error:'URI too long'});
  if(req.method==='GET' && url.pathname==='/api/health') {
    // For uptime monitors: 503 when SQLite is not answering.
    let database='ok';
    try { tournamentDb.ping(); } catch { database='error'; }
    const roles=[...clients.values()].reduce((n,c)=>{n[c.role]=(n[c.role]||0)+1;return n;},{});
    return respond(res,database==='ok'?200:503,{status:database==='ok'?'ok':'degraded',version:VERSION,
      uptimeSeconds:Math.floor(process.uptime()),revision:store.get().revision,database,
      livekit:camera.enabled?'configured':'not-configured',connections:roles,
      memoryMB:Math.round(process.memoryUsage().rss/1048576)});
  }
  if (req.method==='GET' && url.pathname==='/api/tournament/registry') {
    if (!isAdmin(req)) return respond(res,401,{error:'Unauthorized'});
    return respond(res,200,tournamentDb.registry());
  }
  if(url.pathname==='/api/bo/current' && req.method==='GET'){
    if(!isAdmin(req))return respond(res,401,{error:'Unauthorized'});
    const id=store.get().match.matchId;
    return respond(res,200,{match:id?tournamentDb.getMatch(id):null});
  }
  if (url.pathname==='/api/matches' && req.method==='GET') {
    if (!isAdmin(req)) return respond(res,401,{error:'Unauthorized'});
    return respond(res,200,{matches:tournamentDb.listMatches()});
  }
  if (url.pathname==='/api/matches' && req.method==='POST') {
    if (!isAdmin(req)) return respond(res,401,{error:'Unauthorized'});
    if (!sameOrigin(req)) return respond(res,403,{error:'Bad origin'});
    try {const data=await getBody(req);return respond(res,201,{match:tournamentDb.createMatch(data)});}
    catch(error){return respond(res,400,{error:error.message});}
  }
  const gamePath=url.pathname.match(/^\/api\/matches\/(match-[a-zA-Z0-9-]+)\/(games|audit)$/);
  if (gamePath && req.method==='GET') {
    if (!isAdmin(req) && !(gamePath[2]==='games' && equals(url.searchParams.get('outputToken'),OUTPUT_TOKEN))) return respond(res,401,{error:'Unauthorized'});
    try{return respond(res,200,gamePath[2]==='games'?tournamentDb.getGameResults(gamePath[1]):{audit:tournamentDb.getGameAudit(gamePath[1])});}
    catch(error){return respond(res,404,{error:error.message});}
  }
  if (gamePath && gamePath[2]==='games' && req.method==='PUT') {
    if (!isAdmin(req)) return respond(res,401,{error:'Unauthorized'});
    if (!sameOrigin(req)) return respond(res,403,{error:'Bad origin'});
    try {const data=await getBody(req);const game=tournamentDb.saveGameResult({...data,matchId:gamePath[1],operator:'studio'});
      for(const entry of clients.values()) if(entry.role==='admin'||entry.role==='output')entry.peer.send({type:'match.history.changed',matchId:gamePath[1],gameNumber:game.gameNumber});
      if(store.get().match.matchId===gamePath[1])broadcastHistory();
      return respond(res,200,{game});}
    catch(error){const conflict=/STALE_GAME_VERSION/.test(error.message);return respond(res,conflict?409:400,{error:error.message});}
  }
  if (req.method==='GET' && url.pathname==='/api/camera/config') return respond(res,200,camera.getConfig());
  if (req.method==='GET' && url.pathname==='/api/camera/invite-url') {
    if (!isAdmin(req)) return respond(res,401,{error:'Unauthorized'});
    const invitePath=camera.getInvitePath();
    if(!invitePath)return respond(res,409,{error:'Select two registry teams and TAKE to start the current BO before copying a Player Room link.'});
    return respond(res,200,{url:`${externalOrigin(req)}${invitePath}`});
  }
  if (req.method==='GET' && url.pathname==='/api/camera/room-options') {
    const result=camera.getOptions({invite:url.searchParams.get('invite'),boId:url.searchParams.get('bo')});
    return respond(res,result.error?403:200,result);
  }
  if (req.method==='POST' && url.pathname==='/api/camera/join') {
    if (!sameOrigin(req)) return respond(res,403,{error:'Bad origin'});
    const ip=clientIp(req);
    const recent=(joinAttempts.get(ip)||[]).filter(t=>Date.now()-t<60000);
    if (recent.length>=12)return respond(res,429,{error:'Too many join attempts'});
    recent.push(Date.now());joinAttempts.set(ip,recent);
    try {
      const payload=await getBody(req);const result=camera.requestJoin(payload);
      if(!result.error){broadcastRequests();broadcastRoster();}
      return respond(res,result.error?400:202,result);
    } catch {return respond(res,400,{error:'Invalid join request'});}
  }
  if(req.method==='POST' && url.pathname==='/api/camera/cancel') {
    if(!sameOrigin(req))return respond(res,403,{error:'Bad origin'});
    try{const result=camera.cancelRequest(await getBody(req));if(!result.error)afterCameraChange();
      return respond(res,result.error?400:200,result);
    }catch{return respond(res,400,{error:'Invalid cancellation'});}
  }
  if(req.method==='GET' && url.pathname==='/api/camera/join-status') {
    const result=camera.getRequestStatus({requestId:url.searchParams.get('requestId'),claim:url.searchParams.get('claim')});
    return respond(res,result.error&& !result.status?404:200,result);
  }
  if(req.method==='GET' && url.pathname==='/api/camera/requests') {
    if(!isAdmin(req))return respond(res,401,{error:'Unauthorized'});
    return respond(res,200,{requests:camera.pending()});
  }
  if(req.method==='POST' && url.pathname==='/api/camera/review') {
    if(!isAdmin(req))return respond(res,401,{error:'Unauthorized'});
    if(!sameOrigin(req))return respond(res,403,{error:'Bad origin'});
    try {
      const result=camera.reviewRequest(await getBody(req));
      if(!result.error)afterCameraChange();
      return respond(res,result.error?400:200,result);
    }catch{return respond(res,400,{error:'Invalid camera review'});}
  }
  if(req.method==='POST' && url.pathname==='/api/camera/revoke') {
    if(!isAdmin(req))return respond(res,401,{error:'Unauthorized'});
    if(!sameOrigin(req))return respond(res,403,{error:'Bad origin'});
    try {
      const result=camera.revoke(await getBody(req));
      if(!result.error)afterCameraChange();
      return respond(res,result.error?400:200,result);
    }catch{return respond(res,400,{error:'Invalid revoke request'});}
  }
  if (req.method==='GET' && url.pathname==='/api/camera/viewer-token') {
    if (!isAdmin(req) && !equals(url.searchParams.get('outputToken'),OUTPUT_TOKEN)) return respond(res,401,{error:'Unauthorized'});
    const result=camera.issueViewer();
    return result?respond(res,200,result):respond(res,503,{error:'No current BO or LiveKit is not configured'});
  }
  if (req.method==='GET' && url.pathname==='/api/camera/admin-token') {
    // v0.4D: BTC room. Same Studio login; unlimited operators.
    if (!isAdmin(req)) return respond(res,401,{error:'Unauthorized'});
    const result=camera.issueAdmin();
    return result?respond(res,200,result):respond(res,503,{error:'No current BO or LiveKit is not configured'});
  }
  if (req.method==='POST' && url.pathname==='/api/login') {
    if (!sameOrigin(req)) return respond(res,403,{error:'Bad origin'});
    const key = clientIp(req);
    const recent = (loginAttempt.get(key)||[]).filter(t=>Date.now()-t<60000);
    if (recent.length>=10) return respond(res,429,{error:'Too many attempts'});
    try {
      const body=await getBody(req);
      if (!equals(body.password,ADMIN_PASSWORD)) {
        recent.push(Date.now());loginAttempt.set(key,recent);
        return respond(res,401,{error:'Sai mật khẩu Studio'});
      }
      loginAttempt.delete(key);
      const sid=crypto.randomBytes(32).toString('base64url');
      tournamentDb.adminSessions.add(sidHash(sid),Date.now()+SESSION_MS);
      return respond(res,200,{ok:true},{
        'Set-Cookie':`fc_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS/1000}${(PUBLIC_ORIGIN.startsWith('https://')||req.socket.encrypted)?'; Secure':''}`
      });
    } catch { return respond(res,400,{error:'Bad request'}); }
  }
  if (req.method==='POST' && url.pathname==='/api/logout') {
    const sid=cookies(req).fc_session;
    if (sid) try{tournamentDb.adminSessions.remove(sidHash(sid));}catch{}
    return respond(res,200,{ok:true},{'Set-Cookie':'fc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
  }
  if (req.method==='GET' && url.pathname==='/api/me') return respond(res,200,{authenticated:isAdmin(req)});
  if (req.method==='GET' && url.pathname==='/api/obs-url') {
    if (!isAdmin(req)) return respond(res,401,{error:'Unauthorized'});
    return respond(res,200,{url:`${externalOrigin(req)}/output?token=${encodeURIComponent(OUTPUT_TOKEN)}&label=OBS`});
  }
  if (req.method!=='GET' && req.method!=='HEAD') return respond(res,405,{error:'Method not allowed'});
  let resource = url.pathname;
  if (resource==='/' || resource==='/studio') resource='/studio.html';
  if (resource==='/room') resource='/room.html';
  if (resource==='/admin-room') resource='/admin-room.html';
  if (resource==='/output' || resource==='/output.html') {
    if (!equals(url.searchParams.get('token'),OUTPUT_TOKEN)) {
      res.writeHead(403,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
      return res.end('Output token is missing or invalid. Copy the OBS URL from Studio.');
    }
    resource='/output.html';
  }
  let decoded;
  try { decoded=decodeURIComponent(resource); } catch { return respond(res,400,{error:'Invalid path'}); }
  const absolute=path.resolve(PUBLIC,`.${decoded}`);
  if (absolute!==PUBLIC && !absolute.startsWith(PUBLIC+path.sep)) return respond(res,403,{error:'Forbidden'});
  let stats;
  try { stats=await fs.promises.stat(absolute); } catch { return respond(res,404,{error:'Not found'}); }
  if (!stats.isFile()) return respond(res,404,{error:'Not found'});
  const etag=`W/"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`;
  const isHtml=resource.endsWith('.html');
  // Bundle paths are unversioned: revalidation avoids stale OBS JS while
  // returning 304 for unchanged logo/font/JS/CSS without retransmission.
  const headers={
    'Content-Type':MIME[path.extname(absolute).toLowerCase()]||'application/octet-stream',
    // /vendor/ files carry their version in the file name: cache them for a year.
    'Cache-Control':isHtml?'no-store':decoded.startsWith('/vendor/')?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate',
    'ETag':etag,
    'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'SAMEORIGIN',
    // Only the BTC room may use the microphone / capture app audio (v0.4D).
    'Permissions-Policy':resource==='/admin-room.html'?'camera=(), microphone=(self), display-capture=(self)':'camera=(self), microphone=(), display-capture=()',
    'Content-Security-Policy':"default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https: wss: ws:; media-src 'self' blob: mediastream:; worker-src 'self' blob:; font-src 'self' data:; frame-ancestors 'self'"
  };
  if(!isHtml && req.headers['if-none-match']===etag){res.writeHead(304,headers);return res.end();}
  res.writeHead(200,headers);
  if (req.method==='HEAD') return res.end();
  // A missing/locked file mid-stream must not crash the server (v0.3F A5).
  const stream=fs.createReadStream(absolute);
  stream.on('error',()=>{try{res.destroy();}catch{}});
  stream.pipe(res);
}
const server = http.createServer((req,res)=>{
  handle(req,res).catch(error=>{
    console.error('[http] Request failed:',error);
    try{respond(res,500,{error:'Internal error'});}catch{}
  });
});

function historyEvent() {
  const matchId=store.get().match.matchId||null;
  if(!matchId)return {type:'match.history.snapshot',matchId:null,leftTeamId:null,rightTeamId:null,games:[]};
  try {
    const history=tournamentDb.getGameResults(matchId);
    return {type:'match.history.snapshot',matchId,leftTeamId:history.match.leftTeamId,rightTeamId:history.match.rightTeamId,games:history.games};
  } catch {return {type:'match.history.snapshot',matchId:null,leftTeamId:null,rightTeamId:null,games:[]};}
}
function broadcastHistory() {
  const event=historyEvent();
  for(const client of clients.values()) if(client.role==='admin'||client.role==='output')client.peer.send(event);
}
function renderers() {
  return [...clients.values()].filter(x=>x.role==='output').map(x=>rendererInfo(x,store.get()));
}
function presence() {
  const list=[...clients.values()];
  const outputs=renderers();
  const message={type:'presence',rendererCount:outputs.length,adminCount:list.filter(x=>x.role==='admin').length,
    rendererRevision:outputs.reduce((n,r)=>Math.max(n,r.revision??-1),-1),renderers:outputs};
  list.filter(x=>x.role==='admin').forEach(x=>x.peer.send(message));
}
function broadcastRoster() {
  const players=camera.roster();
  for (const entry of clients.values()) if (entry.role==='admin' || entry.role==='output') entry.peer.send({type:'camera.roster',players});
}
function broadcastRequests() {
  const requests=camera.pending();
  for(const entry of clients.values()) if(entry.role==='admin')entry.peer.send({type:'camera.requests',requests});
}
/** Close player tabs whose session was revoked, replaced or belongs to an old BO. */
function enforcePlayerSessions() {
  for(const c of clients.values()){
    if(c.role!=='player')continue;
    if(camera.authenticatePlayer(c.playerSession)!==c.playerId){
      c.peer.send({type:'camera.session.ended'});
      setTimeout(()=>{try{c.peer.close(4001);}catch{}},300);
    }
  }
}
function broadcast(event) {
  for (const client of clients.values()) if(client.role!=='player') client.peer.send(event);
}
server.on('upgrade',(req,socket,head)=>{
  socket.on('error',()=>{});
  if(clients.size>=40 || (req.url?.length??0)>4096){socket.destroy();return;}
  const ip=clientIp(req);
  const recent=(upgradeAttempts.get(ip)||[]).filter(t=>Date.now()-t<60_000);
  if(recent.length>=90){socket.destroy();return;}
  recent.push(Date.now());upgradeAttempts.set(ip,recent);
  let url;
  try {url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);}
  catch {socket.destroy();return;}
  if (url.pathname!=='/ws' || !sameOrigin(req)) { socket.destroy();return; }
  const role=url.searchParams.get('role');
  const playerSession=url.searchParams.get('session');
  const playerId=role==='player'?camera.authenticatePlayer(playerSession):null;
  const allowed=role==='admin'?isAdmin(req):role==='output'?equals(url.searchParams.get('token'),OUTPUT_TOKEN):role==='player' && !!playerId;
  if (!allowed) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();return; }
  const rendererId=crypto.randomBytes(5).toString('hex');
  const label=role==='output'?(url.searchParams.get('label')||'output').replace(/[^\w .-]/g,'').slice(0,24)||'output':null;
  const peer=upgradeWebSocket(req,socket,head,{
    onMessage:(peer,message)=>{
      if (role==='player') {
        if (message?.type==='camera.status' && typeof message.published==='boolean') {
          camera.updatePlayer(playerId,{connected:true,published:message.published});
          broadcastRoster();
        }
        return;
      }
      if (role==='output') {
        const entry=clients.get(peer);
        if(message?.type==='renderer.ready'&&entry&&acceptRendererReady(entry,message.revision,store.get().revision)){
          for(const c of clients.values())if(c.role==='admin')c.peer.send({type:'renderer.ack',revision:message.revision,rendererId,label});
          presence();
        }else if(message?.type==='renderer.media'&&entry&&acceptRendererMedia(entry,message,store.get())){
          presence();
        }
        return;
      }
      // Admin-only, non-state hint: Preview cameras are being staged, so OBS
      // may connect to LiveKit early and avoid a placeholder on the LIVE cue.
      if (message?.type==='camera.prewarm') {
        const program=store.get();
        if(!program.match.matchId||message.boId!==program.match.matchId)return;
        // The hint is only for members of the current BO. Never prewarm an
        // unrelated/new BO room before its TAKE actually starts that session.
        const ids=new Set([program.match.teamA.teamId,program.match.teamB.teamId]
          .filter(Boolean).flatMap(team=>[`${team}-P1`,`${team}-P2`]));
        const requested=Array.isArray(message.playerIds)?message.playerIds:[];
        const playerIds=[...new Set(requested.filter(id=>typeof id==='string'&&ids.has(id)))];
        if(!playerIds.length)return;
        for(const c of clients.values())if(c.role==='output')c.peer.send({type:'camera.prewarm',boId:program.match.matchId,playerIds});
        return;
      }
      processing=processing.then(async()=>{
        try {
          const result=await store.command(message);
          if (!result.ok) { peer.send({type:'command.error',id:message?.id,reason:result.reason});return; }
          peer.send({type:'command.ack',id:message.id,revision:result.program.revision});
          if (!result.unchanged && !result.duplicate) {
            broadcast({type:'program.state',program:result.program,commandId:message.id});
            if (result.boChanged) {
              camera.syncSession();
              broadcastHistory();
              // Keep HTTP/WS responsive during larger VACUUM INTO backups.
              void scheduleBackup(tournamentDb.path,'bo-change').catch(error=>console.warn('[db] Backup skipped:',error.message));
            }
            if (result.boChanged || message.type==='program.take') afterCameraChange();
          }
        } catch(error) { console.error('[ws] Command failed:',error);peer.send({type:'command.error',id:message?.id,reason:'Internal error'}); }
      });
    },
    onClose:(peer)=>{
      if (clients.delete(peer)) {
        if (role==='player' && ![...clients.values()].some(c=>c.role==='player' && c.playerId===playerId)) {
          // Grace period: transient WS drop must not immediately mark the feed
          // offline. OBS itself follows LiveKit tracks, not this presence flag.
          const old=presenceTimers.get(playerId);if(old)clearTimeout(old);
          presenceTimers.set(playerId,setTimeout(()=>{
            presenceTimers.delete(playerId);
            if (![...clients.values()].some(c=>c.role==='player'&&c.playerId===playerId)) {
              camera.updatePlayer(playerId,{connected:false,published:false});broadcastRoster();
            }
          },5000));
        }
        presence();
      }
    }
  });
  if (!peer) return;
  clients.set(peer,{peer,role,rendererId,label,playerId,playerSession:role==='player'?playerSession:null,
    revision:null,mediaRevision:null,cameraReady:[],cameraWaiting:[]});
  if (role==='admin') {
    peer.send({type:'program.state',program:store.get()});
    peer.send({type:'camera.roster',players:camera.roster()});
    peer.send({type:'camera.requests',requests:camera.pending()});
    peer.send(historyEvent());
  } else if (role==='output') {
    peer.send({type:'program.state',program:store.get()});
    peer.send({type:'camera.roster',players:camera.roster()});
    peer.send(historyEvent());
  }
  else {
    const prior=presenceTimers.get(playerId);if(prior){clearTimeout(prior);presenceTimers.delete(playerId);}
    camera.updatePlayer(playerId,{connected:true});
    broadcastRoster();
  }
  presence();
});

server.headersTimeout=10_000;
server.requestTimeout=15_000;
server.keepAliveTimeout=5_000;
server.maxConnections=80;
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{
  clearInterval(cleanupTimer);clearInterval(backupTimer);
  for(const client of clients.values())try{client.peer.close(1001);}catch{}
  server.close(async()=>{try{await flushBackups();tournamentDb.close();}finally{process.exit(0);}});
  setTimeout(()=>process.exit(1),5000).unref();
});
server.listen(PORT,HOST,()=>{
  const url=`http://${HOST}:${PORT}`;
  console.log('\n  FC ONLINE — GRAPHICS STUDIO v0.5G');
  console.log(`  Tournament DB: ${tournamentDb.path} (${tournamentDb.counts().teams} teams, ${tournamentDb.counts().players} players)`);
  console.log(`  Studio:  ${url}/studio`);
  console.log(`  Password: ${process.env.FC_ADMIN_PASSWORD?'(from FC_ADMIN_PASSWORD in .env)':'admin123'}`);
  console.log(HIDE_SECRETS?'  OBS URL: (hidden — use "Copy OBS URL" in Studio)':`  OBS URL: ${url}/output?token=${OUTPUT_TOKEN}&label=OBS`);
  console.log(`  Player camera: ${camera.enabled?'CONFIGURED':'Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET in .env'}`);
  console.log(`  Public origin: ${PUBLIC_ORIGIN||'(unset — local only)'}${TRUST_PROXY?' · trusting local reverse proxy':''}`);
  console.log('  Note: For public VPS, configure HTTPS and FC_PUBLIC_ORIGIN before using invite/OBS links.\n');
});
