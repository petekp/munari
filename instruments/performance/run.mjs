// Controls benchmark — input, resize and handoff on the actual lab scene.
// CPU throttling is an emulation; reported timings belong to this browser and host.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { cpus, loadavg, tmpdir } from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { installObserver, performanceObserver } from './observer.mjs'
import { gpuDiagnosticPlugin, installGpuDiagnostics } from './gpu-diagnostics.mjs'
import { fullCacheFlushDiagnostic } from './raster-flush-diagnostic.mjs'
import { productionBuildProof } from './production-build-proof.mjs'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

const buildMode = process.env.PERF_BUILD_MODE ?? 'development'
assert.ok(['development','production'].includes(buildMode), 'PERF_BUILD_MODE must be development or production')
process.env.NODE_ENV = buildMode
const { createServer, build, preview } = await import('vite')
const root = path.resolve(import.meta.dirname, '../..')
const featurePrefix='--enable-features='
const enabledFeatures=['CanvasDrawElement',...WEBGPU_CHROME_ARGS.flatMap(arg=>arg.startsWith(featurePrefix)?arg.slice(featurePrefix.length).split(','):[])]
const chromeArgs=[...WEBGPU_CHROME_ARGS.filter(arg=>!arg.startsWith(featurePrefix)),featurePrefix+enabledFeatures.join(','),'--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']
const git = (...args) => execFileSync('git', args, {cwd:root,encoding:'utf8'}).trim()
const resolveRef = ref => {
  assert.match(ref, /^[\w./-]+$/, 'The source ref must be a Git commit or ref name')
  const commit = git('rev-parse', '--verify', `${ref}^{commit}`)
  assert.match(commit, /^[a-f0-9]{40}$/)
  return commit
}
const integer = (value, min, max, label) => {
  const number = Number(value)
  assert.ok(Number.isInteger(number) && number>=min && number<=max, `${label} must be between ${min} and ${max}`)
  return number
}
const trials = integer(process.env.PERF_TRIALS ?? 2, 1, 10, 'PERF_TRIALS')
const rates = [...new Set((process.env.PERF_CPU_RATES ?? '1,4').split(',').map(rate => integer(rate,1,20,'PERF_CPU_RATES')))]
const engines = [...new Set((process.env.PERF_ENGINES ?? 'html-in-canvas,snapdom').split(','))]
assert.ok(['0','1'].includes(process.env.PERF_ROUTE_TIMING ?? '1'), 'PERF_ROUTE_TIMING must be 0 or 1')
const routeTiming = process.env.PERF_ROUTE_TIMING !== '0'
assert.ok(['0','1'].includes(process.env.PERF_PROFILE ?? '0'), 'PERF_PROFILE must be 0 or 1')
const profile = process.env.PERF_PROFILE === '1'
assert.ok(['0','1'].includes(process.env.PERF_CAPTURE_STAGES ?? '0'), 'PERF_CAPTURE_STAGES must be 0 or 1')
const captureStages=process.env.PERF_CAPTURE_STAGES === '1'
assert.ok(['0','1'].includes(process.env.PERF_CAPTURE_DIAGNOSTICS ?? '0'), 'PERF_CAPTURE_DIAGNOSTICS must be 0 or 1')
const captureDiagnostics=process.env.PERF_CAPTURE_DIAGNOSTICS === '1'
assert.ok(['0','1'].includes(process.env.PERF_GPU_DIAGNOSTICS ?? '0'), 'PERF_GPU_DIAGNOSTICS must be 0 or 1')
const gpuDiagnostics=process.env.PERF_GPU_DIAGNOSTICS === '1'
assert.ok(['0','1'].includes(process.env.PERF_FLUSH_CPU_RASTER ?? '0'), 'PERF_FLUSH_CPU_RASTER must be 0 or 1')
const flushCpuRaster=process.env.PERF_FLUSH_CPU_RASTER === '1'
const captureStorage=process.env.PERF_CAPTURE_STORAGE??null
assert.ok(captureStorage===null||['cpu','gpu'].includes(captureStorage), 'PERF_CAPTURE_STORAGE must be cpu or gpu')
assert.ok(!flushCpuRaster || captureStorage==='cpu' && captureStages, 'CPU raster flush requires CPU capture storage and capture-stage timing')
assert.ok(!captureDiagnostics || captureStages, 'PERF_CAPTURE_DIAGNOSTICS requires PERF_CAPTURE_STAGES=1')
const maxFrameP95Ms = process.env.PERF_MAX_FRAME_P95_MS ? Number(process.env.PERF_MAX_FRAME_P95_MS) : null
assert.ok(maxFrameP95Ms===null || Number.isFinite(maxFrameP95Ms)&&maxFrameP95Ms>0, 'PERF_MAX_FRAME_P95_MS must be positive and finite')
assert.ok(engines.length>0 && engines.every(engine => ['html-in-canvas','snapdom'].includes(engine)), 'Unknown PERF_ENGINES selection')
assert.ok([process.env.PERF_BASELINE_REF,process.env.PERF_BASELINE_DIR,process.env.PERF_SOURCE_REF].filter(Boolean).length<=1, 'Choose one baseline ref, baseline directory, or source ref')
const baselineDirectory=process.env.PERF_BASELINE_DIR?path.resolve(process.env.PERF_BASELINE_DIR):null
const baselineLabSources=Boolean(process.env.PERF_BASELINE_REF||baselineDirectory&&existsSync(path.join(baselineDirectory,'apps/lab/src')))
if(baselineDirectory)for(const area of ['core','react'])assert.ok((await stat(path.join(baselineDirectory,`packages/${area}/src`))).isDirectory(), 'PERF_BASELINE_DIR must contain packages/core/src and packages/react/src')
const versions = baselineDirectory
  ? [{label:'baseline',commit:null,directory:baselineDirectory,labSources:baselineLabSources},{label:'working-tree',commit:null}]
  : process.env.PERF_BASELINE_REF
  ? [{label:'baseline',commit:resolveRef(process.env.PERF_BASELINE_REF),labSources:true},{label:'working-tree',commit:null}]
  : [{label:process.env.PERF_SOURCE_REF?'source-ref':'working-tree',commit:process.env.PERF_SOURCE_REF?resolveRef(process.env.PERF_SOURCE_REF):null,labSources:Boolean(process.env.PERF_SOURCE_REF)}]
const output = path.resolve(process.env.PERF_OUTPUT ?? path.join(tmpdir(),`munari-performance-${Date.now()}`))
await mkdir(output,{recursive:true})
const lock = JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'))
const sourceHash=source=>createHash('sha256').update(source).digest('hex')
const sharedBuildInputs=buildMode==='production'?Object.fromEntries(await Promise.all([
  'package.json','package-lock.json','apps/lab/package.json','apps/lab/vite.config.ts',
  'instruments/performance/run.mjs','instruments/performance/observer.mjs',
  'instruments/performance/production-build-proof.mjs',
].map(async file=>[file,sourceHash(await readFile(path.join(root,file)))]))):null
const metadata = {
  startedAt:new Date().toISOString(),head:git('rev-parse','HEAD'),buildMode,nodeEnv:process.env.NODE_ENV,buildEvidence:{},sharedBuildInputs,
  dirty:git('status','--short'),node:process.version,platform:process.platform,arch:process.arch,
  cpu:cpus()[0]?.model,cpuCount:cpus().length,
  viewport:{width:1440,height:1000,deviceScaleFactor:2},resizedViewport:{width:1320,height:920,deviceScaleFactor:2},
  input:' Repeatable browser input 0123456789.',inputDelayMs:40,idleMs:1200,inputPhaseIncludesFocusAndSubmit:true,
  trials,rates,engines,versions,routeTiming,profile,captureStages,captureStorage,captureDiagnostics,gpuDiagnostics,flushCpuRaster,maxFrameP95Ms,baselineLabSources,chromeArgs,requestedBackend:process.env.MUNARI_BACKEND??'auto',
  dependencyVersions:Object.fromEntries(['three','@react-three/fiber','@zumer/snapdom','vite','puppeteer-core'].map(name=>[name,lock.packages[`node_modules/${name}`]?.version])),
}
const results = {metadata,rows:[],loadedSources:{}}
const servers = []
async function verifyProductionSources(version,loadedSources,evidence) {
  evidence.cssSources={}
  evidence.assetSources={}
  for(const area of ['packages/core/src/','packages/react/src/','apps/lab/src/']) {
    assert.ok(Object.keys(loadedSources).some(file=>file.startsWith(area)), `Production build must load ${area}`)
  }
  for(const [file,hash] of Object.entries(loadedSources)) {
    const fromRevision=file.startsWith('packages/')||version.labSources
    const source=fromRevision&&version.commit
      ? execFileSync('git',['show',`${version.commit}:${file}`],{cwd:root})
      : await readFile(path.join(fromRevision&&version.directory?version.directory:root,file))
    if(/\.(?:[cm]?jsx?|tsx?)$/.test(file)) {
      assert.equal(hash,sourceHash(source),`Production source does not match ${version.commit??version.directory??'working tree'}: ${file}`)
    } else {
      const sourceHashes=file.endsWith('.css')?evidence.cssSources:evidence.assetSources
      sourceHashes[file]={sourceSha256:sourceHash(source),transformedSha256:hash}
      assert.equal(sourceHash(source),sourceHash(await readFile(path.join(root,file))),`Production CSS or asset must match the current workload: ${file}`)
    }
  }
  evidence.sourceCommit=version.commit
  evidence.sourceDirectory=version.directory??null
  evidence.verifiedSourceCount=Object.keys(loadedSources).length
}
function verifyPairedProductionSources() {
  if(versions.length!==2)return
  const labHashes=version=>Object.entries(results.loadedSources[version.label]).filter(([file])=>file.startsWith('apps/lab/src/')).sort(([a],[b])=>a.localeCompare(b))
  assert.deepEqual(labHashes(versions[0]),labHashes(versions[1]),'Paired production builds must use identical lab sources')
  assert.deepEqual(metadata.buildEvidence[versions[0].label].cssSources,metadata.buildEvidence[versions[1].label].cssSources,'Paired production builds must use identical CSS sources and transformed CSS')
  assert.deepEqual(metadata.buildEvidence[versions[0].label].assetSources,metadata.buildEvidence[versions[1].label].assetSources,'Paired production builds must use identical asset bytes and generated asset modules')
}
const pause = (page,ms) => page.evaluate(ms => new Promise(resolve=>setTimeout(resolve,ms)),ms)
const settled = (page,presentation) => page.waitForFunction(presentation=>window.__apiControls?.status?.presentation===presentation&&!window.__apiControls.status.isTransitioning,{timeout:30000},presentation)
const stats = values => {
  const sorted = [...values].sort((a,b)=>a-b)
  return {count:sorted.length,total:sorted.reduce((sum,value)=>sum+value,0),p50:sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.5))]:null,p95:sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]:null,max:sorted.at(-1)??null}
}
const metrics = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric=>[metric.name,metric.value]))
function acknowledgeUploads(events,uploads) {
  return events.map(event=>{
    const upload=uploads.find(upload=>upload.sourceId===event.sourceId&&upload.read>=event.requiredRead&&upload.t>=event.t)
    return {sourceId:event.sourceId,requiredRead:event.requiredRead,interactionTime:event.t,eventTime:event.eventTime,uploadedRead:upload?.read??null,uploadTime:upload?.t??null,latencyMs:upload?upload.t-event.t:null}
  })
}
function summarize(raw,before,after) {
  const captures=raw.events.filter(event=>event.kind==='capture'),uploads=raw.events.filter(event=>event.kind==='upload')
  const inputs=raw.events.filter(event=>event.kind==='input'),focuses=raw.events.filter(event=>event.kind==='focusin'),submits=raw.events.filter(event=>event.kind==='submit')
  const inputAcknowledgements=acknowledgeUploads(inputs,uploads).map(event=>({...event,inputTime:event.interactionTime}))
  const focusAcknowledgements=acknowledgeUploads(focuses,uploads),submitAcknowledgements=acknowledgeUploads(submits,uploads)
  const focus=focuses[0],lastFocusUpload=focus?uploads.filter(upload=>upload.sourceId===focus.sourceId&&upload.t>=focus.t).at(-1):null
  const identities=new Set(uploads.map(event=>`${event.sourceId}:${event.read}:${event.generation}:${event.width}:${event.height}`))
  return {
    phaseStartedAt:raw.phaseStartedAt,elapsedMs:raw.elapsedMs,frameIntervalMs:stats(raw.gaps),routeStepMs:stats(raw.events.filter(event=>event.kind==='route').map(event=>event.ms)),
    routeHostSpaceMs:stats(raw.events.filter(event=>event.kind==='routeHostSpace').map(event=>event.ms)),
    routeVerdicts:Object.fromEntries(['page','native','relay','off'].map(route=>[route,raw.events.filter(event=>event.kind==='route'&&event.route===route).length])),
    completedCaptures:captures.length,uniqueCaptureReads:new Set(captures.map(event=>`${event.sourceId}:${event.read}`)).size,
    uploadCallbacks:uploads.length,uniqueUploadIdentities:identities.size,repeatedUploadIdentities:uploads.length-identities.size,
    uploadedTexelArea:uploads.reduce((area,event)=>area+event.width*event.height,0),
    mainThreadTaskMs:(after.TaskDuration-before.TaskDuration)*1000,
    scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,
    inputToUploadMs:stats(inputAcknowledgements.flatMap(input=>input.latencyMs===null?[]:[input.latencyMs])),inputAcknowledgements,
    unacknowledgedInputs:inputAcknowledgements.filter(input=>input.latencyMs===null).length,
    focusAcknowledgements,submitAcknowledgements,
    focusToLastUploadMs:lastFocusUpload?lastFocusUpload.t-focus.t:null,
    submitToUploadMs:stats(submitAcknowledgements.flatMap(submit=>submit.latencyMs===null?[]:[submit.latencyMs])),
    unacknowledgedSubmits:submitAcknowledgements.filter(submit=>submit.latencyMs===null).length,
    browserTimingSupport:raw.timingSupport,browserTimingEntries:raw.events.filter(event=>event.kind==='browserTiming'),
    captureStageMs:captureStages?Object.fromEntries([...new Set(raw.events.filter(event=>event.kind==='captureStage').map(event=>event.stage))].map(stage=>[stage,stats(raw.events.filter(event=>event.kind==='captureStage'&&event.stage===stage).map(event=>event.ms))])):null,
    capturePayloads:raw.events.filter(event=>event.kind==='capturePayload'),
    requestedRasterPixelArea:raw.events.filter(event=>event.kind==='captureRaster').reduce((sum,event)=>sum+event.width*event.height,0),
    captureRegions:{full:raw.events.filter(event=>event.kind==='captureRegion'&&!event.clipped).length,partial:raw.events.filter(event=>event.kind==='captureRegion'&&event.clipped).length,cssArea:raw.events.filter(event=>event.kind==='captureRegion').reduce((sum,event)=>sum+event.cssArea,0)},
    reusedInputSvgs:raw.events.filter(event=>event.kind==='reusedInputSvg').length,
    fullBackgroundReuses:raw.events.filter(event=>event.kind==='fullBackgroundComposite'&&event.reused).length,
    fullBackgroundPreparedPaints:raw.events.filter(event=>event.kind==='fullBackgroundComposite'&&!event.reused).length,
    fullBackgroundPreparations:raw.totals?.fullBackgroundPreparation??0,
    fullBackgroundComposites:raw.totals?.fullBackgroundComposite??0,
    backgroundPixelBytes:raw.totals?.backgroundPixelBytes??0,
    styleCacheHits:raw.events.filter(event=>event.kind==='styleCacheHit').length,
    styleSerializations:raw.events.filter(event=>event.kind==='styleSerialization').length,
    inputBlankDecodes:raw.totals?.inputBlankDecode??raw.events.filter(event=>event.kind==='inputBlankDecode').length,
    directInputTexts:raw.events.filter(event=>event.kind==='directInputText'&&event.painted).length,
    preparedInputTexts:raw.totals?.preparedInputText??raw.events.filter(event=>event.kind==='preparedInputText').length,
    unchangedInputFrames:raw.events.filter(event=>event.kind==='unchangedInputFrame').length,
    componentRenders:captureStages?Object.fromEntries(['ControlsHardware','PhysicalPiece'].map(component=>[component,raw.events.filter(event=>event.kind==='componentRender'&&event.component===component).length])):null,
  }
}
async function phase(page,cdp,name,work,directory) {
  const profiling=profile&&name==='scene-input'
  if(profiling) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval',{interval:1000})
    await page.tracing.start({path:path.join(directory,'scene-input.trace.json'),screenshots:false,categories:['devtools.timeline','disabled-by-default-devtools.timeline','v8','blink.user_timing']})
    await cdp.send('Profiler.start')
  }
  const before=await metrics(cdp)
  let raw,after
  try {
    await page.evaluate(()=>window.__munariPerf.start())
    await work()
    raw=await page.evaluate(()=>window.__munariPerf.stop())
    after=await metrics(cdp)
  } finally {
    if(profiling) {
      const {profile:cpuProfile}=await cdp.send('Profiler.stop')
      await writeFile(path.join(directory,'scene-input.cpuprofile'),JSON.stringify(cpuProfile))
      await page.tracing.stop()
      await cdp.send('Profiler.disable')
    }
  }
  assert.ok(raw.gaps.length>0, `${name} needs actual animation frame observations`)
  if(captureStages) {
    assert.equal(raw.frameWindows.length,raw.gaps.length,`${name}: each frame interval needs a timestamped window`)
    assert.equal(raw.clockAnchors.length,2,`${name}: diagnostic phase needs both clock anchors`)
    assert.notEqual(raw.clockAnchors[0].name,raw.clockAnchors[1].name)
    assert.ok(raw.clockAnchors.every(anchor=>Number.isFinite(anchor.performanceTime)))
    assert.ok(raw.clockAnchors[0].performanceTime<=raw.clockAnchors[1].performanceTime)
    for(const [index,window] of raw.frameWindows.entries()) {
      assert.ok([window.start,window.end,window.callbackStart,window.callbackEnd].every(Number.isFinite))
      assert.equal(window.end-window.start,raw.gaps[index],`${name}: frame-window interval differs from the measured gap`)
      assert.equal(window.durationMs,raw.gaps[index])
      assert.ok(window.callbackEnd>=window.callbackStart)
      if(index>0) {
        assert.equal(window.start,raw.frameWindows[index-1].end)
        assert.equal(window.callbackStart,raw.frameWindows[index-1].callbackEnd)
      }
    }
  }
  return {name,...summarize(raw,before,after),raw}
}
async function sourceSnapshot(page) {
  return page.evaluate(()=>{
    const rows=[...window.__munariPerf.sources.values()].map(({source,texture,uploadedRead})=>{
      const canvas=source.canvas,pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data
      let hash=2166136261,nontransparent=0
      for(let i=0;i<pixels.length;i++){hash=Math.imul(hash^pixels[i],16777619);if(i%4===3&&pixels[i]>0)nontransparent++}
      return {sourceId:source.sourceId,read:source.currentPaint()?.read,uploadedRead:uploadedRead(),generation:source.currentPaint()?.frame.generation,version:texture()?.version,width:canvas.width,height:canvas.height,pixelHash:hash>>>0,nontransparent,captureStorage:canvas.getContext('2d').getContextAttributes().willReadFrequently?'cpu':'gpu'}
    })
    return {rows,paints:window.__munariPerf.paintStats()}
  })
}
const hostActivity=()=>({at:new Date().toISOString(),loadAverage:loadavg(),cpuTimes:cpus().map(cpu=>cpu.times)})
// The one-minute load average still counts this runner's previous trial, so the
// gate samples busy time over a second instead.
const MAX_BUSY_CORES=2
async function sampleBusyCores(intervalMs=1000) {
  const before=cpus().map(cpu=>cpu.times)
  await new Promise(resolve=>setTimeout(resolve,intervalMs))
  let busy=0,total=0
  cpus().forEach((cpu,i)=>{
    const {user,nice,sys,irq,idle}=cpu.times
    const used=user-before[i].user+nice-before[i].nice+sys-before[i].sys+irq-before[i].irq
    busy+=used
    total+=used+idle-before[i].idle
  })
  return busy/total*cpus().length
}
async function trial(server,version,engine,rate,index) {
  const name=`${version.label}-${engine}-cpu${rate}-trial${index}`
  const directory=path.join(output,name)
  await mkdir(directory,{recursive:true})
  const hostBefore=hostActivity()
  const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,defaultViewport:metadata.viewport,args:chromeArgs})
  let page
  const errors=[]
  try {
    page=await browser.newPage()
    page.on('pageerror',error=>errors.push(String(error)))
    const favicon=url=>new URL(url).pathname==='/favicon.ico'
    page.on('response',response=>{if(response.status()>=400&&!favicon(response.url()))errors.push(`HTTP ${response.status()} ${response.url()}`)})
    page.on('requestfailed',request=>{if(!favicon(request.url()))errors.push(`${request.failure()?.errorText} ${request.url()}`)})
    page.on('console',message=>{if(message.type()==='error'&&!message.text().startsWith('Failed to load resource:'))errors.push(message.text())})
    const cdp=await page.createCDPSession()
    await cdp.send('Performance.enable')
    await cdp.send('Emulation.setCPUThrottlingRate',{rate})
    await page.evaluateOnNewDocument(installObserver,{detailedFrames:captureStages})
    if(gpuDiagnostics)await page.evaluateOnNewDocument(installGpuDiagnostics)
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=controls&framed${engine==='snapdom'?'&capture=snapdom':''}`,{waitUntil:'load'})
    await page.waitForFunction(()=>window.__apiControls?.status?.supported&&document.querySelector('[data-api-live] input'),{timeout:30000})
    await page.evaluate(()=>document.fonts.ready)
    const phases=[]
    phases.push(await phase(page,cdp,'enter-scene',async()=>{
      await page.evaluate(()=>{window.perfOriginalInput=document.querySelector('[data-api-live] input');window.perfOriginalValue=perfOriginalInput.value;window.__apiControls.request(true)})
      await settled(page,'scene')
      await page.waitForFunction(()=>window.__apiControls.frames.at(-1)?.amount===1,{timeout:30000})
    }))
    await pause(page,500)
    const before=await sourceSnapshot(page)
    assert.equal(before.rows.length,1,'Controls must have one measured source')
    assert.ok(before.rows[0].nontransparent>0,'The source must contain captured pixels')
    assert.equal(before.paints.length,1)
    assert.equal(before.paints[0].engine,engine,'The requested engine must have produced the paints')
    phases.push(await phase(page,cdp,'scene-idle',()=>pause(page,metadata.idleMs)))
    await page.screenshot({path:path.join(directory,'scene-before.png')})
    await page.evaluate(()=>{
      const recordInteraction=event=>{
        if(event.target!==(event.type==='submit'?window.perfOriginalInput.form:window.perfOriginalInput))return
        const {source}=[...window.__munariPerf.sources.values()][0]
        const requiredRead=source.nextRead()
        window.perfRequiredRead=Math.max(window.perfRequiredRead??0,requiredRead)
        if(event.type==='submit') {
          window.perfSubmitSourceId=source.sourceId
          window.perfSubmitRequiredRead=requiredRead
        }
        window.__munariPerf.record(event.type,{sourceId:source.sourceId,requiredRead,eventTime:event.timeStamp,trusted:event.isTrusted,inputType:event.inputType})
      }
      for(const kind of ['input','focusin','submit'])document.addEventListener(kind,recordInteraction,true)
    })
    phases.push(await phase(page,cdp,'scene-input',async()=>{
      await page.focus('[data-api-live] input')
      await page.keyboard.press('End')
      await page.keyboard.type(metadata.input,{delay:metadata.inputDelayMs})
      await page.keyboard.press('Enter')
      await page.waitForFunction(()=>{
        const entry=window.__munariPerf.sources.get(window.perfSubmitSourceId)
        return entry&&Number.isInteger(window.perfSubmitRequiredRead)
          &&entry.source.currentPaint()?.read>=window.perfRequiredRead&&entry.uploadedRead()>=window.perfRequiredRead
      },{timeout:30000})
      await pause(page,250)
    },directory))
    const inputPhase=phases.find(phase=>phase.name==='scene-input')
    const focuses=inputPhase.raw.events.filter(event=>event.kind==='focusin'),submits=inputPhase.raw.events.filter(event=>event.kind==='submit')
    assert.equal(focuses.length,1,'The measured interaction must include one focus event')
    assert.equal(submits.length,1,'The measured interaction must include one submit event')
    assert.ok(focuses[0].trusted&&submits[0].trusted,'Focus and submit must be trusted browser events')
    assert.equal(focuses[0].sourceId,before.rows[0].sourceId)
    assert.equal(submits[0].sourceId,before.rows[0].sourceId)
    const edited=await sourceSnapshot(page)
    assert.equal(edited.rows[0].sourceId,submits[0].sourceId)
    assert.ok(edited.rows[0].read>=submits[0].requiredRead,'The submit update must reach the captured source')
    assert.ok(edited.rows[0].uploadedRead>=submits[0].requiredRead,'The submit update must reach an upload acknowledgement')
    if(captureStorage)for(const row of [...before.rows,...edited.rows])assert.equal(row.captureStorage,captureStorage,'Requested capture storage must be exercised')
    assert.ok(edited.rows[0].uploadedRead>=before.rows[0].read,'The final edit must reach an upload acknowledgement')
    assert.notEqual(edited.rows[0].pixelHash,before.rows[0].pixelHash,'Real input must change the captured pixels')
    await page.screenshot({path:path.join(directory,'scene-edited.png')})
    phases.push(await phase(page,cdp,'scene-resize',async()=>{
      await page.setViewport(metadata.resizedViewport)
      await page.waitForFunction(()=>innerWidth===1320&&innerHeight===920)
      await pause(page,1000)
    }))
    await page.screenshot({path:path.join(directory,'scene-edited-resized.png')})
    phases.push(await phase(page,cdp,'return-to-page',async()=>{
      await page.evaluate(()=>window.__apiControls.request(false))
      await settled(page,'page')
      await pause(page,250)
    }))
    const outcome=await page.evaluate(()=>({
      sameInput:document.querySelector('[data-api-live] input')===window.perfOriginalInput,
      value:window.perfOriginalInput.value,expected:window.perfOriginalValue+' Repeatable browser input 0123456789.',
      focused:document.activeElement===window.perfOriginalInput,actions:window.__apiControls.actions,
      holds:window.__apiControls.holds,status:window.__apiControls.status,
      canvas: {width:window.__r3f.gl.domElement.width,height:window.__r3f.gl.domElement.height},dpr:devicePixelRatio,
      gpu:(()=>{
        const renderer=window.__r3f.gl,backend=renderer.backend
        if(backend.isWebGPUBackend===true) {
          const info=backend.device.adapterInfo
          return {backend:'webgpu',rendererClass:renderer.constructor.name,vendor:info?.vendor??null,renderer:info?.description||info?.device||null,architecture:info?.architecture??null,device:info?.device??null}
        }
        if(backend.isWebGLBackend===true) {
          const context=renderer.getContext(),extension=context.getExtension('WEBGL_debug_renderer_info')
          return {backend:'webgl2',rendererClass:renderer.constructor.name,vendor:extension?context.getParameter(extension.UNMASKED_VENDOR_WEBGL):null,renderer:extension?context.getParameter(extension.UNMASKED_RENDERER_WEBGL):null}
        }
        throw new Error('Controls renderer backend was not identified')
      })(),
    }))
    assert.ok(outcome.sameInput&&outcome.focused,'The original input and focus must survive the round trip')
    assert.equal(outcome.value,outcome.expected)
    assert.ok(outcome.actions.length===1&&outcome.actions[0].trusted&&outcome.actions[0].saves===1,'Enter must submit the real form once')
    assert.ok(outcome.holds.some(hold=>hold.presentation==='scene')&&outcome.holds.some(hold=>hold.presentation==='page'))
    assert.equal(outcome.dpr,2)
    assert.equal(outcome.canvas.width,1320*2)
    assert.equal(outcome.canvas.height,920*2)
    assert.ok(phases.find(phase=>phase.name==='scene-input').completedCaptures>0,'Input needs completed capture evidence')
    assert.ok(phases.find(phase=>phase.name==='scene-input').uploadCallbacks>0,'Input needs upload callbacks')
    assert.deepEqual(errors,[])
    await page.screenshot({path:path.join(directory,'returned-page.png')})
    assert.equal(inputPhase.unacknowledgedSubmits,0,'The submit event needs an acknowledged capture read')
    assert.ok(inputPhase.raw.events.filter(event=>event.kind==='input').every(event=>event.trusted),'Each input must be a trusted browser event')
    assert.equal(inputPhase.unacknowledgedInputs,0,'Every input needs an acknowledged capture read')
    assert.equal(inputPhase.inputToUploadMs.count,metadata.input.length,'Each typed character needs its own input observation')
    if(flushCpuRaster)assert.ok(inputPhase.raw.events.some(event=>event.kind==='captureStage'&&event.stage==='diagnosticFlushReadbackSync'),'CPU flush must execute during the measured input phase')
    const frameBudget=maxFrameP95Ms===null?null:{maxP95Ms:maxFrameP95Ms,measuredP95Ms:inputPhase.frameIntervalMs.p95,passed:inputPhase.frameIntervalMs.p95<=maxFrameP95Ms}
    const gpuEvidence=gpuDiagnostics?await page.evaluate(()=>window.__munariGpuDiagnostics.snapshot()):null
    const row={hostActivity:{before:hostBefore,after:hostActivity()},gpuDiagnostics:gpuEvidence,name,version:version.label,sourceCommit:version.commit,sourceDirectory:version.directory??null,engine,rate,trial:index,browser:await browser.version(),before,edited,outcome,errors,phases,frameBudget}
    await writeFile(path.join(directory,'result.json'),JSON.stringify(row,null,2))
    console.log(JSON.stringify({...row,phases:phases.map(({raw,...phase})=>phase)}))
    return row
  } catch(error) {
    const failure={name,error:String(error),stack:error.stack,errors}
    if(page) {
      try { await page.screenshot({path:path.join(directory,'failure.png')}) } catch(captureError) { failure.screenshotError=String(captureError) }
      try { failure.state=await page.evaluate(()=>({status:window.__apiControls?.status,actions:window.__apiControls?.actions,holds:window.__apiControls?.holds,input:window.perfOriginalInput?.value,requiredRead:window.perfRequiredRead,paints:window.__munariPerf?.paintStats?.(),events:window.__munariPerf?.events})) } catch(stateError) { failure.stateError=String(stateError) }
    }
    await writeFile(path.join(directory,'failure.json'),JSON.stringify(failure,null,2))
    throw error
  } finally { await browser.close() }
}
try {
  metadata.hostBusyCores=await sampleBusyCores()
  assert.ok(metadata.hostBusyCores<=MAX_BUSY_CORES,`Host is busy: ${metadata.hostBusyCores.toFixed(1)} cores in use, limit ${MAX_BUSY_CORES}. Stop background work and rerun.`)
  for(const version of versions) {
    const loadedSources={}
    results.loadedSources[version.label]=loadedSources
    const cacheDir=path.join(output,`.vite-${version.label}`)
    const plugins=[performanceObserver(root,version.commit,loadedSources,routeTiming,version.directory,captureStages,captureStorage,captureDiagnostics),...(gpuDiagnostics?[gpuDiagnosticPlugin(root)]:[]),...(flushCpuRaster?[fullCacheFlushDiagnostic(root)]:[])]
    let server
    if (buildMode === 'production') {
      const outDir=path.join(output,`build-${version.label}`)
      const evidence={}
      metadata.buildEvidence[version.label]=evidence
      const common={root:path.join(root,'apps/lab'),configFile:path.join(root,'apps/lab/vite.config.ts'),configLoader:'native',mode:buildMode,cacheDir,logLevel:'warn'}
      await build({...common,build:{outDir,emptyOutDir:true,sourcemap:true},plugins:[...plugins,productionBuildProof(evidence)]})
      await verifyProductionSources(version,loadedSources,evidence)
      await writeFile(path.join(output,`build-${version.label}.json`),JSON.stringify(evidence,null,2))
      server=await preview({...common,build:{outDir},preview:{host:'127.0.0.1',port:0,open:false}})
    } else {
      server=await createServer({root:path.join(root,'apps/lab'),mode:buildMode,cacheDir,server:{host:'127.0.0.1',port:0,watch:null,fs:{allow:[root]}},plugins,logLevel:'warn'})
      await server.listen()
    }
    servers.push(server)
  }
  if(buildMode==='production')verifyPairedProductionSources()
  for(const engine of engines)for(const rate of rates)for(let index=1;index<=trials;index++) {
    const order=versions.map((version,i)=>({version,server:servers[i]}))
    if(index%2===0)order.reverse()
    for(const {version,server} of order)results.rows.push(await trial(server,version,engine,rate,index))
    await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
  }
  console.log(`Performance evidence: ${output}`)
  assert.ok(results.rows.every(row=>row.frameBudget===null||row.frameBudget.passed),JSON.stringify(results.rows.filter(row=>row.frameBudget&&!row.frameBudget.passed).map(row=>({name:row.name,...row.frameBudget}))))
} finally {
  await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
  await Promise.all(servers.map(server=>server.close()))
}
