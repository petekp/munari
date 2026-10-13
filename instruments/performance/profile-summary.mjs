// CPU profile summary — sampled leaf work and inclusive stacks remain separate.
// Sampling intervals estimate time; they do not measure exact function execution.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

assert.equal(process.argv.length,3,'Usage: node instruments/performance/profile-summary.mjs <scene-input.cpuprofile>')
const profile=JSON.parse(await readFile(process.argv[2],'utf8'))
const {nodes,samples,timeDeltas}=profile
assert.ok(samples?.length>0&&samples.length===timeDeltas?.length,'The profile needs samples with matching time deltas')
const byId=new Map(nodes.map(node=>[node.id,node])),parents=new Map(),functions=new Map(),stacks=new Map()
for(const node of nodes)for(const child of node.children??[])parents.set(child,node.id)
const frame=id=>{
  const source=byId.get(id)?.callFrame
  assert.ok(source,`Missing CPU profile node ${id}`)
  return {functionName:source.functionName||'(anonymous)',url:source.url,line:source.lineNumber+1,column:source.columnNumber+1}
}
const durationMs=(profile.endTime-profile.startTime)/1000
assert.ok(Number.isFinite(durationMs)&&durationMs>0,'Invalid CPU profile time range')
let timestamp=profile.startTime
const observations=samples.map((id,index)=>{
  assert.ok(Number.isFinite(timeDeltas[index]),'Invalid CPU profile time delta')
  timestamp+=timeDeltas[index]
  return {id,index,timestamp}
})
const valid=observations.filter(sample=>sample.timestamp>=profile.startTime&&sample.timestamp<=profile.endTime)
const ordered=[...valid].sort((a,b)=>a.timestamp-b.timestamp||a.index-b.index)
let observedMs=0,idleMs=0
for(let index=0;index<ordered.length;index++) {
  const sample=ordered[index],nextTimestamp=ordered[index+1]?.timestamp??profile.endTime
  const ms=(nextTimestamp-sample.timestamp)/1000
  observedMs+=ms
  const stack=[]
  let id=sample.id
  const seenNodes=new Set(),seenFunctions=new Set()
  while(id!==undefined) {
    assert.ok(!seenNodes.has(id),'CPU profile contains a cycle')
    seenNodes.add(id)
    const current=frame(id),key=JSON.stringify(current)
    if(!functions.has(key))functions.set(key,{...current,selfMs:0,inclusiveMs:0,selfSamples:0,inclusiveSamples:0})
    const entry=functions.get(key)
    if(stack.length===0){entry.selfMs+=ms;entry.selfSamples++}
    if(!seenFunctions.has(key)){entry.inclusiveMs+=ms;entry.inclusiveSamples++}
    seenFunctions.add(key)
    if(current.functionName!=='(root)')stack.push(current)
    id=parents.get(id)
  }
  if(stack[0]?.functionName==='(idle)')idleMs+=ms
  const key=JSON.stringify(stack)
  if(!stacks.has(key))stacks.set(key,{frames:stack,sampledMs:0,samples:0})
  stacks.get(key).sampledMs+=ms
  stacks.get(key).samples++
}
const hotspots=[...functions.values()].filter(entry=>entry.functionName!=='(root)').map(entry=>({...entry,selfSharePercent:observedMs?entry.selfMs/observedMs*100:0}))
console.log(JSON.stringify({
  file:process.argv[2],durationMs,samples:samples.length,validTimedSamples:ordered.length,observedMs,unattributedMs:durationMs-observedMs,idleMs,
  timingNormalization:{method:'Cumulative timestamps sorted before assigning intervals to the next sample',negativeDeltas:timeDeltas.filter(delta=>delta<0).length,reorderedSamples:ordered.filter((sample,index)=>sample.index!==valid[index].index).length,discardedOutOfRangeSamples:observations.filter(sample=>sample.timestamp<profile.startTime||sample.timestamp>profile.endTime)},
  hottestLeaves:hotspots.sort((a,b)=>b.selfMs-a.selfMs).slice(0,20),
  hottestInclusiveFunctions:[...hotspots].sort((a,b)=>b.inclusiveMs-a.inclusiveMs).slice(0,20),
  projectHotspots:hotspots.filter(entry=>entry.url.includes('/src/')).sort((a,b)=>b.selfMs-a.selfMs).slice(0,20),
  hottestStacks:[...stacks.values()].sort((a,b)=>b.sampledMs-a.sampledMs).slice(0,12),
},null,2))
