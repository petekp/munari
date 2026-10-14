// Glass performance — per-pass GPU and CPU measurements in the real scene.
// Timestamp coverage must be complete; queue wait and presentation stay outside it.
// At DPR 2, Glass used four full-screen passes in the 2026-10-14 probe
// (docs/performance-diagnosis.md). Served instrumentation owns measurement only.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { cpus, tmpdir } from 'node:os'

const root = process.env.MUNARI_ROOT ?? path.resolve(import.meta.dirname, '../..')
const require = createRequire(path.join(root, 'package.json'))
const {createServer} = await import(pathToFileURL(require.resolve('vite')))
const {default:puppeteer} = await import(pathToFileURL(require.resolve('puppeteer-core')))
const {WEBGPU_CHROME_ARGS} = await import(pathToFileURL(path.join(root,'instruments/webgpuChrome.mjs')))
const output = process.env.GLASS_OUTPUT ?? path.join(tmpdir(), 'munari-glass-performance')
const rates = (process.env.GLASS_CPU_RATES ?? '1').split(',').map(Number)
const dprs = (process.env.GLASS_DPRS ?? '1,2').split(',').map(Number)
const modes = (process.env.GLASS_MODES ?? 'baseline').split(',')
const duration = Number(process.env.GLASS_DURATION_MS ?? 6000)
const trials = Number(process.env.GLASS_TRIALS ?? 1)
const legacyFinalAntialias = process.env.GLASS_FINAL_AA !== '0'
const snapshotEnabled = process.env.GLASS_SNAPSHOTS === '1'
for(const n of [...rates,...dprs,duration,trials]) assert.ok(Number.isFinite(n)&&n>0)
for(const mode of modes) assert.ok(['baseline','final-aa-off','card-only'].includes(mode))
if(snapshotEnabled&&modes.includes('card-only'))assert.equal(modes[0],'baseline','The card-only pixel negative control requires a baseline reference first')
await mkdir(output,{recursive:true})
const replace = (source,marker,next) => {
  assert.equal(source.split(marker).length,2,`Required exactly one source marker: ${marker}`)
  return source.replace(marker,next)
}
const observerModule = `
import {InspectorBase} from 'three/webgpu'
let renderer, current=null, active=false, rows=[], nextId=0, resolving=false, pending=[], errors=[], controls={mode:'baseline'}, frozen=null, captureRequest=null, captureFrames=0
class GlassInspector extends InspectorBase {
  beginRender(uid,scene,camera,target) {
    if (!current) return
    current.passes.push({uid,label:current.label??'unknown',target:target?{width:target.width,height:target.height,samples:target.samples}:null,actualSamples:this.getRenderer().currentSamples})
  }
}
export function install(gl) {
  if(renderer===gl)return
  renderer=gl
  renderer.inspector=new GlassInspector()
  window.__glassDiagnostic={
    start(mode){controls.mode=mode;rows=[];pending=[];errors=[];active=true},
    async stop(){active=false;const limit=performance.now()+1000;while(rows.some(r=>!r.resolved)&&performance.now()<limit)await new Promise(r=>setTimeout(r,10));return {rows,errors,controls,backend:renderer.backend.isWebGPUBackend?'webgpu':'webgl2',gpuTimer:renderer.backend.trackTimestamp===true,canvas:{width:renderer.domElement.width,height:renderer.domElement.height},info:{memory:{...renderer.info.memory},render:{...renderer.info.render}}}},
    mode(){return controls.mode},
    capture(configuration=null){if(active)throw new Error('Pixel capture is forbidden during timing');if(captureRequest)throw new Error('A fixed capture is already pending');return new Promise((resolve,reject)=>{frozen=configuration;captureFrames=0;const finish=value=>{clearTimeout(timeout);resolve(value)};const timeout=setTimeout(()=>{if(captureRequest===finish)captureRequest=null;reject(new Error('Fixed-frame capture timed out after 10 seconds'))},10000);captureRequest=finish})},
    ready:false,
  }
}
export function begin(gl,panels,w,h,inkCount,camera,scene,now) {
  install(gl)
  current={id:++nextId,t:performance.now(),width:w,height:h,panelCount:panels.length,inkCount,passes:[],passCpu:[],callsBefore:gl.info.render.calls}
  window.__glassDiagnostic.ready=inkCount===2
  if(captureRequest&&!frozen)frozen={time:now,camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,aspect:camera.aspect},panels:panels.map(p=>({label:p.label,position:p.group.current.position.toArray(),quaternion:p.group.current.quaternion.toArray(),scale:p.group.current.scale.toArray(),params:{...p.params},blobs:structuredClone(p.blobs),rects:structuredClone(p.rects),ripples:structuredClone(p.ripples),glows:structuredClone(p.glows)}))}
  if(frozen){
    camera.position.fromArray(frozen.camera.position);camera.quaternion.fromArray(frozen.camera.quaternion);camera.fov=frozen.camera.fov;camera.aspect=frozen.camera.aspect;camera.updateProjectionMatrix();camera.updateMatrixWorld(true)
    for(const p of panels){const saved=frozen.panels.find(s=>s.label===p.label);if(!saved)throw new Error('Missing fixed panel');const g=p.group.current;g.position.fromArray(saved.position);g.quaternion.fromArray(saved.quaternion);g.scale.fromArray(saved.scale);Object.assign(p.params,saved.params);for(const key of ['blobs','rects','ripples','glows'])p[key].splice(0,p[key].length,...structuredClone(saved[key]))}
    scene.updateMatrixWorld(true)
  }
  return frozen?.time??now
}

export function draw(gl,label,scene,camera) {
  current.label=label
  const start=performance.now()
  gl.render(scene,camera)
  current.passCpu.push({label,ms:performance.now()-start})
}
export function end(gl) {
  if(!current)return
  current.cpuMs=performance.now()-current.t
  current.renderCalls=gl.info.render.calls-current.callsBefore
  current.record=active
  if(active)rows.push(current)
  pending.push(current)
  current=null
  if(captureRequest&&++captureFrames>=3){
    const canvas=document.createElement('canvas');canvas.width=gl.domElement.width;canvas.height=gl.domElement.height
    const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(gl.domElement,0,0)
    const width=canvas.width,height=canvas.height,png=canvas.toDataURL('image/png'),pixels=context.getImageData(0,0,width,height).data
    let bytes='';for(let offset=0;offset<pixels.length;offset+=32768)bytes+=String.fromCharCode(...pixels.subarray(offset,offset+32768))
    const rgbaBase64=btoa(bytes);canvas.width=canvas.height=0
    const resolve=captureRequest;captureRequest=null;resolve({configuration:frozen,png,width,height,rgbaBase64})
  }

  if(resolving)return
  resolving=true
  const batch=pending;pending=[]
  gl.resolveTimestampsAsync('render').then(()=>{
    const b=gl.backend
    for(const frame of batch){
      for(const pass of frame.passes){
        if(b.hasTimestampQuery(pass.uid))pass.gpuMs=b.getTimestamp(pass.uid)
      }
      if(frame.passes.length&&frame.passes.every(p=>Number.isFinite(p.gpuMs)))frame.gpuMs=frame.passes.reduce((n,p)=>n+p.gpuMs,0)
      frame.resolved=true
    }
  }).catch(e=>errors.push(String(e))).finally(()=>{resolving=false})
}
export function includePanel(label){return controls.mode!=='card-only'||label==='glass-card'}
`
const plugin={name:'glass-diagnostic',enforce:'pre',resolveId(id){if(id==='virtual:glass-diagnostic')return '\0glass-diagnostic'},load(id){if(id==='\0glass-diagnostic')return observerModule},transform(code,id){
  if(id.endsWith('/primitives/surface/SurfaceCanvas.tsx')) {
    return replace(code,'new WebGPURenderer({ antialias, alpha, ...parameters, powerPreference, requiredLimits, canvas })','new WebGPURenderer({ antialias, alpha, ...parameters, powerPreference, requiredLimits, canvas, trackTimestamp: true, ...(window.__glassFinalAA === false ? { antialias: false, samples: 0 } : {}) })')
  }
  if(!id.endsWith('/scenes/glass/glassSdf.tsx'))return code
  code="import {begin as diagBegin,end as diagEnd,draw as diagDraw,includePanel as diagInclude} from 'virtual:glass-diagnostic'\n"+code
  code=replace(code,'    const now = clock.elapsedTime','    const now = diagBegin(gl, panels, w, h, [...sdfInk.values()].filter(Boolean).length, camera, scene, clock.elapsedTime)')
  code=replace(code,'    gl.render(scene, camera)',"    diagDraw(gl, 'world', scene, camera)")
  code=replace(code,'      gl.render(blitScene, quadCam)',"      diagDraw(gl, 'blit', blitScene, quadCam)\n      diagEnd(gl)")
  code=replace(code,'    for (const p of panels) {\n      const g = p.group.current!',"    for (const p of panels) {\n      if (!diagInclude(p.label)) continue\n      const g = p.group.current!")
  code=replace(code,'      gl.render(glassScene, quadCam)',"      diagDraw(gl, p.label, glassScene, quadCam)")
  code=replace(code,'    gl.render(blitScene, quadCam)',"    diagDraw(gl, 'blit', blitScene, quadCam)")
  code=replace(code,'      p.presenter.present()\n    }\n  }, 1)','      p.presenter.present()\n    }\n    diagEnd(gl)\n  }, 1)')
  return code
}}
const server=await createServer({root:path.join(root,'apps/lab'),configFile:path.join(root,'apps/lab/vite.config.ts'),plugins:[plugin],cacheDir:path.join(output,'.vite'),logLevel:'warn',server:{host:'127.0.0.1',port:0}})
await server.listen()
const prefix='--enable-features='
const features=['CanvasDrawElement',...WEBGPU_CHROME_ARGS.flatMap(a=>a.startsWith(prefix)?a.slice(prefix.length).split(','):[])]
let browser
const results={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),host:cpus()[0]?.model,instrumentSha256:createHash('sha256').update(await readFile(import.meta.filename)).digest('hex'),settings:{rates,dprs,modes,duration,trials,legacyFinalAntialias,snapshotEnabled,width:1200,height:900},limitations:['GPU times cover render passes only; upload/copy work, queue wait, presentation/compositor delay and GPU idle time are excluded.','CPU compositor timing excludes other useFrame callbacks; CDP TaskDuration is the complete measured page task interval.','card-only removes the pill pass as a visual negative control; it is never a proposed product setting.','This probe uses served-only source instrumentation and the real Glass scene.','CPU slowdown does not throttle GPU execution.'],runs:[]}
await writeFile(path.join(output,'instrument.mjs'),await readFile(import.meta.filename))
const captureFixed=async(page,configuration)=>{let timeout;try{return await Promise.race([page.evaluate(configuration=>window.__glassDiagnostic.capture(configuration),configuration),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Fixed-frame capture exceeded the 10-second host deadline')),10000)})])}finally{clearTimeout(timeout)}}
const snapshots = new Map()
const comparePixels=(a,b)=>{assert.equal(a.width,b.width);assert.equal(a.height,b.height);assert.equal(a.data.length,a.width*a.height*4);assert.equal(b.data.length,b.width*b.height*4);let changedPixels=0,maxDelta=0,channelTotal=0;for(let i=0;i<a.data.length;i+=4){let changed=false;for(let c=0;c<4;c++){const delta=Math.abs(a.data[i+c]-b.data[i+c]);maxDelta=Math.max(maxDelta,delta);channelTotal+=delta;if(delta)changed=true}if(changed)changedPixels++}return {width:a.width,height:a.height,changedPixels,maxDelta,meanChannelDelta:channelTotal/a.data.length}}
const stats=values=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);return {samples:sorted.length,p50:sorted[Math.floor(sorted.length*.5)]??null,p95:sorted[Math.floor(sorted.length*.95)]??null,max:sorted.at(-1)??null,total:sorted.reduce((a,b)=>a+b,0)}}
try{
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',defaultViewport:null,args:[...WEBGPU_CHROME_ARGS.filter(a=>!a.startsWith(prefix)),prefix+features.join(','),'--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']})
  results.browser=await browser.version()
  for(let trial=1;trial<=trials;trial++)for(const dpr of (trial%2?dprs:[...dprs].reverse()))for(const rate of rates)for(const mode of (trial%2?modes:[...modes].reverse())){
    const page=await browser.newPage(),errors=[]
    const caseName='trial'+trial+'-dpr'+dpr+'-cpu'+rate+'-'+mode
    page.on('pageerror',e=>errors.push(String(e)))
    await page.evaluateOnNewDocument(finalAA=>{window.__glassFinalAA=finalAA},legacyFinalAntialias&&mode!=='final-aa-off')
    await page.setViewport({width:1200,height:900,deviceScaleFactor:dpr})
    const cdp=await page.createCDPSession();await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate})
    await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/?scene=glass&framed&capture=auto',{waitUntil:'load',timeout:60000})
    await page.evaluate(()=>document.fonts.ready)
    await page.waitForFunction(()=>window.__glassDiagnostic?.ready&&window.__glass?.labels().length===2,{timeout:60000})
    assert.equal(await page.evaluate(()=>window.__r3f.gl.backend.isWebGPUBackend),true,'The diagnostic requires WebGPU')
    assert.equal(await page.evaluate(()=>window.__r3f.gl.backend.trackTimestamp),true,'Actual GPU timestamp capability is required')
    await page.evaluate(async mode=>{window.__glassDiagnostic.start(mode);await new Promise(r=>setTimeout(r,2000));await window.__glassDiagnostic.stop()},mode)
    const before=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]))
    await page.evaluate(mode=>{window.__glassDiagnostic.start(mode);window.__glassRaf=[];let running=true,last=0;window.__stopGlassRaf=()=>{running=false};const f=t=>{if(last)window.__glassRaf.push(t-last);last=t;if(running)requestAnimationFrame(f)};requestAnimationFrame(f)},mode)
    await new Promise(r=>setTimeout(r,duration))
    const raw=await page.evaluate(async()=>{window.__stopGlassRaf();const result=await window.__glassDiagnostic.stop();result.frameMs=window.__glassRaf;return result})
    const after=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]))
    const passes=[...new Set(raw.rows.flatMap(r=>r.passes.map(p=>p.label)))]
    const row={caseName,trial,dpr,rate,mode,frames:raw.rows.length,gpuFrames:raw.rows.filter(r=>Number.isFinite(r.gpuMs)).length,summary:{taskMs:(after.TaskDuration-before.TaskDuration)*1000,scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,frameMs:stats(raw.frameMs),compositorCpuMs:stats(raw.rows.map(r=>r.cpuMs)),renderGpuMs:stats(raw.rows.map(r=>r.gpuMs)),passes:Object.fromEntries(passes.map(label=>[label,{gpuMs:stats(raw.rows.flatMap(r=>r.passes.filter(p=>p.label===label).map(p=>p.gpuMs))),cpuMs:stats(raw.rows.flatMap(r=>r.passCpu.filter(p=>p.label===label).map(p=>p.ms)))}]))},raw,errors}
    assert.deepEqual(errors,[])
    assert.deepEqual(raw.errors,[])
    assert.ok(row.frames>=20,'Need at least 20 actual compositor frames')
    assert.equal(row.gpuFrames,row.frames,'Every measured compositor frame needs complete GPU pass timestamps')
    assert.equal(new Set(raw.rows.flatMap(frame=>frame.passes.map(pass=>pass.uid))).size,raw.rows.reduce((count,frame)=>count+frame.passes.length,0),'Pass UIDs must identify distinct observed renders')
    assert.ok(raw.rows.every(r=>r.inkCount===2),'Both real retained HTML captures must be present')
    assert.ok(raw.rows.every(r=>r.passes.length===(mode==='card-only'?3:4)),'Each real compositor frame needs the expected pass count')
    const samples={world:[...new Set(raw.rows.flatMap(r=>r.passes.filter(p=>p.label==='world').map(p=>p.actualSamples)))],blit:[...new Set(raw.rows.flatMap(r=>r.passes.filter(p=>p.label==='blit').map(p=>p.actualSamples)))]}
    assert.deepEqual(samples.world,[4],'World target must retain 4-sample MSAA')
    assert.deepEqual(samples.blit,[legacyFinalAntialias&&mode!=='final-aa-off'?4:0],'Final target must use the requested sample count')
    row.samples=samples
    if(snapshotEnabled){
      const key='dpr'+dpr+'-cpu'+rate
      const previous=snapshots.get(key)
      const captured=await captureFixed(page,previous?.configuration??null)
      const png=Buffer.from(captured.png.split(',')[1],'base64'),pixels={width:captured.width,height:captured.height,data:Buffer.from(captured.rgbaBase64,'base64')}
      await writeFile(path.join(output,caseName+'-fixed.png'),png)
      const repeated=await captureFixed(page,captured.configuration)
      const repeatedPng=Buffer.from(repeated.png.split(',')[1],'base64'),repeatedPixels={width:repeated.width,height:repeated.height,data:Buffer.from(repeated.rgbaBase64,'base64')}
      await writeFile(path.join(output,caseName+'-fixed-repeat.png'),repeatedPng)
      row.snapshot={configuration:captured.configuration,repeated:comparePixels(pixels,repeatedPixels),reference:previous?{caseName:previous.caseName,difference:comparePixels(previous.pixels,pixels)}:null}
      await writeFile(path.join(output,caseName+'-snapshot.json'),JSON.stringify(row.snapshot,null,2))
      assert.ok(new Set(pixels.data).size>32,'Fixed snapshot must contain varied nonblank scene pixels')
      assert.equal(row.snapshot.repeated.changedPixels,0,'Fixed repeated frames must be exactly stable before comparing antialiasing')
      if(mode==='card-only'){assert.equal(previous?.mode,'baseline','The omitted-pill control must compare against a full baseline frame');assert.ok(row.snapshot.reference.difference.changedPixels>0,'Omitting the visible pill must change pixels, proving the comparison detects a missing pass')}
      if(!previous)snapshots.set(key,{configuration:captured.configuration,pixels,caseName,mode})
    }
    await page.screenshot({path:path.join(output,caseName+'.png')})
    await writeFile(path.join(output,caseName+'.json'),JSON.stringify(row,null,2))
    results.runs.push(row)
    await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
    console.log(JSON.stringify({caseName,frames:row.frames,gpuFrames:row.gpuFrames,summary:row.summary}))
    await page.close()
  }
}finally{
  if(browser)await browser.close()
  await server.close()
}
