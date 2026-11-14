import {Worker} from 'node:worker_threads';

// Each worker performs one consistent SQLite VACUUM INTO and exits. The promise
// queue prevents two BO changes/daily backups colliding on the backup directory.
// Failure is reported to callers; it does not block broadcasts or corrupt the DB.
let tail=Promise.resolve();
export function scheduleBackup(dbFile,reason,keep=20){
  if(dbFile===':memory:')return Promise.resolve(null);
  const run=tail.then(()=>new Promise((resolve,reject)=>{
    let settled=false;
    const worker=new Worker(new URL('./backup-worker.mjs',import.meta.url),{workerData:{dbFile,reason,keep}});
    const finish=(error,file)=>{
      if(settled)return;
      settled=true;
      if(error)reject(error);else resolve(file);
    };
    worker.once('message',message=>{
      if(message.ok)finish(null,message.file);
      else finish(new Error(message.error||'SQLite backup failed'));
    });
    worker.once('error',error=>finish(error));
    worker.once('exit',code=>{if(!settled)finish(new Error(`Backup worker exited with ${code}`));});
  }));
  tail=run.catch(()=>{});
  return run;
}
export function flushBackups(){return tail;}
