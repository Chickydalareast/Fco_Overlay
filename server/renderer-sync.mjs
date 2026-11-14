/** Authoritative, revision-scoped OBS acknowledgements.
 * A renderer may only confirm the current Program, and camera readiness is
 * meaningful only for that exact revision and the slots currently visible. */
export const SLOTS=['A1','A2','B1','B2'];
export function acceptRendererReady(entry,revision,currentRevision){
  if(!Number.isInteger(revision)||revision!==currentRevision)return false;
  entry.revision=revision;
  entry.mediaRevision=null;
  entry.cameraReady=[];
  entry.cameraWaiting=[];
  return true;
}
export function acceptRendererMedia(entry,report,program){
  if(!Number.isInteger(report?.revision)||entry.revision!==report.revision||program.revision!==report.revision)return false;
  if(!Array.isArray(report.ready)||!Array.isArray(report.waiting)||report.ready.length>4||report.waiting.length>4)return false;
  const visible=SLOTS.filter(slot=>program.cameras.slots[slot].visible);
  const all=[...report.ready,...report.waiting];
  if(all.some(slot=>!visible.includes(slot))||new Set(all).size!==all.length||all.length!==visible.length)return false;
  entry.mediaRevision=report.revision;
  entry.cameraReady=[...report.ready];
  entry.cameraWaiting=[...report.waiting];
  return true;
}
export function rendererInfo(entry,program){
  const info={id:entry.rendererId,label:entry.label,revision:entry.revision??null};
  if(entry.mediaRevision===program.revision&&entry.revision===program.revision){
    info.mediaRevision=program.revision;
    info.cameraReady=[...entry.cameraReady];info.cameraWaiting=[...entry.cameraWaiting];
  }
  return info;
}
