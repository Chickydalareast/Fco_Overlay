/** Runs VACUUM INTO away from the HTTP / WebSocket event loop. */
import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const {dbFile,reason,keep=20}=workerData;
let db;
try {
  const dir=path.join(path.dirname(dbFile),'db-backups');
  fs.mkdirSync(dir,{recursive:true});
  const stamp=new Date().toISOString().replace(/[-:.Z]/g,'');
  const tag=String(reason).replace(/[^a-z0-9-]/gi,'').slice(0,24)||'backup';
  const file=path.join(dir,`fc-online_${stamp}_${tag}.sqlite`);
  db=new DatabaseSync(dbFile,{timeout:5000});
  // SQLite creates a consistent snapshot even with concurrent WAL readers/writers.
  db.prepare('VACUUM INTO ?').run(file);
  db.close();db=null;
  const old=fs.readdirSync(dir).filter(f=>/^fc-online_.*\.sqlite$/.test(f)).sort();
  for(const f of old.slice(0,Math.max(0,old.length-keep)))fs.rmSync(path.join(dir,f),{force:true});
  parentPort.postMessage({ok:true,file});
} catch(error){
  try{db?.close();}catch{}
  parentPort.postMessage({ok:false,error:error instanceof Error?error.message:String(error)});
}
