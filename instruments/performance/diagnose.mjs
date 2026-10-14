// Capture diagnosis summary — source/read joins across input and upload.
// Nested stages are retained separately; an upload callback is not presentation.
// The 2026-10-14 Controls probe separated capture overlap from policy wait
// (docs/performance-diagnosis.md). This reader owns attribution, not collection.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
const input=process.argv[2]
assert.ok(input,'Pass results.json')
const result=JSON.parse(readFileSync(input,'utf8'))
const stats=values=>{
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b)
  return {count:sorted.length,total:sorted.reduce((a,b)=>a+b,0),p50:sorted[Math.floor(sorted.length*.5)]??null,p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]??null,max:sorted.at(-1)??null}
}
const identity=event=>`${event.sourceId}:${event.read}`
const all=result.rows.map(row=>{
  const phase=row.phases.find(phase=>phase.name==='scene-input'),events=phase.raw.events
  const starts=events.filter(e=>e.kind==='captureReadStarted'),finishes=events.filter(e=>e.kind==='captureReadFinished')
  const grouped=new Map(starts.map(start=>[identity(start),{sourceId:start.sourceId,read:start.read,start,events:[]}]))
  for(const event of events)grouped.get(identity(event))?.events.push(event)
  const reads=[...grouped.values()].map(({sourceId,read,start,events:readEvents})=>{
    const paths=readEvents.filter(e=>e.kind==='regionPath')
    const stages=readEvents.filter(e=>e.kind==='captureStage')
    const first=kind=>readEvents.find(e=>e.kind===kind)??null
    const previousStarted=starts.filter(e=>e.sourceId===sourceId&&e.read<read&&e.t<start.t).at(-1)
    return {sourceId,read,startTime:start.t,firstRequestAt:start.firstRequestAt,latestRequestAt:start.latestRequestAt,requestCount:start.requestCount,requestsWhileCapturing:start.requestsWhileCapturing,requestCauses:start.requestCauses,
      firstRequestToStartMs:start.firstRequestAt===null?null:start.t-start.firstRequestAt,
      latestRequestToStartMs:start.latestRequestAt===null?null:start.t-start.latestRequestAt,
      path:paths.at(-1)??null,eligibility:first('regionEligibility'),svgRejections:readEvents.filter(event=>event.kind==='svgReuseRejected'),
      invalidationsSincePreviousStart:events.filter(e=>e.kind==='regionInvalidated'&&e.sourceId===sourceId&&e.t>(previousStarted?.t??phase.raw.started??0)&&e.t<=(paths.at(-1)?.t??start.t)),
      stageMs:Object.fromEntries([...new Set(stages.map(e=>e.stage))].map(stage=>[stage,stats(stages.filter(e=>e.stage===stage).map(e=>e.ms))])),
      receipt:first('capture'),uploadArmed:first('uploadArmed'),upload:first('upload'),finish:first('captureReadFinished')}
  })
  const detailedInputs=phase.inputAcknowledgements.map(input=>{
    const read=reads.find(read=>read.sourceId===input.sourceId&&read.read===input.uploadedRead)
    const end=read?.startTime??input.uploadTime
    const earlierCaptureMs=starts.filter(start=>start.sourceId===input.sourceId&&start.read<(input.uploadedRead??Infinity)).reduce((total,start)=>{
      const finish=finishes.find(finish=>finish.sourceId===start.sourceId&&finish.read===start.read)
      return total+(finish?Math.max(0,Math.min(end,finish.t)-Math.max(input.inputTime,start.t)):0)
    },0)
    return {...input,path:read?.path??null,
      inputToReadStartMs:read?read.startTime-input.inputTime:null,
      earlierCaptureOverlapMs:earlierCaptureMs,
      outsideEarlierCaptureBeforeReadMs:read?read.startTime-input.inputTime-earlierCaptureMs:null,
      readStartToReceiptMs:read?.receipt?read.receipt.t-read.startTime:null,
      receiptToUploadArmedMs:read?.receipt&&read?.uploadArmed?read.uploadArmed.t-read.receipt.t:null,
      armedToUploadCallbackMs:read?.uploadArmed?input.uploadTime-read.uploadArmed.t:null,
      stageMs:read?.stageMs??null}
  })
  return {name:row.name,rate:row.rate,storage:result.metadata.captureStorage,mainThreadTaskMs:phase.mainThreadTaskMs,inputToUploadMs:phase.inputToUploadMs,frameIntervalMs:phase.frameIntervalMs,
    pathCounts:Object.fromEntries([...new Set(reads.flatMap(read=>read.path?[read.path.path]:[]))].map(path=>[path,reads.filter(read=>read.path?.path===path).length])),
    stageMs:phase.captureStageMs,
    unattributedStages:events.filter(event=>event.kind==='captureStage'&&!grouped.has(identity(event))),
    admissionWaits:events.filter(e=>e.kind==='captureAdmissionWait'),
    reads,
    slowestInputs:[...detailedInputs].sort((a,b)=>(b.latencyMs??0)-(a.latencyMs??0)).slice(0,8),
    allInputs:detailedInputs,
    limits:['Synchronous substage timing adds overhead; this is diagnostic, not an acceptance comparison.','snapshotKeyBuildSync includes root style enumeration and control-state collection; regionSnapshotSync includes all snapshot substages. Do not add nested stages.','rasterizeWall and preparation include asynchronous waits and can overlap.','outsideEarlierCaptureBeforeReadMs includes policy wait and browser scheduling; it is not isolated pacing cost.','Upload callbacks are CPU acknowledgements and do not prove GPU completion or display presentation.','Captures started before the input phase have no captureReadStarted entry; their overlap is absent.']}
})
const output=process.argv[3]
if(output)writeFileSync(output,JSON.stringify(all,null,2))
console.log(JSON.stringify(all.map(({reads,allInputs,admissionWaits,...rest})=>({...rest,reads:reads.map(({stageMs,receipt,uploadArmed,upload,finish,invalidationsSincePreviousStart,...read})=>({...read,stageMs,invalidationsSincePreviousStart:invalidationsSincePreviousStart.map(e=>({t:e.t,reason:e.reason,epoch:e.epoch})),receiptAt:receipt?.t,armedAt:uploadArmed?.t,uploadAt:upload?.t,finishedAt:finish?.t}))})),null,2))
