/** Synthetic, self-contained SQLite checkpoint/backup benchmark (never touches .runtime). */
import {DatabaseSync} from 'node:sqlite';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openTournamentDB} from '../server/tournament-db.mjs';
import {scheduleBackup} from '../server/backup-scheduler.mjs';

const work=fs.mkdtempSync(path.join(os.tmpdir(),'fco-v05f-bench-'));
let db;
try {
  db=openTournamentDB({dbFile:path.join(work,'fixture.sqlite')});
  const native=new DatabaseSync(db.path);
  native.exec('CREATE TABLE IF NOT EXISTS benchmark_payload (id INTEGER PRIMARY KEY,data BLOB)');
  const insert=native.prepare('INSERT INTO benchmark_payload(data) VALUES(?)');
  const chunks=Number(process.env.FC_BENCH_CHUNKS||2500);
  const data=Buffer.alloc(2048,0x61);
  native.exec('BEGIN');for(let i=0;i<chunks;i++)insert.run(data);native.exec('COMMIT');native.close();
  const bytes=fs.statSync(db.path).size;
  const loop=monitorEventLoopDelay({resolution:10});loop.enable();
  const start=performance.now();const backup=db.backup('benchmark',4);const ms=performance.now()-start;
  await new Promise(resolve=>setTimeout(resolve,35));loop.disable();
  const saved=fs.statSync(backup).size;
  let timerMs=null;const beginAsync=performance.now();
  const task=scheduleBackup(db.path,'benchmark-worker',4);
  const timer=new Promise(resolve=>setTimeout(()=>{timerMs=performance.now()-beginAsync;resolve();},0));
  const [asyncBackup]=await Promise.all([task,timer]);
  const asyncElapsedMs=performance.now()-beginAsync;
  console.log(JSON.stringify({databaseMB:Number((bytes/1048576).toFixed(2)),backupMB:Number((saved/1048576).toFixed(2)),
    syncBackupMs:Number(ms.toFixed(2)),eventLoopBlockedAtLeastMs:Number(ms.toFixed(2)),
    workerElapsedMs:Number(asyncElapsedMs.toFixed(2)),workerMainThreadTimerMs:Number(timerMs.toFixed(2)),
    workerBackupMB:Number((fs.statSync(asyncBackup).size/1048576).toFixed(2)),
    eventLoopP99ms:Number((loop.percentile(99)/1e6).toFixed(2)),
    note:'Synthetic SQLite VACUUM INTO only. No real SFU/OBS GPU, network or LiveKit usage measured.'},null,2));
} finally {db?.close();fs.rmSync(work,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
