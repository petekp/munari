// Performance observer — served-module measurements stay outside the package.
// Source revisions share the workload and dependencies; hashes identify library and lab changes.
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { replaceSource } from '../home-light/replaceSource.mjs'
import { observeCaptureDiagnostics } from './capture-diagnostics.mjs'

export function performanceObserver(root, commit, loadedSources, routeTiming = true, baselineDirectory = null, captureStages = false, captureStorage = null, captureDiagnostics = false) {
  const modulePath = id => path.relative(root, id.split('?')[0]).replaceAll(path.sep, '/')
  const owned = file => /^packages\/(core|react)\/src\/[\w./-]+\.(tsx?|css)$/.test(file) && !file.includes('..')
  const labFile = file => /^apps\/lab\/src\/[\w./-]+\.(tsx?|css)$/.test(file) && !file.includes('..')
  const measuredFile=file=>owned(file)||file.startsWith('apps/lab/src/')
  const baselineLab=baselineDirectory&&existsSync(path.join(baselineDirectory,'apps/lab/src'))
  const recordSource = (file, source) => {
    if (!measuredFile(file)) return
    const hash = createHash('sha256').update(source).digest('hex')
    if (loadedSources[file]) assert.equal(loadedSources[file], hash, `Source changed during benchmark: ${file}`)
    loadedSources[file] = hash
  }
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
      recordSource(file, source)
      if(captureDiagnostics)source=observeCaptureDiagnostics(source,file)
      if(captureStorage&&file==='packages/core/src/paint/domTextureSource.ts')return replaceSource(source,
        "captureMemory = adapter?.info.isFallbackAdapter ? 'cpu' : 'gpu'",
        `captureMemory = ${JSON.stringify(captureStorage)}`)
      if(file==='packages/react/src/snapdom.ts') {
        if(captureStages)source=observeSnapdom(source)
        const clipped=source.includes('options: CaptureRegionOptions')?'Boolean(options.clip)':'false'
        source=replaceSource(source,'  const capture = await snapdom(element, {',`  window.__munariPerf.record('captureRegion',{clipped:${clipped},cssArea:box.width*box.height});
  const capture = await snapdom(element, {`)
        source=replaceSource(source,'  return image\n',`  window.__munariPerf.record('captureRaster',{width:image.width,height:image.height});
  return image
`)
        return source
      }
      const captureObserver={
        'packages/react/src/snapdomInputSvg.ts':observeInputSvg,
        'packages/react/src/snapdomInputRegions.ts':observeInputRegions,
        'packages/react/src/snapdomFullBackground.ts':observeFullBackground,
        'packages/react/src/snapdomInputText.ts':observeInputText,
      }[file]
      if(captureObserver)return captureObserver(source,captureStages)
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
      return captureDiagnostics ? source : null
    },
  }
}

function observeInputSvg(source, captureStages) {
  if(captureStages) {
    const identityType='{sourceId:number|null;read:number|null}'
    source=replaceSource(source,'height: number): Promise<HTMLImageElement> {',`height: number, perfSvgIdentity?: ${identityType}): Promise<HTMLImageElement> {`)
    source=replaceSource(source,'    render(next: string) {',`    render(next: string) {
      const perfSvgIdentity=window.__munariPerf.identityFor(field)`)
    if(source.includes('    blank() {')) {
      source=replaceSource(source,'    blank() {',`    blank(perfSvgIdentity: ${identityType} = window.__munariPerf.identityFor(field)) {`)
      source=replaceSource(source,'height: number) => {',`height: number, perfSvgIdentity?: ${identityType}) => {`)
      source=replaceSource(source,'decodeBlankInput(document, inputs.indexOf(input), width, height)','decodeBlankInput(document, inputs.indexOf(input), width, height, perfSvgIdentity)')
    }
  }
  if(captureStages)source=replaceSource(source,
    '  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(document))}`',
    `  const perfSerializeStarted=performance.now();
  image.src = \`data:image/svg+xml;charset=utf-8,\${encodeURIComponent(new XMLSerializer().serializeToString(document))}\`;
  window.__munariPerf.record('captureStage',{...perfSvgIdentity,stage:'reusedSvgSerializeSync',ms:performance.now()-perfSerializeStarted})`)
  if(captureStages)source=replaceSource(source,'  await image.decode()',`  const started=performance.now();
  await image.decode()
  window.__munariPerf.record('captureStage',{...perfSvgIdentity,stage:'inputSvgDecodeWall',ms:performance.now()-started})`)
  source=replaceSource(source,'      return decodeInputSvg(document, width, height)',`      return decodeInputSvg(document, width, height${captureStages?', perfSvgIdentity':''}).then((image) => {
        window.__munariPerf.record('reusedInputSvg',{width:image.width,height:image.height});
        window.__munariPerf.record('captureRaster',{width:image.width,height:image.height});
        return image
      })`)
  if(source.includes('  return decodeInputSvg(blank, width, height)'))source=replaceSource(source,'  return decodeInputSvg(blank, width, height)',`  return decodeInputSvg(blank, width, height${captureStages?', perfSvgIdentity':''}).then((image) => {
    window.__munariPerf.record('inputBlankDecode',{});
    window.__munariPerf.record('captureRaster',{width:image.width,height:image.height});
    return image
  })`)
  return source
}

function observeFullBackground(source,captureStages) {
  source=replaceSource(source,'  let frame: BackgroundFrame | null = null','  const perfReusedBackgrounds=new WeakSet<HTMLImageElement>()\n  let frame: BackgroundFrame | null = null')
  source=replaceSource(source,'          images.set(image, frame)',`          perfReusedBackgrounds.add(image)
          images.set(image, frame)`)
  source=replaceSource(source,'        pending = backgroundCanvas',`        pending = backgroundCanvas
        window.__munariPerf.record('fullBackgroundPreparation',{...window.__munariPerf.identityFor(root),pixelBytes:width*height*4})`)
  source=replaceSource(source,'        const backgroundImage = await decodeImage(svgUrl(split.background), width, height)',`        const backgroundImage = await decodeImage(svgUrl(split.background), width, height)
        window.__munariPerf.record('captureRaster',{width:backgroundImage.width,height:backgroundImage.height})`)
  source=replaceSource(source,'      images.delete(image)',`      window.__munariPerf.record('fullBackgroundComposite',{...window.__munariPerf.identityFor(root),reused:perfReusedBackgrounds.has(image),pixelBytes:background.canvas.width*background.canvas.height*4})
      images.delete(image)`)
  if(captureStages) {
    source=replaceSource(source,'        const split = splitCapture(url, root)',`        const perfSplitStarted=performance.now()
        let split: ReturnType<typeof splitCapture>
        try { split = splitCapture(url, root) }
        finally { window.__munariPerf.record('captureStage',{...window.__munariPerf.identityFor(root),stage:'fullBackgroundSplitSync',width,height,ms:performance.now()-perfSplitStarted}) }`)
    source=replaceSource(source,'      context.drawImage(background.canvas, 0, 0, image.width, image.height)',`      const perfCompositeStarted=performance.now()
      context.drawImage(background.canvas, 0, 0, image.width, image.height)`)
    source=replaceSource(source,'      images.delete(image)',`      window.__munariPerf.record('captureStage',{...window.__munariPerf.identityFor(root),stage:'fullBackgroundCompositeSync',ms:performance.now()-perfCompositeStarted})
      images.delete(image)`)
  }
  return source
}

function observeInputRegions(source,captureStages) {
  const serialization = "Array.from(style, (property) => `${property}:${style.getPropertyValue(property)}`).join(';')"
  if(source.includes('    const previous = styleCache.get(element)')) {
    source=replaceSource(source,'      if (unchanged === count) return previous.serialized',`      if (unchanged === count) {
        window.__munariPerf.record('styleCacheHit',{properties:count})
        return previous.serialized
      }`)
    source=replaceSource(source,"    const serialized = parts.join(';')",`    const serialized = parts.join(';')
    window.__munariPerf.record('styleSerialization',{properties:count})`)
  } else if(source.includes(serialization)) {
    source=replaceSource(source,serialization,`(window.__munariPerf.record('styleSerialization',{properties:style.length}), ${serialization})`)
  }
  const unchanged='      if (!invalidate && unchangedInput(state, value, scroll)) {'
  if(source.includes(unchanged))source=replaceSource(source,unchanged,unchanged+`
        window.__munariPerf.record('unchangedInputFrame',{});`)
  if(!captureStages)return source
  const prepareTextMarker='    void prepareInputTextPainter({'
  if(source.includes(prepareTextMarker)) {
    source=replaceSource(source,prepareTextMarker,`    const perfTextPreparationIdentity=window.__munariPerf.identityFor(root)
    const perfTextPreparationStarted=performance.now()
    void prepareInputTextPainter({`)
    source=replaceSource(source,'    }).then((painter) => {',`    }).then((painter) => {
      window.__munariPerf.record('captureStage',{...perfTextPreparationIdentity,stage:'preparation',ms:performance.now()-perfTextPreparationStarted})`)
  }
  source=replaceSource(source,'      const state = snapshot(field, sx, sy)',`      const perfSnapshotStarted=performance.now();
const state = snapshot(field, sx, sy)
window.__munariPerf.record('captureStage',{...window.__munariPerf.identityFor(root),stage:'regionSnapshotSync',ms:performance.now()-perfSnapshotStarted})`)
  for(const [statement,stage] of [
    ['regionContext.drawImage(image, x, y, image.width, image.height)','regionSvgDrawSync'],
    ['context.drawImage(regionCanvas, left, top, width, height, left, top, width, height)','regionCopySync'],
    ['context.drawImage(image, x, y, image.width, image.height)','gpuRegionDrawSync'],
    ['context.drawImage(image, 0, 0, canvas.width, canvas.height)','fullCacheDrawSync'],
  ]) {
    if(source.includes(statement))source=replaceSource(source,statement,`{ const started=performance.now(); ${statement}; window.__munariPerf.record('captureStage',{...window.__munariPerf.identityFor(root),stage:'${stage}',ms:performance.now()-started}) }`)
  }
  return source
}

function observeInputText(source,captureStages) {
  if(captureStages&&source.includes('    const image = await template.blank()')) {
    source=replaceSource(source,'  blank(): Promise<HTMLImageElement>','  blank(perfSvgIdentity?: {sourceId:number|null;read:number|null}): Promise<HTMLImageElement>')
    source=replaceSource(source,'export async function prepareInputTextPainter(options: InputTextPainterOptions): Promise<InputTextPainter | null> {',`export async function prepareInputTextPainter(options: InputTextPainterOptions): Promise<InputTextPainter | null> {
  const perfTextPreparationIdentity=window.__munariPerf.identityFor(options.root)`)
    source=replaceSource(source,'    const image = await template.blank()','    const image = await template.blank(perfTextPreparationIdentity)')
  }
  source=replaceSource(source,'    const painter = createCertifiedPainter(options, paint, pixels, blank, ascent, descent, targetWidth, targetHeight)',`    const painter = createCertifiedPainter(options, paint, pixels, blank, ascent, descent, targetWidth, targetHeight)
    window.__munariPerf.record('preparedInputText',{})`)
  if(captureStages)source=replaceSource(source,'    paint(value: string) {',`    paint(value: string) {
      const perfDirectInputStarted=performance.now()`)
  source=replaceSource(source,'      return true\n    },\n    dispose() {',`      window.__munariPerf.record('directInputText',{painted:true})
      ${captureStages?"window.__munariPerf.record('captureStage',{...window.__munariPerf.identityFor(options.root),stage:'directInputTextSync',ms:performance.now()-perfDirectInputStarted})":""}
      return true
    },
    dispose() {`)
  return source
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
  const rawTarget=source.includes('  const url = capture.toRaw()')?'  const url = capture.toRaw()':'  image.src = capture.toRaw()'
  source=replaceSource(source,rawTarget,`  const perfRawStarted=performance.now(),perfRaw=capture.toRaw();
  window.__munariPerf.stage(perfCapture,'toRawSync',performance.now()-perfRawStarted);
  const perfInspectStarted=performance.now();
  const perfSVG=decodeURIComponent(perfRaw.slice(perfRaw.indexOf(',')+1));
  const perfFaces=[...perfSVG.matchAll(/@font-face\\s*\\{[^}]*\\}/g)];
  const perfFamilies=[...new Set(perfFaces.flatMap(face=>{const family=face[0].match(/font-family\\s*:\\s*([^;}]+)/);return family?[family[1].trim()]:[]}))];
  window.__munariPerf.record('capturePayload',{captureId:perfCapture.id,sourceId:perfCapture.sourceId,read:perfCapture.read,encodedPayloadChars:perfRaw.length,svgChars:perfSVG.length,fontFaces:perfFaces.length,fontFamilies:perfFamilies});
  window.__munariPerf.stage(perfCapture,'payloadInspectionSync',performance.now()-perfInspectStarted);
  ${rawTarget.startsWith('  const url')?'const url':'image.src'} = perfRaw`)
  if(source.includes('  image.src = layout ? normalizeRegionLayout(url, layout, capture.meta) : url')) {
    source=replaceSource(source,'  image.src = layout ? normalizeRegionLayout(url, layout, capture.meta) : url',`  const perfNormalizeStarted=performance.now();
  image.src = layout ? normalizeRegionLayout(url, layout, capture.meta) : url
  window.__munariPerf.stage(perfCapture,'normalizeSvgSync',performance.now()-perfNormalizeStarted)`);
  }
  if(source.includes('  const normalized = layout ? normalizeRegionLayout(url, layout, capture.meta) : null')) {
    source=replaceSource(source,'  const normalized = layout ? normalizeRegionLayout(url, layout, capture.meta) : null',`  const perfNormalizeStarted=performance.now();
  const normalized = layout ? normalizeRegionLayout(url, layout, capture.meta) : null`)
    const fullDecodeCondition=source.includes('  if (decodeFull) {')?'decodeFull'
      :source.includes('  if (!options.clip && options.decodeFull) {')?'!options.clip && options.decodeFull':null
    if(fullDecodeCondition) {
      source=replaceSource(source,`  if (${fullDecodeCondition}) {`,`  window.__munariPerf.stage(perfCapture,'normalizeSvgSync',performance.now()-perfNormalizeStarted)
  const perfDecodeStarted=performance.now()
  if (${fullDecodeCondition}) {`)
      source=replaceSource(source,'  image.width = width',`  window.__munariPerf.stage(perfCapture,${fullDecodeCondition}?'fullCapturePreparationWall':'imagePreparationWall',performance.now()-perfDecodeStarted)
  image.width = width`)
    } else {
      source=replaceSource(source,'  await image.decode()',`  window.__munariPerf.stage(perfCapture,'normalizeSvgSync',performance.now()-perfNormalizeStarted);
  await image.decode()`)
    }
  }
  if(!source.includes('options.decodeFull'))source=replaceSource(source,'  await image.decode()',`  const perfDecodeStarted=performance.now();
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
    sources: new Map(), events: [], gaps: [], totals:{preparedInputText:0,inputBlankDecode:0,fullBackgroundPreparation:0,fullBackgroundComposite:0,backgroundPixelBytes:0}, active: false, lastFrame: null, timingObservers:[], timingSupport:[],
    record(kind, values) {
      if(['preparedInputText','inputBlankDecode','fullBackgroundPreparation','fullBackgroundComposite'].includes(kind))this.totals[kind]++
      if(kind==='fullBackgroundComposite')this.totals.backgroundPixelBytes=Math.max(this.totals.backgroundPixelBytes,values.pixelBytes)
      if (this.active) this.events.push({kind,t:performance.now(),...values})
    },
    identityFor(element) {
      const source=[...this.sources.values()].find(entry=>entry.source.element===element||entry.source.element.contains(element))?.source
      return {sourceId:source?.sourceId??null,read:source?source.nextRead()-1:null}
    },
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
      return {events:this.events,gaps:this.gaps,phaseStartedAt:this.started,elapsedMs:performance.now()-this.started,timingSupport:this.timingSupport,totals:{...this.totals}}
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
