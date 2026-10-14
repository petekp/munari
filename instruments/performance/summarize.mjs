// Benchmark summary — matched trials retain ranges and screenshot byte identities.
// Timing distributions describe the recorded host; no portable speed budget is inferred.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

assert.equal(process.argv.length,3,'Usage: node instruments/performance/summarize.mjs <evidence-directory>')
const directory=path.resolve(process.argv[2])
const {metadata,rows,loadedSources}=JSON.parse(await readFile(path.join(directory,'results.json'),'utf8'))
assert.ok(rows.length>0,'The evidence directory has no completed trials')
const expectedTrials=metadata.trials*metadata.rates.length*metadata.engines.length*metadata.versions.length
assert.equal(rows.length,expectedTrials,'The benchmark matrix must finish before it is summarized')
const fields=['styleCacheHits','styleSerializations','reusedInputSvgs','inputBlankDecodes','directInputTexts','preparedInputTexts','unchangedInputFrames','requestedRasterPixelArea','captureRegions.full','captureRegions.partial','captureRegions.cssArea','uploadCallbacks','repeatedUploadIdentities','uploadedTexelArea','routeHostSpaceMs.count','routeStepMs.total','mainThreadTaskMs','completedCaptures','inputToUploadMs.p50','inputToUploadMs.p95','frameIntervalMs.p95','frameIntervalMs.max']
const range=values=>{
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b),length=sorted.length
  return {samples:length,median:length?(sorted[Math.floor((length-1)/2)]+sorted[Math.floor(length/2)])/2:null,min:sorted[0]??null,max:sorted.at(-1)??null}
}
const readField=(row,field)=>field.split('.').reduce((value,key)=>value?.[key],row)
const groups=new Map(),pairs=new Map()
for(const row of rows) {
  const key=JSON.stringify([row.engine,row.rate,row.version])
  if(!groups.has(key))groups.set(key,[])
  groups.get(key).push(row)
  const pairKey=JSON.stringify([row.engine,row.rate,row.trial])
  if(!pairs.has(pairKey))pairs.set(pairKey,[])
  pairs.get(pairKey).push(row)
}
const summaries=[...groups.values()].map(group=>({
  engine:group[0].engine,rate:group[0].rate,version:group[0].version,trials:group.length,
  phases:Object.fromEntries(['scene-idle','scene-input'].map(name=>{
    const phases=group.map(row=>row.phases.find(phase=>phase.name===name)).filter(Boolean)
    return [name,Object.fromEntries(fields.map(field=>[field,range(phases.map(phase=>
      !metadata.routeTiming&&field.startsWith('route')?null:readField(phase,field)
    ))]))]
  })),
}))
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex')
const screenshots=[]
for(const group of pairs.values()) {
  const baseline=group.find(row=>row.version==='baseline'),candidate=group.find(row=>row.version==='working-tree')
  if(!baseline||!candidate)continue
  const files={}
  for(const file of ['scene-edited.png','scene-edited-resized.png']) {
    try {
      const before=await digest(path.join(directory,baseline.name,file)),after=await digest(path.join(directory,candidate.name,file))
      files[file]={baseline:before,workingTree:after,equal:before===after}
    } catch(error) { files[file]={equal:null,error:String(error)} }
  }
  screenshots.push({engine:baseline.engine,rate:baseline.rate,trial:baseline.trial,baseline:baseline.name,workingTree:candidate.name,files})
}
let sourceComparison=null
if(loadedSources.baseline&&loadedSources['working-tree']) {
  const baseline=loadedSources.baseline,candidate=loadedSources['working-tree']
  const files=[...new Set([...Object.keys(baseline),...Object.keys(candidate)])].sort()
  const lab=files.filter(file=>file.startsWith('apps/lab/src/'))
  sourceComparison={
    lab:{files:lab.length,equal:lab.every(file=>baseline[file]&&baseline[file]===candidate[file]),differences:lab.filter(file=>baseline[file]!==candidate[file]).map(file=>({file,baseline:baseline[file]??null,workingTree:candidate[file]??null}))},
    changedPackageSources:files.filter(file=>file.startsWith('packages/')&&baseline[file]!==candidate[file]).map(file=>({file,baseline:baseline[file]??null,workingTree:candidate[file]??null})),
  }
}
console.log(JSON.stringify({
  evidenceDirectory:directory,metadata,
  browsers:[...new Set(rows.map(row=>row.browser))],
  gpus:[...new Set(rows.map(row=>JSON.stringify(row.outcome.gpu??null)))].map(value=>JSON.parse(value)),
  completedTrials:rows.length,expectedTrials,summaries,sourceComparison,screenshots,
},null,2))
