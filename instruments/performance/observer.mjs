// Performance observer — served-module measurements stay outside the package.
// Source revisions share the workload and dependencies; hashes identify library and lab changes.
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { replaceSource } from '../home-light/replaceSource.mjs'

export function performanceObserver(root, commit, loadedSources, routeTiming = true, baselineDirectory = null, captureStages = false) {
  const modulePath = id => path.relative(root, id.split('?')[0]).replaceAll(path.sep, '/')
  const owned = file => /^packages\/(core|react)\/src\/[\w./-]+\.(tsx?|css)$/.test(file) && !file.includes('..')
  const labFile = file => /^apps\/lab\/src\/[\w./-]+\.(tsx?|css)$/.test(file) && !file.includes('..')
  const baselineLab=baselineDirectory&&existsSync(path.join(baselineDirectory,'apps/lab/src'))
  return {
    name: 'munari-performance-observer', enforce: 'pre',
    load(id) {
      const file = modulePath(id)
      if (baselineDirectory&&(owned(file)||baselineLab&&labFile(file))) {
        const source=readFileSync(path.join(baselineDirectory, file), 'utf8')
        return new URLSearchParams(id.split('?')[1]??'').has('raw')?`export default ${JSON.stringify(source)};`:source
      }
      if (!commit || !(owned(file)||labFile(file))) return null
      const source=execFileSync('git', ['show', `${commit}:${file}`], { cwd: root, encoding: 'utf8' })
      return new URLSearchParams(id.split('?')[1]??'').has('raw')?`export default ${JSON.stringify(source)};`:source
    },
    transform(source, id) {
      if (new URLSearchParams(id.split('?')[1] ?? '').has('raw')) return null
      const file = modulePath(id)
      if (owned(file) || file.startsWith('apps/lab/src/')) {
        const hash = createHash('sha256').update(source).digest('hex')
        if (loadedSources[file]) assert.equal(loadedSources[file], hash, `Source changed during benchmark: ${file}`)
        loadedSources[file] = hash
      }
      if(captureStages&&file==='packages/react/src/snapdom.ts')return observeSnapdom(source)
      if(captureStages&&file==='packages/core/src/paint/rasterizedSource.ts')return replaceSource(source,'      draw(image, askedFor)',`      const perfDrawStarted=performance.now();
      draw(image, askedFor)
      window.__munariPerf.record('captureStage',{stage:'sourceDrawSync',sourceId:body.sourceId,read,ms:performance.now()-perfDrawStarted})`)
      if(captureStages&&file==='apps/lab/src/scenes/controls/Controls.tsx') {
        source=replaceSource(source,'function ControlsHardware() {',`function ControlsHardware() { window.__munariPerf.record('componentRender',{component:'ControlsHardware'});`)
        return replaceSource(source,'}) {\n  const box = useSurfaceAnchorBox()',`}) { window.__munariPerf.record('componentRender',{component:'PhysicalPiece'});
  const box = useSurfaceAnchorBox()`)
      }
      if (routeTiming && file.endsWith('/surfaceNativeRoute.ts')) {
        source = replaceSource(source, '{ hostSpace, inHostSpace }', '{ hostSpace as measuredHostSpace, inHostSpace }')
        source = replaceSource(source, 'step: (input, duties) => {', 'step: (input, duties) => { const perfStarted = performance.now(); try {')
        source = replaceSource(source, 'return handoff\n    },', `return handoff
        } finally { window.__munariPerf.record('route', {ms:performance.now()-perfStarted,request:input.request,capable:input.capable,hearing:input.hearing,route}); }
    },`)
        return source + `
function hostSpace(...args: Parameters<typeof measuredHostSpace>) {
  const started = performance.now();
  try { return measuredHostSpace(...args); }
  finally { window.__munariPerf.record('routeHostSpace', {ms:performance.now()-started}); }
}
`
      }
      if (file.endsWith('/surfaceSourceRuntime.ts')) {
        source = replaceSource(source, '  createDomTextureSource,', '  createDomTextureSource, paintStats,')
        source = replaceSource(source, 'texture.onUpdate = () => {', `texture.onUpdate = () => {
    window.__munariPerf.record('upload', {sourceId:source.sourceId,read:pendingUploadRead,generation:pendingUploadGeneration,version:texture?.version,width:source.canvas.width,height:source.canvas.height});`)
        source = replaceSource(source, 'source.dispose()', 'window.__munariPerf.sources.delete(source.sourceId); source.dispose()')
        return replaceSource(source, 'const unsubscribePaint = source.subscribePaint((receipt) => onPainted?.(receipt))', `window.__munariPerf.sources.set(source.sourceId, {source,texture:()=>texture,uploadedRead:()=>uploadedRead});
  window.__munariPerf.paintStats = paintStats;
  const unsubscribePaint = source.subscribePaint((receipt) => {
    window.__munariPerf.record('capture', {sourceId:source.sourceId,read:receipt.read,generation:receipt.frame.generation,width:receipt.storeSize[0],height:receipt.storeSize[1],changesDuringPaint:receipt.changesDuringPaint});
    onPainted?.(receipt);
  })`)
      }
      return null
    },
  }
}

function observeSnapdom(source) {
  const canvasReturn='  return canvas\n}',imageReturn='  return image\n}'
  const returnsCanvas=source.includes(canvasReturn),returnsImage=source.includes(imageReturn)
  assert.ok(returnsCanvas!==returnsImage,'Unknown snapDOM rasterizer return shape')
  if(returnsImage) {
    assert.ok(source.includes('  image.width = width\n  image.height = height\n  return image\n}'),'Decoded-image capture must carry its target dimensions')
    assert.ok(!source.includes('  context.drawImage(image, 0, 0, width, height)'),'Decoded-image capture unexpectedly has an intermediate draw')
  }
  source=replaceSource(source,'const capturePlugins = [fontPlugin, frameSplitPlugin, fieldPlugin]',`
const perfCaptures=new WeakMap<Element,{id:number;sourceId:number|null;read:number|null;started:number;firstCloneAt?:number;lastCloneAt?:number;beforeRenderAt?:number}>();
const perfFirstPlugin: SnapdomPlugin={name:'munari-perf-first',pure:true,
  afterClone(context){const capture=perfCaptures.get(context.element);if(!capture)return;capture.firstCloneAt=performance.now();window.__munariPerf.stage(capture,'clonePreparationWall',capture.firstCloneAt-capture.started)},
  beforeRender(context){const capture=perfCaptures.get(context.element);if(!capture)return;capture.beforeRenderAt=performance.now();window.__munariPerf.stage(capture,'cloneToRenderWall',capture.beforeRenderAt-(capture.lastCloneAt??capture.started))},
};
const perfLastPlugin: SnapdomPlugin={name:'munari-perf-last',pure:true,
  afterClone(context){const capture=perfCaptures.get(context.element);if(!capture)return;capture.lastCloneAt=performance.now();window.__munariPerf.stage(capture,'afterCloneHooksWall',capture.lastCloneAt-(capture.firstCloneAt??capture.started))},
  afterRender(context){const capture=perfCaptures.get(context.element);if(capture)window.__munariPerf.stage(capture,'renderWall',performance.now()-(capture.beforeRenderAt??capture.started))},
};
const capturePlugins=[perfFirstPlugin,fontPlugin,frameSplitPlugin,fieldPlugin,perfLastPlugin]`)
  source=replaceSource(source,'  const capture = await snapdom(element, {',`  const perfCapture=window.__munariPerf.beginCapture(element);
  perfCaptures.set(element,perfCapture);
  try {
  const capture = await snapdom(element, {`)
  source=replaceSource(source,'  for (const warning of capture.warnings',`  window.__munariPerf.stage(perfCapture,'snapdomWall',performance.now()-perfCapture.started);
  for (const warning of capture.warnings`)
  source=replaceSource(source,'  image.src = capture.toRaw()',`  const perfRawStarted=performance.now(),perfRaw=capture.toRaw();
  window.__munariPerf.stage(perfCapture,'toRawSync',performance.now()-perfRawStarted);
  const perfInspectStarted=performance.now();
  const perfSVG=decodeURIComponent(perfRaw.slice(perfRaw.indexOf(',')+1));
  const perfFaces=[...perfSVG.matchAll(/@font-face\\s*\\{[^}]*\\}/g)];
  const perfFamilies=[...new Set(perfFaces.flatMap(face=>{const family=face[0].match(/font-family\\s*:\\s*([^;}]+)/);return family?[family[1].trim()]:[]}))];
  window.__munariPerf.record('capturePayload',{captureId:perfCapture.id,sourceId:perfCapture.sourceId,read:perfCapture.read,encodedPayloadChars:perfRaw.length,svgChars:perfSVG.length,fontFaces:perfFaces.length,fontFamilies:perfFamilies});
  window.__munariPerf.stage(perfCapture,'payloadInspectionSync',performance.now()-perfInspectStarted);
  image.src = perfRaw`)
  source=replaceSource(source,'  await image.decode()',`  const perfDecodeStarted=performance.now();
  await image.decode()
  window.__munariPerf.stage(perfCapture,'decodeWall',performance.now()-perfDecodeStarted)`)
  if(returnsCanvas)source=replaceSource(source,'  context.drawImage(image, 0, 0, width, height)',`  const perfDrawStarted=performance.now();
  context.drawImage(image, 0, 0, width, height)
  window.__munariPerf.stage(perfCapture,'intermediateDrawSync',performance.now()-perfDrawStarted)`)
  const result=returnsCanvas?'canvas':'image'
  return replaceSource(source,returnsCanvas?canvasReturn:imageReturn,`  window.__munariPerf.record('rasterizerOutput',{captureId:perfCapture.id,sourceId:perfCapture.sourceId,read:perfCapture.read,outputType:'${returnsCanvas?'canvas':'decoded-image'}',width:${result}.width,height:${result}.height});
  return ${result}
  }finally{perfCaptures.delete(element)}
}`)
}

export function installObserver() {
  const observer = {
    sources: new Map(), events: [], gaps: [], active: false, lastFrame: null, timingObservers:[], timingSupport:[],
    record(kind, values) { if (this.active) this.events.push({kind,t:performance.now(),...values}) },
    beginCapture(element) {
      const source=[...this.sources.values()].find(entry=>entry.source.element===element)?.source
      this.captureSequence=(this.captureSequence??0)+1
      return {id:this.captureSequence,sourceId:source?.sourceId??null,read:source?source.nextRead()-1:null,started:performance.now()}
    },
    stage(capture,stage,ms) { this.record('captureStage',{captureId:capture.id,sourceId:capture.sourceId,read:capture.read,stage,ms}) },
    recordTiming(entry) {
      if(!this.active||entry.startTime<this.started)return
      const data=entry.toJSON()
      if(entry.entryType==='long-animation-frame')data.scripts=Array.from(entry.scripts,script=>script.toJSON())
      this.record('browserTiming',data)
    },
    start() { this.events=[];this.gaps=[];this.lastFrame=null;this.active=true;this.started=performance.now() },
    stop() {
      for (const observer of this.timingObservers) for (const entry of observer.takeRecords()) this.recordTiming(entry)
      this.active=false
      return {events:this.events,gaps:this.gaps,elapsedMs:performance.now()-this.started,timingSupport:this.timingSupport}
    },
  }
  window.__munariPerf = observer
  for (const type of ['event','long-animation-frame']) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue
    const timingObserver=new PerformanceObserver(list=>{
      for (const entry of list.getEntries()) observer.recordTiming(entry)
    })
    timingObserver.observe(type==='event'?{type,durationThreshold:16}:{type})
    observer.timingSupport.push(type)
    observer.timingObservers.push(timingObserver)
  }
  const frame = t => {
    if (observer.active) {
      if (observer.lastFrame !== null) observer.gaps.push(t-observer.lastFrame)
      observer.lastFrame=t
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
