// Capture diagnostics — source/read timing and reuse decisions.
// Served modules carry the observations; package sources remain unchanged.
// Controls exceeded a 50 ms frame-p95 diagnostic threshold at 6× on
// 2026-10-14 (docs/performance-diagnosis.md). The observer owns collection.
import { replaceSource } from '../home-light/replaceSource.mjs'

export function observeCaptureDiagnostics(source, file) {
  if (file === 'packages/react/src/snapdomInputSvg.ts') return observeSvgReuseDecisions(source)
  if (file === 'packages/core/src/paint/rasterizedSource.ts') return observeCaptureAdmission(source)
  if (file === 'packages/react/src/snapdomInputRegions.ts') return observeRegionDecisions(source)
  if (file === 'packages/react/src/primitives/surface/surfaceSourceRuntime.ts') {
    source = replaceSource(source, '    anyUpload = true', `    anyUpload = true
    window.__munariPerf.record('uploadArmed', {sourceId:source.sourceId,read:pendingUploadRead,generation:pendingUploadGeneration,version:texture.version,width:source.canvas.width,height:source.canvas.height})`)
    source = replaceSource(source, '    const next = measureSurfaceChrome(chromeElement?.() ?? source.element)', `    const perfChromeStarted=performance.now()
    const next = measureSurfaceChrome(chromeElement?.() ?? source.element)
    window.__munariPerf.record('captureStage',{stage:'measureChromeSync',sourceId:source.sourceId,read:source.currentPaint()?.read??null,ms:performance.now()-perfChromeStarted})`)
  }
  return source
}

function observeCaptureAdmission(source) {
  source = replaceSource(source, '  let lastStartedAt = -Infinity', `  let lastStartedAt = -Infinity
  let perfFirstRequestAt: number | null = null
  let perfLatestRequestAt: number | null = null
  let perfRequestCount = 0
  let perfRequestsWhileCapturing = 0
  const perfRequestCauses = new Set<string>()`)
  source = replaceSource(source, '    let waiting = true', `    window.__munariPerf.record('captureAdmissionWait',{sourceId:body.sourceId,read:body.nextRead(),requestedMs:quietOwed,periodOwed,immediate,lastFinishedAt,lastStartedAt})
    let waiting = true`)
  source = replaceSource(source, '    const read = body.beginRead()', `    const read = body.beginRead()
    window.__munariPerf.record('captureReadStarted',{sourceId:body.sourceId,read,firstRequestAt:perfFirstRequestAt,latestRequestAt:perfLatestRequestAt,requestCount:perfRequestCount,requestsWhileCapturing:perfRequestsWhileCapturing,requestCauses:[...perfRequestCauses]})
    perfFirstRequestAt = perfLatestRequestAt = null
    perfRequestCount = perfRequestsWhileCapturing = 0
    perfRequestCauses.clear()`)
  source = replaceSource(source, '      const image = await rasterize(element, scaleX, scaleY)', `      const perfRasterStarted=performance.now()
      const image = await rasterize(element, scaleX, scaleY)
      window.__munariPerf.record('captureStage',{stage:'rasterizeWall',sourceId:body.sourceId,read,ms:performance.now()-perfRasterStarted})`)
  source = replaceSource(source, '      lastFinishedAt = clock.now()', `      lastFinishedAt = clock.now()
      window.__munariPerf.record('captureReadFinished',{sourceId:body.sourceId,read,changesDuringPaint})`)
  source = replaceSource(source, '  function request() {\n    if (disposed) return', `  function request(perfCause?: Event | string) {
    if (disposed) return
    const perfRequestedAt=performance.now()
    perfFirstRequestAt ??= perfRequestedAt
    perfLatestRequestAt = perfRequestedAt
    perfRequestCount++
    if (capturing) perfRequestsWhileCapturing++
    perfRequestCauses.add(typeof perfCause === 'string' ? perfCause : perfCause?.type ?? 'unspecified')`)
  source = replaceSource(source, "    if (live || input.isOpen()) request()", "    if (live || input.isOpen()) request('mutation')")
  source = replaceSource(source, "      if (!sameChain(hoverChain(), rasteredHover)) request()", "      if (!sameChain(hoverChain(), rasteredHover)) request('hover')")
  source = replaceSource(source, "  request()\n\n  return {", "  request('initial')\n\n  return {")
  source = replaceSource(source, "      if (options?.immediate) immediate = true\n      request()", "      if (options?.immediate) immediate = true\n      request('explicit')")
  source = replaceSource(source, "    if (reason === 'box' || reason === 'density') {\n      request()", "    if (reason === 'box' || reason === 'density') {\n      request(reason)")
  source = replaceSource(source, "if (rasteredStore[0] !== canvas.width || rasteredStore[1] !== canvas.height) request()", "if (rasteredStore[0] !== canvas.width || rasteredStore[1] !== canvas.height) request('rest')")
  return source
}

function observeRegionDecisions(source) {
  source = replaceSource(source, '  const observedAncestors = new WeakSet<Element>()', `  const observedAncestors = new WeakSet<Element>()
  let perfIdentity: {sourceId:number|null;read:number|null} = {sourceId:null,read:null}
  let perfClipReason = 'not-evaluated'
  let perfTemplateReason = 'not-evaluated'
  let perfTextReason = 'not-evaluated'
  const perfStage = (stage:string,started:number) => window.__munariPerf.record('captureStage',{...perfIdentity,stage,ms:performance.now()-started})
  const perfReject = <T,>(ok:T,reason:string,reject:(reason:string)=>void) => {if(!ok)reject(reason);return ok}`)
  source = replaceSource(source, '  const invalidated = () => {', `  const invalidated = (reason?:Event|string) => {
    window.__munariPerf.record('regionInvalidated',{...window.__munariPerf.identityFor(root),reason:typeof reason==='string'?reason:reason?.type??'unspecified',epoch:epoch+1})`)
  source = replaceSource(source, '  const invalidate = () => { refreshPending = true; invalidated() }', "  const invalidate = () => { refreshPending = true; invalidated('refresh') }")
  source = replaceSource(source, '      currentField = field\n      invalidated()', "      currentField = field\n      invalidated('focused-field-changed')")
  source = replaceSource(source, '    if (changed) invalidated()', `    if (changed) {
      window.__munariPerf.record('regionMutation',{...window.__munariPerf.identityFor(root),attributes:[...new Set(records.flatMap(record=>record.attributeName?[record.attributeName]:[]))],childList:records.some(record=>record.type==='childList'),characterData:records.some(record=>record.type==='characterData')})
      invalidated('dom-mutation')
    }`)
  source = replaceSource(source, '    invalidated()\n  }, listeners.signal)', '    invalidated(event)\n  }, listeners.signal)')
  source = replaceSource(source, 'root.contains(event.target)) invalidated()', 'root.contains(event.target)) invalidated(event)')

  if (source.includes('  const styles = (element: Element, style: CSSStyleDeclaration) => {')) {
    source = replaceSource(source,'  const styles = (element: Element, style: CSSStyleDeclaration) => {',`  const styles = (element: Element, style: CSSStyleDeclaration) => {
    const perfStylesStarted=performance.now()
    try {`)
    source = replaceSource(source,'    return serialized\n  }\n  const controlState',`    return serialized
    }finally{perfStage('snapshotStylePropertiesSync',perfStylesStarted)}
  }
  const controlState`)
  } else {
  source = replaceSource(source, `  const styles = (style: CSSStyleDeclaration) =>
    Array.from(style, (property) => \`\${property}:\${style.getPropertyValue(property)}\`).join(';')`, `  const styles = (style: CSSStyleDeclaration) => {
    const started=performance.now()
    try {return Array.from(style, (property) => \`\${property}:\${style.getPropertyValue(property)}\`).join(';')}
    finally {perfStage('snapshotStylePropertiesSync',started)}
  }`)
  }
  source = replaceSource(source, "  const controlState = (field: HTMLInputElement | null) => Array.from(root.querySelectorAll('input,textarea,select'), (control) => {", `  const controlState = (field: HTMLInputElement | null) => {
    const started=performance.now()
    try {return Array.from(root.querySelectorAll('input,textarea,select'), (control) => {`)
  source = replaceSource(source, '    return null\n  })\n  const ancestorPaint', `    return null
    })}finally{perfStage('snapshotControlStateSync',started)}
  }
  const ancestorPaint`)
  source = replaceSource(source, '  const ancestorPaint = (field: HTMLInputElement | null) => {', `  const ancestorPaint = (field: HTMLInputElement | null) => {
    const perfAncestorStarted=performance.now()`)
  source = replaceSource(source, '    return { ancestors, untransformed, boundedPaint }', `    perfStage('snapshotAncestorPaintSync',perfAncestorStarted)
    return { ancestors, untransformed, boundedPaint }`)
  source = replaceSource(source, '    const box = root.getBoundingClientRect()\n    const rect = field?.getBoundingClientRect()', `    const perfGeometryStarted=performance.now()
    const box = root.getBoundingClientRect()
    const rect = field?.getBoundingClientRect()
    perfStage('snapshotGeometrySync',perfGeometryStarted)`)
  source = replaceSource(source, '    const key = JSON.stringify([sx, sy', `    const perfKeyStarted=performance.now()
    const key = JSON.stringify([sx, sy`)
  source = replaceSource(source, '    const clip = rect ? clipFor(rect) : undefined', `    perfStage('snapshotKeyBuildSync',perfKeyStarted)
    const perfEligibilityStarted=performance.now()
    const clip = rect ? clipFor(rect) : undefined`)
  const oldEligibility=`    const eligible = cpuEligible && boundedPaint && field !== null && rect !== undefined && paint.untransformed && placeholderSupported
      && supportsGeometry(box, sx, sy) && document.fonts.status === 'loaded'
      && !root.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running')`
  source = replaceSource(source, oldEligibility, `    let perfEligibilityReason='eligible'
    const reject=(reason:string)=>{perfEligibilityReason=reason}
    const eligible = perfReject(cpuEligible,'cpu-field',reject)
      && perfReject(boundedPaint,'unbounded-paint-or-pseudo',reject)
      && perfReject(field !== null,'no-focused-text-input',reject)
      && perfReject(rect !== undefined,'no-field-rect',reject)
      && perfReject(paint.untransformed,'transformed',reject)
      && perfReject(placeholderSupported,'placeholder',reject)
      && perfReject(supportsGeometry(box, sx, sy),'geometry',reject)
      && perfReject(document.fonts.status === 'loaded','fonts-loading',reject)
      && perfReject(!root.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running'),'running-animation',reject)
    perfStage('snapshotEligibilitySync',perfEligibilityStarted)
    window.__munariPerf.record('regionEligibility',{...perfIdentity,eligible:Boolean(eligible),reason:perfEligibilityReason})`)

  const oldClip=`  const inputClip = (state: ReturnType<typeof snapshot>, field: HTMLInputElement | null, value: string | null) =>
    regionSupported && state.eligible && field !== null && cachedEpoch === epoch && cachedKey === state.key
      && cachedValue !== value && pendingInput?.field === field && pendingInput.value === value
      ? state.clip : undefined`
  source = replaceSource(source, oldClip, `  const inputClip = (state: ReturnType<typeof snapshot>, field: HTMLInputElement | null, value: string | null) => {
    perfClipReason='region'
    const reject=(reason:string)=>{perfClipReason=reason}
    return perfReject(regionSupported,'unsupported-region',reject)
      && perfReject(state.eligible,'snapshot-ineligible',reject)
      && perfReject(field !== null,'no-focused-text-input',reject)
      && perfReject(cachedEpoch === epoch,'cache-invalidated',reject)
      && perfReject(cachedKey === state.key,'snapshot-key-changed',reject)
      && perfReject(cachedValue !== value,'value-unchanged',reject)
      && perfReject(pendingInput?.field === field,'no-pending-input-for-field',reject)
      && perfReject(pendingInput.value === value,'pending-value-changed',reject)
      ? state.clip : undefined
  }`)
  const oldReusable=`  ) => clip && field && value !== null && inputSvg?.canReuse(field, value, scroll) ? inputSvg : null`
  source = replaceSource(source, oldReusable, `  ) => {
    perfTemplateReason='reused-svg'
    const reject=(reason:string)=>{perfTemplateReason=reason}
    return perfReject(clip,'no-region',reject)
      && perfReject(field,'no-field',reject)
      && perfReject(value !== null,'no-value',reject)
      && perfReject(inputSvg,'no-template',reject)
      && perfReject(inputSvg!.canReuse(field!, value!, scroll),'svg-eligibility',reject) ? inputSvg : null
  }`)
  source = replaceSource(source, '    if (!template || !field || value === null || textPreparation?.template !== template || !textPainter?.canReuse(field, value, scroll)) return false', `    perfTextReason='direct-text'
    if (!template) {perfTextReason='no-reusable-svg';return false}
    if (!field) {perfTextReason='no-field';return false}
    if (value === null) {perfTextReason='no-value';return false}
    if (textPreparation?.template !== template) {perfTextReason='not-prepared-for-template';return false}
    if (!textPainter) {perfTextReason='preparation-pending-or-ineligible';return false}
    if (!textPainter.canReuse(field, value, scroll)) {perfTextReason='text-eligibility';return false}`)
  source = replaceSource(source, '    if (!textPainter.paint(value)) {\n      cachedEpoch = previousEpoch', `    if (!textPainter.paint(value)) {
      perfTextReason='text-paint-rejected'
      cachedEpoch = previousEpoch`)
  source = replaceSource(source, "      if (disposed) throw new Error('munari: input region rasterizer is disposed')", `      if (disposed) throw new Error('munari: input region rasterizer is disposed')
      perfIdentity=window.__munariPerf.identityFor(root)
      perfClipReason=perfTemplateReason=perfTextReason='not-evaluated'`)
  source = replaceSource(source, '      if (!regionSupported) {\n        const invalidate = refreshPending', `      if (!regionSupported) {
        window.__munariPerf.record('regionPath',{...perfIdentity,path:'full',clipReason:'unsupported-region'})
        const invalidate = refreshPending`)
  source = replaceSource(source, '      if (!invalidate && unchangedInput(state, value, scroll)) {', `      if (!invalidate && unchangedInput(state, value, scroll)) {
        window.__munariPerf.record('regionPath',{...perfIdentity,path:'unchanged',clipReason:perfClipReason})`)
  source = replaceSource(source, '      if (paintText(template, field, value, scroll)) return canvas', `      if (paintText(template, field, value, scroll)) {
        window.__munariPerf.record('regionPath',{...perfIdentity,path:'direct-text',clipReason:perfClipReason,templateReason:perfTemplateReason,textReason:perfTextReason})
        return canvas
      }
      window.__munariPerf.record('regionPath',{...perfIdentity,path:template?'reused-svg':clip?'region':'full',clipReason:perfClipReason,templateReason:perfTemplateReason,textReason:perfTextReason,invalidate,cachedEpoch,epoch})`)
  source = replaceSource(source, '      regionSupported = false', `      window.__munariPerf.record('regionFallback',{...perfIdentity,reason:'unsupported-svg-region'})
      regionSupported = false`)
  return source
}

function observeSvgReuseDecisions(source) {
  return replaceSource(source, `      return candidate === field && printableAscii(next) && Array.from(next).every((character) => characters.has(character) || additionalCharacters.has(character))
        && nextScroll[0] === scroll[0] && nextScroll[1] === scroll[1]
        && candidate.selectionStart !== null && candidate.selectionStart === candidate.selectionEnd`, `      const reject=(reason:string)=>{window.__munariPerf.record('svgReuseRejected',{...window.__munariPerf.identityFor(field),reason});return false}
      if (candidate !== field) return reject('different-field')
      if (!printableAscii(next)) return reject('non-ascii')
      if (!Array.from(next).every((character) => characters.has(character) || additionalCharacters.has(character))) return reject('font-range')
      if (nextScroll[0] !== scroll[0] || nextScroll[1] !== scroll[1]) return reject('scroll-position')
      if (candidate.selectionStart === null || candidate.selectionStart !== candidate.selectionEnd) return reject('selection')
      return true`)
}
