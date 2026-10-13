// Trace attribution — snapDOM frame and timer callbacks retain their native work.
// Served-code locations identify callbacks; profiler startup is excluded from workload tasks.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

assert.equal(process.argv.length,3,'Usage: node instruments/performance/trace-summary.mjs <scene-input.trace.json>')
const trace=JSON.parse(await readFile(process.argv[2],'utf8'))
const events=Array.isArray(trace)?trace:trace.traceEvents
assert.ok(Array.isArray(events),'Expected Chrome trace events')
const threadKey=event=>`${event.pid}:${event.tid}`
const rendererThreads=new Set(events.filter(event=>event.ph==='M'&&event.name==='thread_name'&&event.args?.name==='CrRendererMain').map(threadKey))
assert.ok(rendererThreads.size>0,'The trace needs renderer-main thread metadata')
const complete=events.filter(event=>event.ph==='X'&&Number.isFinite(event.ts)&&Number.isFinite(event.dur)&&event.dur>=0&&rendererThreads.has(threadKey(event)))
const contains=(outer,inner)=>threadKey(outer)===threadKey(inner)&&outer.ts<=inner.ts&&inner.ts+inner.dur<=outer.ts+outer.dur
const setup=complete.filter(event=>/CpuProfiler.*StartProfiling/.test(event.name))
const tasks=complete.filter(event=>event.name==='RunTask')
const setupTasks=tasks.filter(task=>setup.some(event=>contains(task,event)))
const workTasks=tasks.filter(task=>!setupTasks.includes(task))
const stats=values=>{
  const sorted=[...values].sort((a,b)=>a-b),count=sorted.length
  return {count,median:count?(sorted[Math.floor((count-1)/2)]+sorted[Math.floor(count/2)])/2:null,p95:count?sorted[Math.min(count-1,Math.floor(count*.95))]:null,max:sorted.at(-1)??null,total:sorted.reduce((sum,value)=>sum+value,0)}
}
const unionMs=intervals=>{
  const sorted=intervals.map(event=>[event.ts,event.ts+event.dur]).sort((a,b)=>a[0]-b[0])
  let total=0,start=null,end=null
  for(const interval of sorted){if(start===null){[start,end]=interval}else if(interval[0]<=end){end=Math.max(end,interval[1])}else{total+=end-start;[start,end]=interval}}
  return (total+(start===null?0:end-start))/1000
}
const sourceLocation=data=>({url:(data.url??'').split('?')[0],functionName:data.functionName||'(anonymous)',line:data.lineNumber??null,column:data.columnNumber??null})
const snapdomLocation=data=>/\/packages\/react\/src\/snapdom\.ts(?:\?|$)/.test(data?.url??'')
const calls=complete.filter(event=>event.name==='FunctionCall')
const matchingCalls=callback=>calls.filter(call=>contains(callback,call)).sort((a,b)=>a.ts-b.ts||b.dur-a.dur)
const animationFrames=complete.filter(event=>event.name==='FireAnimationFrame')
const installations=events.filter(event=>event.name==='TimerInstall'&&rendererThreads.has(threadKey(event)))
const timerInstallation=callback=>{
  const data=callback.args?.data
  if(data?.timerId===undefined)return null
  return installations.filter(event=>threadKey(event)===threadKey(callback)&&event.ts<=callback.ts&&event.args?.data?.timerId===data.timerId&&event.args?.data?.frame===data.frame).sort((a,b)=>b.ts-a.ts)[0]??null
}
const groups=new Map(),captureTasks=new Map()
for(const frame of complete.filter(event=>['FireAnimationFrame','TimerFire'].includes(event.name))) {
  if(setupTasks.some(task=>contains(task,frame)))continue
  const matching=matchingCalls(frame),direct=matching.find(call=>snapdomLocation(call.args?.data))
  let location=direct?sourceLocation(direct.args.data):null,attribution=direct?'function-call':null
  if(!location&&frame.name==='TimerFire') {
    const installation=timerInstallation(frame)
    const stack=installation?.args?.data?.stackTrace??installation?.args?.stackTrace
    const frames=Array.isArray(stack)?stack:stack?.callFrames??[]
    const origin=frames.find(snapdomLocation)
    if(origin){location=sourceLocation(origin);attribution='timer-install-stack'}
    if(!location&&installation) {
      const creator=animationFrames.filter(callback=>threadKey(callback)===threadKey(installation)&&callback.ts<=installation.ts&&installation.ts<=callback.ts+callback.dur).sort((a,b)=>a.dur-b.dur)[0]
      const source=creator?matchingCalls(creator).find(call=>snapdomLocation(call.args?.data)):null
      if(source){location=sourceLocation(source.args.data);attribution='scheduler-frame-callback'}
    }
  }
  if(!location)continue
  const kind=frame.name==='TimerFire'?'timer':'animation-frame',call=direct??matching[0]
  const key=JSON.stringify({kind,location,attribution})
  if(!groups.has(key))groups.set(key,{kind,location,attribution,frames:[],calls:[],layout:[],style:[],native:[],tasks:new Map()})
  const group=groups.get(key)
  group.frames.push(frame.dur/1000);if(call)group.calls.push(call.dur/1000)
  const native=complete.filter(event=>['Layout','UpdateLayoutTree'].includes(event.name)&&contains(frame,event))
  group.layout.push(unionMs(native.filter(event=>event.name==='Layout')))
  group.style.push(unionMs(native.filter(event=>event.name==='UpdateLayoutTree')))
  group.native.push(unionMs(native))
  const task=workTasks.filter(task=>contains(task,frame)).sort((a,b)=>a.dur-b.dur)[0]
  if(task){const taskKey=`${threadKey(task)}:${task.ts}`;captureTasks.set(taskKey,task);group.tasks.set(taskKey,task)}
}
assert.ok(groups.size>0,'No renderer-main snapDOM animation frame or timer callbacks were found')
console.log(JSON.stringify({
  file:process.argv[2],units:'milliseconds',profilerSetupMs:stats(setup.map(event=>event.dur/1000)),
  captureContainingTaskMs:stats([...captureTasks.values()].map(event=>event.dur/1000)),
  callbacks:[...groups.values()].map(group=>({kind:group.kind,location:group.location,attribution:group.attribution,callbackIncludingContinuationMs:stats(group.frames),functionCallMs:stats(group.calls),nativeLayoutMs:stats(group.layout),nativeStyleUpdateMs:stats(group.style),nativeCombinedMs:stats(group.native),captureContainingTaskMs:stats([...group.tasks.values()].map(event=>event.dur/1000))})),
},null,2))
