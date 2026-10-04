// Input region proof — cached source pixels must match a fresh full Controls capture.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
import {replaceSource} from '../light/replaceSource.mjs'
const root=path.resolve(import.meta.dirname,'../..')
const output=path.resolve(process.env.REGION_OUTPUT??'/tmp/munari-input-regions')
assert.ok(!process.env.REGION_STORAGE||['cpu','gpu'].includes(process.env.REGION_STORAGE),'REGION_STORAGE must be cpu or gpu')
await mkdir(output,{recursive:true})
const plugin={name:'region-quality',enforce:'pre',transform(source,id){
 if(id.endsWith('/paint/domTextureSource.ts')) {
  if(process.env.REGION_GPU_CARRY==='1')source=replaceSource(source,'const kctx = captureContext(scratch)',"const kctx = scratch.getContext('2d')")
  if(process.env.REGION_STORAGE)source=replaceSource(source,
   "captureMemory = adapter?.info.isFallbackAdapter ? 'cpu' : 'gpu'",
   `captureMemory = ${JSON.stringify(process.env.REGION_STORAGE)}`)
  return source
 }
 if(id.endsWith('/controls/Controls.tsx'))return replaceSource(source,'export function ControlsApp() {','function OriginalControlsApp() {')+'\nexport function ControlsApp(){return <div className="controls-page"><ControlBoard /></div>}\n'
 if(id.endsWith('/src/snapdomInputRegions.ts')) {
  source=replaceSource(source,'  const styles = (element: Element, style: CSSStyleDeclaration) => {',`  const proveStyle = (style: CSSStyleDeclaration, serialized: string) => {
    if(window.regionProofCheckStyles){
      const expected=Array.from(style,property=>property+':'+style.getPropertyValue(property)).join(';')
      window.regionProofStyleIntegrityChecks=(window.regionProofStyleIntegrityChecks??0)+1
      if(serialized!==expected)(window.regionProofStyleMismatches??=[]).push({serialized,expected})
    }
    return serialized
  }
  const styles = (element: Element, style: CSSStyleDeclaration) => {`)
  source=replaceSource(source,'      if (unchanged === count) return previous.serialized',`      if (unchanged === count) {
        window.regionProofStyleCacheHits=(window.regionProofStyleCacheHits??0)+1
        return proveStyle(style,previous.serialized)
      }`)
  source=replaceSource(source,"    return serialized\n  }\n  const controlState",`    window.regionProofStyleSerializations=(window.regionProofStyleSerializations??0)+1
    return proveStyle(style,serialized)
  }
  const controlState`)
  if(process.env.REGION_FREEZE_STYLES==='1')source=replaceSource(source,'    let unchanged = 0',`    if(window.regionProofFreezeStyles&&previous&&previous.names.length===count){
      window.regionProofFrozenStyles=(window.regionProofFrozenStyles??0)+1
      return previous.serialized
    }
    let unchanged = 0`)
  if(process.env.REGION_IGNORE_INPUT_VERSION==='1')source=replaceSource(source,' && cachedInputVersion === inputVersion','')
  if(process.env.REGION_REUSE_FAILED_CACHE==='1')source=replaceSource(source,'    cpuStorage ??= context.getContextAttributes().willReadFrequently === true\n    cachedEpoch = -1','    cpuStorage ??= context.getContextAttributes().willReadFrequently === true')
  if(process.env.REGION_LOCAL_ORIGIN==='1'){
   source=replaceSource(source,'const bufferWidth = Math.min(state.width, Math.max(1, x + image.width))','const bufferWidth = image.width')
   source=replaceSource(source,'const bufferHeight = Math.min(state.height, Math.max(1, y + image.height))','const bufferHeight = image.height')
   source=replaceSource(source,'regionContext.clearRect(x, y, image.width, image.height)','regionContext.clearRect(0, 0, image.width, image.height)')
   source=replaceSource(source,'regionContext.drawImage(image, x, y, image.width, image.height)','regionContext.drawImage(image, 0, 0, image.width, image.height)')
   source=replaceSource(source,'context.drawImage(regionCanvas, left, top, width, height, left, top, width, height)','context.drawImage(regionCanvas, left - x, top - y, width, height, left, top, width, height)')
  }
  source=replaceSource(source,"    if (!context) throw new Error('munari: input region cache has no 2D context')","    window.regionProofCacheMemory=context?.getContextAttributes().willReadFrequently;\n    if (!context) throw new Error('munari: input region cache has no 2D context')")
  source=replaceSource(source,'      if (!fullBackground.paint(image, context)) context.drawImage(image, 0, 0, canvas.width, canvas.height)',`      if(window.regionProofDrawFail){window.regionProofDrawFail=false;throw new Error('deliberate region cache draw failure')}
      if (!fullBackground.paint(image, context)) context.drawImage(image, 0, 0, canvas.width, canvas.height)`)
  if(process.env.REGION_SHIFT_PATCH==='1')source=replaceSource(source,
   'context.drawImage(image, x, y, image.width, image.height)',
   'context.drawImage(image, x + 1, y, image.width, image.height)')
  return source
 }
 if(id.endsWith('/src/snapdomFullBackground.ts')){
  source=replaceSource(source,'  let frame: BackgroundFrame | null = null','  const proofReusedBackgrounds = new WeakSet<HTMLImageElement>()\n  let frame: BackgroundFrame | null = null')
  source=replaceSource(source,'    async decodeFull(url: string, width: number, height: number): Promise<HTMLImageElement> {',`    async decodeFull(url: string, width: number, height: number): Promise<HTMLImageElement> {
      window.regionProofBackgroundCalls=(window.regionProofBackgroundCalls??0)+1
      try {`)
  source=replaceSource(source,'    },\n    paint(image: HTMLImageElement, context: CanvasRenderingContext2D): boolean {',`      } finally { window.regionProofBackgroundFinished=(window.regionProofBackgroundFinished??0)+1 }
    },
    paint(image: HTMLImageElement, context: CanvasRenderingContext2D): boolean {`)
  source=replaceSource(source,'      if (!context?.getContextAttributes().willReadFrequently) return decodeImage(url, width, height)',`      if (!context?.getContextAttributes().willReadFrequently) {
        window.regionProofBackgroundFallbacks=(window.regionProofBackgroundFallbacks??0)+1
        return decodeImage(url, width, height)
      }`)
  source=replaceSource(source,'      if (!backgroundSizeSupported(width, height)) return decodeImage(url, width, height)',`      if (!backgroundSizeSupported(width, height)) {
        window.regionProofBackgroundBudgetFallbacks=(window.regionProofBackgroundBudgetFallbacks??0)+1
        window.regionProofBackgroundFallbacks=(window.regionProofBackgroundFallbacks??0)+1
        return decodeImage(url, width, height)
      }`)
  source=replaceSource(source,'        if (width * split.cssHeight !== height * split.cssWidth) return decodeImage(url, width, height)',`        if (width * split.cssHeight !== height * split.cssWidth) {
          window.regionProofBackgroundFallbacks=(window.regionProofBackgroundFallbacks??0)+1
          return decodeImage(url, width, height)
        }`)
  source=replaceSource(source,'        if (!split) return decodeImage(url, width, height)',`        if (!split) {
          window.regionProofBackgroundFallbacks=(window.regionProofBackgroundFallbacks??0)+1
          return decodeImage(url, width, height)
        }`)
  source=replaceSource(source,'          images.set(image, frame)','          proofReusedBackgrounds.add(image)\n          images.set(image, frame)')
  source=replaceSource(source,'        pending = backgroundCanvas',`        pending = backgroundCanvas
        window.regionProofBackgroundPreparations=(window.regionProofBackgroundPreparations??0)+1
        window.regionProofBackgroundPending={canvas:backgroundCanvas,signal}`)
  source=replaceSource(source,'        const backgroundImage = await decodeImage(svgUrl(split.background), width, height)',`        if(window.regionProofBackgroundDecodeFail){window.regionProofBackgroundDecodeFail=false;throw new Error('deliberate background decode failure')}
        if(window.regionProofBackgroundHold){window.regionProofBackgroundHold=false;await new Promise(resolve=>{window.regionProofBackgroundRelease=resolve})}
        const backgroundImage = await decodeImage(svgUrl(split.background), width, height)`)
  source=replaceSource(source,'      } catch {\n        if (pending)',`      } catch {
        window.regionProofBackgroundFallbacks=(window.regionProofBackgroundFallbacks??0)+1
        if (pending)`)
  source=replaceSource(source,'      context.drawImage(background.canvas, 0, 0, image.width, image.height)',`      context.drawImage(background.canvas, 0, 0, image.width, image.height)
      if(window.regionProofBackgroundDrawFail){window.regionProofBackgroundDrawFail=false;throw new Error('deliberate background draw failure')}`)
  source=replaceSource(source,'      images.delete(image)\n      return true',`      images.delete(image)
      if(proofReusedBackgrounds.has(image))window.regionProofBackgroundHits=(window.regionProofBackgroundHits??0)+1
      else window.regionProofBackgroundPreparedPaints=(window.regionProofBackgroundPreparedPaints??0)+1
      return true`)
  if(process.env.REGION_FREEZE_BACKGROUND==='1')source=replaceSource(source,'        const key = `${width}x${height}:${split.key}`',`        let key = \`\${width}x\${height}:\${split.key}\`
        if(window.regionProofFreezeBackground&&frame){key=frame.key;window.regionProofFrozenBackgrounds=(window.regionProofFrozenBackgrounds??0)+1}`)
  return source
 }
 if(id.endsWith('/src/snapdomInputText.ts')){
  if(process.env.REGION_AUTO_KERNING==='1')source=replaceSource(source,'    configureText(context, paint)\n    context.beginPath()',"    configureText(context, paint)\n    if(window.regionProofAutoKerningActive)context.fontKerning='auto'\n    context.beginPath()")
  source=replaceSource(source,'    !disposed && !options.signal.aborted && field === options.field','    !window.regionProofForceSvg && !disposed && !options.signal.aborted && field === options.field')
  source=replaceSource(source,'  !options.signal.aborted && options.root.contains(options.field)','  !window.regionProofForceSvg && !options.signal.aborted && options.root.contains(options.field)')
  source=replaceSource(source,'  attachTextCanvas(certificate, paint)',`  attachTextCanvas(certificate, paint)
  window.regionProofTextPreparations=(window.regionProofTextPreparations??0)+1`)
  source=replaceSource(source,'    const image = await template.blank()',`    const imagePromise=template.blank()
    if(window.regionProofTextHold){window.regionProofTextHold=false;window.regionProofTextPending={certificate,blank,signal};await new Promise(resolve=>{window.regionProofTextRelease=resolve})}
    const image = await imagePromise`)
  source=replaceSource(source,'        context.drawImage(blank, pixels.left, pixels.top)',`        window.regionProofTextAttempts=(window.regionProofTextAttempts??0)+1
        context.drawImage(blank, pixels.left, pixels.top)
        if(window.regionProofTextDrawFail){window.regionProofTextDrawFail=false;throw new Error('deliberate text draw failure')}`)
  source=replaceSource(source,'      return true\n    },\n    dispose()',`      window.regionProofTextHits=(window.regionProofTextHits??0)+1
      return true
    },
    dispose()`)
  return replaceSource(source,"    signal.removeEventListener('abort', releasePending)",`    signal.removeEventListener('abort', releasePending)
    window.regionProofTextFinished=(window.regionProofTextFinished??0)+1`)
 }
 if(id.endsWith('/src/snapdomInputSvg.ts')){
  source=replaceSource(source,'    render(next: string) {','    async render(next: string) {')
  return replaceSource(source,'      return decodeInputSvg(document, width, height)',`      window.regionProofSvgAttempts=(window.regionProofSvgAttempts??0)+1
      if(window.regionProofSvgFail){window.regionProofSvgFail=false;throw new Error('deliberate region decode failure')}
      if(window.regionProofSvgHold){window.regionProofSvgHold=false;await new Promise(resolve=>{window.regionProofRelease=resolve})}
      const image=await decodeInputSvg(document, width, height)
      window.regionProofSvgHits=(window.regionProofSvgHits??0)+1
      return image`)
 }
 if(!id.endsWith('/src/snapdom.ts'))return null
 if(process.env.REGION_LEGACY_VIEWPORT==='1')source=replaceSource(source,
  'layout ? normalizeRegionLayout(url, layout, capture.meta) : null','null')
 source=replaceSource(source,
  "const root = new DOMParser().parseFromString(decodeURIComponent(url.slice(comma + 1)), 'image/svg+xml').documentElement",
  "const root = new DOMParser().parseFromString(decodeURIComponent(url.slice(comma + 1)), 'image/svg+xml').documentElement; if(window.regionProofUnknownViewport)root.querySelector('foreignObject')?.remove()")
 source=replaceSource(source,'  const capture = await snapdom(element, {',`  if(!window.regionProofReference)window.regionProofCalls?.push({clip:options.clip??null,invalidate:options.invalidate??false});
  if(window.regionProofHoldBeforeCapture && options.clip){window.regionProofHoldBeforeCapture=false;await new Promise(resolve=>{window.regionProofReleaseBeforeCapture=resolve})}
  const capture = await snapdom(element, {`)
 source=replaceSource(source,'  if (decodeFull) {',`  if(!options.clip&&options.decodeFull&&!decodeFull){
    window.regionProofBackgroundViewportFallbacks=(window.regionProofBackgroundViewportFallbacks??0)+1
    window.regionProofBackgroundFallbacks=(window.regionProofBackgroundFallbacks??0)+1
  }
  if (decodeFull) {`)
 source=replaceSource(source,'  await image.decode()',`  if(window.regionProofFail && options.clip){window.regionProofFail=false;throw new Error('deliberate region decode failure')}
  if(window.regionProofHold && options.clip){window.regionProofHold=false;await new Promise(resolve=>{window.regionProofRelease=resolve})}
  await image.decode()`)
 return source+`\nwindow.regionProofFull=async(root,sx,sy)=>{window.regionProofReference=true;try{return await rasterize(root,sx,sy,{invalidate:true})}finally{window.regionProofReference=false}}\n`
}}
const server=await createServer({root:path.join(root,'apps/lab'),cacheDir:path.join(output,'.vite'),plugins:[plugin],server:{host:'127.0.0.1',port:0,watch:null,fs:{allow:[root]}},logLevel:'warn'})
let browser
const results=[]
try{
 await server.listen()
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,defaultViewport:{width:1440,height:1000,deviceScaleFactor:2},args:['--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']})
 const page=await browser.newPage();const errors=[]
 if(process.env.REGION_NO_SCHEDULER==='1')await page.evaluateOnNewDocument(()=>{Object.defineProperty(globalThis,'scheduler',{configurable:true,value:undefined})})
 page.on('pageerror',e=>errors.push(String(e)))
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=controls&framed&capture=snapdom`,{waitUntil:'load'})
 await page.waitForFunction(()=>window.regionProofFull&&document.querySelector('.controls-board'))
 if(process.env.REGION_NO_SCHEDULER==='1')assert.equal(await page.evaluate(()=>globalThis.scheduler===undefined),true,'The timer-fallback fixture must remove scheduler before the app loads')
 await page.evaluate(async(root)=>{
  await document.fonts.ready
  const {createDomTextureSource}=await import(root+'/packages/react/src/advanced.ts')
  const form=document.querySelector('.controls-board');form.remove();window.regionProofCalls=[];window.regionProofErrors=[];window.regionProofPristineForm=form.cloneNode(true)
  const source=createDomTextureSource(form,760,540,{scale:2,onError:error=>window.regionProofErrors.push(String(error))})
  document.getElementById('root').append(source.host);source.setHostPainted(true)
  window.regionProof={source,form,input:form.querySelector('[data-munari-anchor="field:project"]')}
  window.regionProofTakeBackgroundCounts=()=>{
   const counts={}
   for(const name of ['Calls','Hits','Preparations','PreparedPaints','Fallbacks','BudgetFallbacks','ViewportFallbacks']){
    counts['background'+name]=window['regionProofBackground'+name]??0
    window['regionProofBackground'+name]=0
   }
   counts.frozenBackgrounds=window.regionProofFrozenBackgrounds??0;window.regionProofFrozenBackgrounds=0
   return counts
  }
  window.regionProofReadStylePixels=async()=>{
   const canvas=source.canvas,image=await window.regionProofFull(form,canvas.width/form.offsetWidth,canvas.height/form.offsetHeight)
   const ref=document.createElement('canvas');ref.width=canvas.width;ref.height=canvas.height
   const context=ref.getContext('2d',{willReadFrequently:canvas.getContext('2d').getContextAttributes().willReadFrequently})
   context.drawImage(image,0,0,image.width,image.height)
   return {pixels:context.getImageData(0,0,ref.width,ref.height).data,width:ref.width,height:ref.height,value:window.regionProof.input.value}
  }
  window.regionProofRequiredRead=source.nextRead()
  document.addEventListener('input',event=>{if(form.contains(event.target))window.regionProofRequiredRead=Math.max(window.regionProofRequiredRead,source.nextRead())},true)
  for(const name of ['repaint','setScale','setSize']){
   const original=source[name].bind(source)
   source[name]=(...args)=>{const read=source.nextRead(),before=JSON.stringify([source.size(),source.rasterScale()]);const result=original(...args);if(name==='repaint'||before!==JSON.stringify([source.size(),source.rasterScale()]))window.regionProofRequiredRead=Math.max(window.regionProofRequiredRead,read);return result}
  }

 },'/@fs'+root)
 const settled=async()=>{await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,650)));await page.waitForFunction(()=>window.regionProof.source.currentPaint()?.read>=window.regionProofRequiredRead)}
 const rememberStylePixels=async()=>page.evaluate(async()=>{window.regionProofBeforeStyle=await window.regionProofReadStylePixels()})
 const compareStylePixels=async(name)=>{
  const result=await page.evaluate(async(name)=>{
   const before=window.regionProofBeforeStyle,after=await window.regionProofReadStylePixels()
   let changed=0
   if(before.width===after.width&&before.height===after.height)for(let index=0;index<before.pixels.length;index+=4)if([0,1,2,3].some(channel=>before.pixels[index+channel]!==after.pixels[index+channel]))changed++
   const result={name,changed,beforeWidth:before.width,afterWidth:after.width,beforeHeight:before.height,afterHeight:after.height,beforeValue:before.value,afterValue:after.value}
   window.regionProofBeforeStyle=null;window.regionProofStyleVisibility=result
   return result
  },name)
  assert.equal(result.afterWidth,result.beforeWidth,`${name}: style visibility comparison must preserve width`)
  assert.equal(result.afterHeight,result.beforeHeight,`${name}: style visibility comparison must preserve height`)
  assert.equal(result.afterValue,result.beforeValue,`${name}: style visibility comparison must precede the input edit`)
  assert.ok(result.changed>0,`${name}: style change must alter full-capture pixels before typing`)
 }
 const seedShort=async()=>{
  await page.evaluate(()=>{const {input,source}=window.regionProof;input.value='aa';input.setSelectionRange(0,0);input.scrollLeft=0;source.repaint({immediate:true})})
  await settled()
  await page.keyboard.type('a');await settled()
 }
 const holdBackground=async(background)=>{
  await page.evaluate(background=>{const {form,source}=window.regionProof;window.regionProofBackgroundPaintsBeforeHold=source.paintCount();window.regionProofBackgroundHold=true;form.style.background=background;source.repaint({immediate:true})},background)
  await page.waitForFunction(()=>Boolean(window.regionProofBackgroundRelease))
  const pending=await page.evaluate(()=>{window.regionProofHeldBackground=window.regionProofBackgroundPending;const {canvas,signal}=window.regionProofHeldBackground;return {width:canvas.width,height:canvas.height,aborted:signal.aborted,paintCount:window.regionProof.source.paintCount(),before:window.regionProofBackgroundPaintsBeforeHold}})
  assert.ok(pending.width>0&&pending.height>0);assert.equal(pending.aborted,false);assert.equal(pending.paintCount,pending.before)
 }
 const holdSvg=async()=>{
  await page.evaluate(()=>{const {input}=window.regionProof;window.regionProofForceSvg=true;input.setSelectionRange(0,0);input.scrollLeft=0;window.regionProofSvgHold=true})
  for(let attempt=0;attempt<3;attempt++){
   const before=await page.evaluate(()=>window.regionProof.source.paintCount())
   await page.keyboard.type('a')
   await page.waitForFunction(before=>Boolean(window.regionProofRelease)||window.regionProof.source.paintCount()>before,{},before)
   if(await page.evaluate(()=>Boolean(window.regionProofRelease)))return
   await settled()
  }
  assert.fail('A cached decode must consume the hold')
 }
 const holdTextPreparation=async()=>{
  await page.evaluate(()=>{const {input,source}=window.regionProof;window.regionProofForceSvg=false;window.regionProofTextHold=true;input.value='aa';input.setSelectionRange(0,0);input.scrollLeft=0;source.repaint({immediate:true})})
  await settled()
  await page.keyboard.type('a')
  await page.waitForFunction(()=>Boolean(window.regionProofTextRelease))
  await page.waitForFunction(()=>window.regionProof.source.currentPaint()?.read>=window.regionProofRequiredRead)
  const pending=await page.evaluate(()=>{const {certificate,blank,signal}=window.regionProofTextPending;return {connected:certificate.isConnected,certificateWidth:certificate.width,blankWidth:blank.width,aborted:signal.aborted}})
  assert.equal(pending.connected,true);assert.ok(pending.certificateWidth>0&&pending.blankWidth>0);assert.equal(pending.aborted,false)
 }
 const compare=async(name,requirePartial=false,proofKey='regionProof')=>{
  await settled()
  const result=await page.evaluate(async(proofKey)=>{
   const {source,form,input}=window[proofKey],canvas=source.canvas
   const image=await window.regionProofFull(form,canvas.width/form.offsetWidth,canvas.height/form.offsetHeight)
   const storage=canvas.getContext('2d').getContextAttributes().willReadFrequently
   const ref=document.createElement('canvas');ref.width=canvas.width;ref.height=canvas.height;ref.getContext('2d',{willReadFrequently:storage}).drawImage(image,0,0,image.width,image.height)
   const a=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,b=ref.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data
   let changed=0,max=0;for(let i=0;i<a.length;i+=4){let difference=false;for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);max=Math.max(max,d);difference||=d>0}changed+=Number(difference)}
   const intermediateFrames=(window.regionProofFlowFrames??[]).map(frame=>{
    let changed=0
    if(frame.width!==canvas.width||frame.height!==canvas.height)return {read:frame.read,changed:null}
    for(let i=0;i<b.length;i+=4)if([0,1,2,3].some(c=>frame.pixels[i+c]!==b[i+c]))changed++
    return {read:frame.read,changed}
   })
   const backgroundFrames=(window.regionProofBackgroundFrames??[]).map(frame=>{
    const before=window.regionProofBackgroundBeforePixels
    const references=[{pixels:b,width:canvas.width,height:canvas.height},before].filter(reference=>reference&&reference.width===frame.width&&reference.height===frame.height)
    const matchesCapturedOrFinal=references.some(reference=>{for(let index=0;index<frame.pixels.length;index++)if(frame.pixels[index]!==reference.pixels[index])return false;return true})
    return {read:frame.read,width:frame.width,height:frame.height,matchesCapturedOrFinal}
   })
   const svgHits=window.regionProofSvgHits??0,svgAttempts=window.regionProofSvgAttempts??0;window.regionProofSvgHits=0;window.regionProofSvgAttempts=0
   const textHits=window.regionProofTextHits??0,textAttempts=window.regionProofTextAttempts??0,textPreparations=window.regionProofTextPreparations??0;window.regionProofTextHits=0;window.regionProofTextAttempts=0;window.regionProofTextPreparations=0
   const styleCacheHits=window.regionProofStyleCacheHits??0,styleSerializations=window.regionProofStyleSerializations??0,frozenStyles=window.regionProofFrozenStyles??0,styleIntegrityChecks=window.regionProofStyleIntegrityChecks??0,styleMismatches=window.regionProofStyleMismatches??[];window.regionProofStyleCacheHits=0;window.regionProofStyleSerializations=0;window.regionProofFrozenStyles=0;window.regionProofStyleIntegrityChecks=0;window.regionProofStyleMismatches=[]
   const styleVisibility=window.regionProofStyleVisibility??null;window.regionProofStyleVisibility=null
   const backgroundCounts=window.regionProofTakeBackgroundCounts()
   return {backgroundFrames,...backgroundCounts,styleVisibility,styleCacheHits,styleSerializations,frozenStyles,styleIntegrityChecks,styleMismatches,textHits,textAttempts,textPreparations,svgHits,svgAttempts,intermediateFrames,changed,max,storage,cacheStorage:window.regionProofCacheMemory??null,width:canvas.width,height:canvas.height,value:input.value,focused:document.activeElement===input,calls:window.regionProofCalls.splice(0),errors:window.regionProofErrors.splice(0),png:canvas.toDataURL(),reference:ref.toDataURL()}
  },proofKey)
  for(const key of ['png','reference']){await writeFile(path.join(output,`${name}-${key}.png`),Buffer.from(result[key].split(',')[1],'base64'));delete result[key]}
  results.push({name,...result});await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
  if(process.env.REGION_STORAGE)assert.equal(result.storage,process.env.REGION_STORAGE==='cpu',`${name}: requested storage must be exercised`)
  assert.equal(result.cacheStorage,result.storage,`${name}: region and source storage must match`)
  assert.equal(result.changed,0,`${name}: source pixels must equal a fresh full capture`)
  assert.deepEqual(result.styleMismatches,[],`${name}: cached serialization must equal the complete current declaration`)
  for(const frame of result.intermediateFrames)assert.equal(frame.changed,0,`${name}: every published frame must equal the stable full capture`)
  for(const frame of result.backgroundFrames)assert.equal(frame.matchesCapturedOrFinal,true,`${name}: every background frame must equal a complete captured state`)
  if(!['decode-recovery','svg-decode-recovery','cache-draw-recovery','text-draw-recovery','background-draw-recovery'].includes(name))assert.deepEqual(result.errors,[],`${name}: capture must succeed`)
  if(requirePartial)assert.ok(result.textHits>0||result.svgHits>0||result.calls.some(c=>c.clip),`${name}: must exercise partial capture`)
  return result
 }
 await settled();await page.focus('[data-munari-anchor="field:project"]');const focused=await compare('focused')
 let timerFallback=null
 if(process.env.REGION_NO_SCHEDULER==='1'){assert.equal(focused.storage,true,'The timer-fallback fixture requires CPU storage');assert.ok(focused.backgroundPreparations>0,'The timer fallback must prepare a background');assert.ok(focused.backgroundHits>0,'The timer fallback must reuse a background');timerFallback={schedulerAbsent:await page.evaluate(()=>globalThis.scheduler===undefined),backgroundPreparations:focused.backgroundPreparations,backgroundHits:focused.backgroundHits};assert.equal(timerFallback.schedulerAbsent,true)}
 const directTextSupported=focused.storage
 let disposed,wrappedDisposed=null
 if(process.env.REGION_UNKNOWN_VIEWPORT==='1'){
  assert.equal(await page.evaluate(()=>window.regionProof.source.canvas.getContext('2d').getContextAttributes().willReadFrequently),true,'Unknown viewport proof requires CPU storage')
  await page.evaluate(()=>{window.regionProofUnknownViewport=true})
  await page.keyboard.type('u');const fallback=await compare('unsupported-svg-fallback');assert.ok(fallback.calls.some(call=>call.clip)&&fallback.calls.some(call=>!call.clip))
  await page.evaluate(()=>{window.regionProofUnknownViewport=false})
  await page.keyboard.type('v');const disabled=await compare('unsupported-svg-stays-full');assert.ok(disabled.calls.length>0&&disabled.calls.every(call=>!call.clip))
  disposed=await page.evaluate(()=>{const {source}=window.regionProof;const before=source.paintCount();source.dispose();return {before,after:source.paintCount(),connected:source.host.isConnected}})
 }else{
 const backgroundSupported=focused.storage
 await page.evaluate(()=>{const {form,source}=window.regionProof;window.regionProofBackgroundFixture={style:form.getAttribute('style'),heading:form.querySelector('h2').textContent};form.querySelector('h2').textContent='Background retained, content changed';source.repaint({immediate:true})})
 const backgroundContent=await compare('background-content-change');assert.ok(backgroundContent.calls.some(call=>!call.clip));if(backgroundSupported)assert.ok(backgroundContent.backgroundHits>0,'A full content update must reuse the accepted background');else{assert.equal(backgroundContent.backgroundHits,0);assert.equal(backgroundContent.backgroundPreparations,0)}
 const beforeBackgroundSubmit=await page.evaluate(()=>{window.regionProofRequiredRead=Math.max(window.regionProofRequiredRead,window.regionProof.source.nextRead());return window.__apiControls.actions.length})
 await page.keyboard.press('Enter');await page.waitForFunction(before=>window.__apiControls.actions.length>before,{},beforeBackgroundSubmit)
 const backgroundSubmit=await compare('background-submit');assert.equal(await page.evaluate(()=>window.__apiControls.actions.at(-1).trusted),true);assert.equal(backgroundSubmit.focused,true);assert.ok(backgroundSubmit.calls.some(call=>!call.clip));if(backgroundSupported)assert.ok(backgroundSubmit.backgroundHits>0,'Submission must reuse the background while capturing changed content')
 const inactiveBackgroundSetup=await page.evaluate(()=>{const {form,source}=window.regionProof;Object.assign(form.style,{maskPosition:'0% 0%',maskSize:'auto',maskRepeat:'repeat',maskMode:'match-source',maskComposite:'add',maskOrigin:'border-box',maskClip:'border-box',backgroundBlendMode:'normal, normal'});source.repaint({immediate:true});const style=getComputedStyle(form);return {maskImage:style.maskImage,maskPosition:style.maskPosition,maskSize:style.maskSize,maskRepeat:style.maskRepeat,maskMode:style.maskMode,maskComposite:style.maskComposite,maskOrigin:style.maskOrigin,maskClip:style.maskClip,backgroundBlendMode:style.backgroundBlendMode}})
 assert.deepEqual(inactiveBackgroundSetup,{maskImage:'none',maskPosition:'0% 0%',maskSize:'auto',maskRepeat:'repeat',maskMode:'match-source',maskComposite:'add',maskOrigin:'border-box',maskClip:'border-box',backgroundBlendMode:'normal, normal'})
 const inactiveBackground=await compare('background-inactive-mask-defaults');assert.equal(inactiveBackground.backgroundPreparations,0);if(backgroundSupported)assert.ok(inactiveBackground.backgroundHits>0,'Inactive mask and normal blend defaults must reuse the current background');else assert.equal(inactiveBackground.backgroundHits,0)
 await page.evaluate(()=>{const {form,source}=window.regionProof;form.setAttribute('style',window.regionProofBackgroundFixture.style);source.repaint({immediate:true})});const inactiveRestored=await compare('background-inactive-mask-restored');assert.equal(inactiveRestored.backgroundPreparations,0);if(backgroundSupported)assert.ok(inactiveRestored.backgroundHits>0)
 await rememberStylePixels();if(process.env.REGION_FREEZE_BACKGROUND==='1')await page.evaluate(()=>{window.regionProofFreezeBackground=true});await page.evaluate(()=>{window.regionProof.form.style.background='linear-gradient(135deg,rgb(225,235,250),rgb(180,205,230))'});await compareStylePixels('background-root-change');await page.evaluate(()=>window.regionProof.source.repaint({immediate:true}))
 const backgroundChanged=await compare('background-root-change');if(backgroundSupported){assert.ok(backgroundChanged.backgroundPreparations>0,'Changed root paint must prepare a new background');assert.equal(backgroundChanged.backgroundHits,0,'Changed root paint must not use the old background')}
 if(backgroundSupported){
  await page.evaluate(()=>{const {form,source}=window.regionProof;window.regionProofBackgroundDecodeFail=true;form.style.background='linear-gradient(135deg,rgb(235,220,245),rgb(195,170,220))';source.repaint({immediate:true})})
  const backgroundFailed=await compare('background-decode-fallback');assert.equal(await page.evaluate(()=>window.regionProofBackgroundDecodeFail),false,'The new background decode must consume the fault');assert.ok(backgroundFailed.backgroundFallbacks>0);assert.equal(backgroundFailed.backgroundHits,0);assert.deepEqual(await page.evaluate(()=>({width:window.regionProofBackgroundPending.canvas.width,height:window.regionProofBackgroundPending.canvas.height})),{width:0,height:0})
 }
 for(const [name,styles] of [['opacity',{opacity:'.6'}],['filter',{filter:'blur(1px)'}],['backdrop',{backdropFilter:'blur(1px)'}],['blend',{mixBlendMode:'multiply'}],['mask',{maskImage:'linear-gradient(90deg,transparent,black)'}],['transparent',{background:'transparent'}],['alpha',{background:'rgba(240,200,130,.5)'}]]){
  await page.evaluate(styles=>{const {form,source}=window.regionProof;form.setAttribute('style',window.regionProofBackgroundFixture.style);Object.assign(form.style,styles);source.repaint({immediate:true})},styles)
  const unsupported=await compare('background-unsupported-'+name);if(!['transparent','alpha'].includes(name)){assert.equal(unsupported.backgroundHits,0);assert.equal(unsupported.backgroundPreparations,0);if(backgroundSupported)assert.ok(unsupported.backgroundFallbacks>0,'Unsupported root paint must use the full SVG')}
 }
 await page.evaluate(()=>{const {form,source}=window.regionProof;form.setAttribute('style',window.regionProofBackgroundFixture.style);source.repaint({immediate:true})});await compare('background-rounded-seed')
 await rememberStylePixels()
 await page.evaluate(()=>{const {form}=window.regionProof;const overlap=document.createElement('div');Object.assign(overlap.style,{position:'absolute',left:'1px',top:'1px',width:'80px',height:'80px',background:'rgb(230,20,30)',pointerEvents:'none'});form.append(overlap);window.regionProofBackgroundOverlap=overlap})
 await compareStylePixels('background-rounded-overlap');await page.evaluate(()=>window.regionProof.source.repaint({immediate:true}))
 const overlapBackground=await compare('background-rounded-overlap');if(backgroundSupported)assert.ok(overlapBackground.backgroundHits>0,'Corner overlap must exercise background composition')
 for(const [name,styles] of [['alpha',{background:'rgba(230,20,30,.4)'}],['shadow',{background:'transparent',boxShadow:'0 0 12px rgba(20,30,60,.5)'}]]){
  await page.evaluate(styles=>{Object.assign(window.regionProofBackgroundOverlap.style,styles);window.regionProof.source.repaint({immediate:true})},styles)
  const overlap=await compare('background-rounded-overlap-'+name);if(backgroundSupported)assert.ok(overlap.backgroundHits>0,'Changed corner paint must exercise background composition')
 }
 await page.evaluate(()=>{const {form,source}=window.regionProof;window.regionProofBackgroundOverlap.remove();form.setAttribute('style',window.regionProofBackgroundFixture.style);form.querySelector('h2').textContent=window.regionProofBackgroundFixture.heading;source.repaint({immediate:true})});await compare('background-restored-after-guards')
 const negativeZSetup=await page.evaluate(()=>{const {form,source}=window.regionProof;const child=document.createElement('div');Object.assign(child.style,{position:'absolute',left:'30px',top:'30px',width:'200px',height:'100px',background:'red',zIndex:'-1',pointerEvents:'none'});form.append(child);window.regionProofNegativeZ=child;source.repaint({immediate:true});return {root:getComputedStyle(form).zIndex,child:getComputedStyle(child).zIndex}})
 assert.deepEqual(negativeZSetup,{root:'auto',child:'-1'})
 const negativeZ=await compare('background-negative-z');assert.equal(negativeZ.backgroundHits,0);assert.equal(negativeZ.backgroundPreparations,0);if(backgroundSupported)assert.ok(negativeZ.backgroundFallbacks>0,'Negative-z descendant paint must use the original full SVG')
 const overflowingBackground=await page.evaluate(()=>{const {form,source}=window.regionProof;window.regionProofBeforeRootOverflow=form.style.overflow;Object.assign(window.regionProofNegativeZ.style,{zIndex:'0',width:'820px',height:'600px',left:'0px',top:'0px'});form.style.overflow='auto';source.repaint({immediate:true});return {zIndex:getComputedStyle(window.regionProofNegativeZ).zIndex,scrollWidth:form.scrollWidth,clientWidth:form.clientWidth,scrollHeight:form.scrollHeight,clientHeight:form.clientHeight}})
 assert.equal(overflowingBackground.zIndex,'0');assert.ok(overflowingBackground.scrollWidth>overflowingBackground.clientWidth);assert.ok(overflowingBackground.scrollHeight>overflowingBackground.clientHeight)
 const scrollingBackground=await compare('background-scroll-overflow');assert.equal(scrollingBackground.backgroundHits,0);assert.equal(scrollingBackground.backgroundPreparations,0);if(backgroundSupported)assert.ok(scrollingBackground.backgroundFallbacks>0,'Scrollable root paint must use the original full SVG')
 await page.evaluate(()=>{window.regionProofNegativeZ.remove();window.regionProof.form.style.overflow=window.regionProofBeforeRootOverflow;window.regionProof.source.repaint({immediate:true})});await compare('background-negative-z-restored')
 if(backgroundSupported){
  const beforeBackgroundFailure=await page.evaluate(()=>{const {source}=window.regionProof;return {paintCount:source.paintCount(),pixels:source.canvas.toDataURL()}})
  await page.evaluate(()=>{window.regionProofBackgroundDrawFail=true;window.regionProof.source.repaint({immediate:true})})
  await page.waitForFunction(()=>window.regionProofErrors.some(error=>error.includes('deliberate background draw failure')))
  assert.deepEqual(await page.evaluate(()=>({paintCount:window.regionProof.source.paintCount(),pixels:window.regionProof.source.canvas.toDataURL()})),beforeBackgroundFailure,'Failed background composition must not alter the published source')
  await page.evaluate(()=>window.regionProof.source.repaint({immediate:true}));const backgroundRecovered=await compare('background-draw-recovery');assert.deepEqual(backgroundRecovered.errors,['Error: deliberate background draw failure']);assert.ok(backgroundRecovered.backgroundHits>0)
  await holdBackground('linear-gradient(135deg,rgb(225,240,215),rgb(180,220,175))')
  await page.evaluate(async()=>{const {source}=window.regionProof;window.regionProofBackgroundBeforePixels=await window.regionProofReadStylePixels();window.regionProofBackgroundFrames=[];window.regionProofBackgroundUnsubscribe=source.subscribePaint(receipt=>{const canvas=source.canvas;window.regionProofBackgroundFrames.push({read:receipt.read,width:canvas.width,height:canvas.height,pixels:canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data})})})
  await page.keyboard.type('a');await page.evaluate(()=>window.regionProof.source.repaint({immediate:true}))
  assert.equal(await page.evaluate(()=>window.regionProof.source.paintCount()),await page.evaluate(()=>window.regionProofBackgroundPaintsBeforeHold),'Held background preparation must not publish partial pixels')
  await page.evaluate(()=>{const release=window.regionProofBackgroundRelease;window.regionProofBackgroundRelease=null;release()})
  const backgroundHeld=await compare('background-held-input-refresh');assert.ok(backgroundHeld.backgroundFrames.length>0);assert.equal(backgroundHeld.focused,true)
  await page.evaluate(()=>{window.regionProofBackgroundUnsubscribe();window.regionProofBackgroundFrames=null;window.regionProofBackgroundBeforePixels=null})
  await holdBackground('linear-gradient(135deg,rgb(245,225,215),rgb(230,195,170))')
  await page.evaluate(()=>window.regionProof.source.setScale(1.5))
  await page.evaluate(()=>{const release=window.regionProofBackgroundRelease;window.regionProofBackgroundRelease=null;release()})
  const backgroundResized=await compare('background-held-density');assert.equal(backgroundResized.width,1140);assert.equal(backgroundResized.height,810);assert.deepEqual(await page.evaluate(()=>({width:window.regionProofHeldBackground.canvas.width,height:window.regionProofHeldBackground.canvas.height})),{width:0,height:0},'Superseded background pixels must be released after the new density arrives')
  await page.evaluate(()=>{const {form,source}=window.regionProof;form.setAttribute('style',window.regionProofBackgroundFixture.style);source.setScale(2);source.repaint({immediate:true})});await compare('background-lifecycle-restored')
 }
 await page.evaluate(async(root)=>{
  const {createDomTextureSource}=await import(root+'/packages/react/src/advanced.ts')
  const wrapper=document.createElement('div'),inner=document.createElement('div'),form=window.regionProofPristineForm.cloneNode(true)
  Object.assign(wrapper.style,{width:'760px',height:'540px'});inner.append(form);wrapper.append(inner)
  const source=createDomTextureSource(wrapper,760,540,{scale:2,onError:error=>window.regionProofErrors.push(String(error))})
  document.getElementById('root').append(source.host);source.setHostPainted(true);window.regionProofWrapped={source,form:wrapper,content:form,input:form.querySelector('[data-munari-anchor="field:project"]')}
 },'/@fs'+root)
 await page.waitForFunction(()=>Boolean(window.regionProofWrapped.source.currentPaint()))
 const wrappedSeed=await compare('background-wrapped-seed',false,'regionProofWrapped');if(backgroundSupported)assert.ok(wrappedSeed.backgroundPreparations>0,'A root wrapped in two ordinary divs must prepare a background');else{assert.equal(wrappedSeed.backgroundPreparations,0);assert.equal(wrappedSeed.backgroundHits,0)}
 const wrappedRead=await page.evaluate(()=>{const {source,content}=window.regionProofWrapped;content.querySelector('h2').textContent='Wrapped content changed';const read=source.nextRead();source.repaint({immediate:true});return read})
 await page.waitForFunction(read=>window.regionProofWrapped.source.currentPaint()?.read>=read,{},wrappedRead)
 const wrappedUpdated=await compare('background-wrapped-content',false,'regionProofWrapped');if(backgroundSupported)assert.ok(wrappedUpdated.backgroundHits>0,'A wrapped full content update must reuse its background');else{assert.equal(wrappedUpdated.backgroundPreparations,0);assert.equal(wrappedUpdated.backgroundHits,0)}
 wrappedDisposed=await page.evaluate(()=>{const {source}=window.regionProofWrapped,before=source.paintCount();source.dispose();return {before,after:source.paintCount(),connected:source.host.isConnected}});assert.equal(wrappedDisposed.after,wrappedDisposed.before);assert.equal(wrappedDisposed.connected,false)
 await page.evaluate(()=>{const {input,source}=window.regionProof;window.regionProofBeforeVersion=input.value;input.value='';input.setSelectionRange(0,0);input.scrollLeft=0;source.repaint({immediate:true})});await compare('input-version-seed')
 await page.evaluate(()=>{window.regionProofHoldBeforeCapture=true})
 await page.keyboard.type('a');await page.waitForFunction(()=>Boolean(window.regionProofReleaseBeforeCapture))
 await page.keyboard.type('b')
 await page.evaluate(()=>{const {source}=window.regionProof;const unsubscribe=source.subscribePaint(receipt=>{window.regionProofVersionPublished={read:receipt.read,time:performance.now()};unsubscribe()});const release=window.regionProofReleaseBeforeCapture;window.regionProofReleaseBeforeCapture=null;release()})
 await page.waitForFunction(()=>Boolean(window.regionProofVersionPublished),{polling:5})
 await page.keyboard.press('Backspace')
 const versionEdit=await page.evaluate(()=>({elapsed:performance.now()-window.regionProofVersionPublished.time,value:window.regionProof.input.value}))
 assert.ok(versionEdit.elapsed<150,'Backspace must precede the follow-up capture window');assert.equal(versionEdit.value,'a')
 await compare('input-version-midflight')
 await page.evaluate(()=>{const {input,source}=window.regionProof;input.value=window.regionProofBeforeVersion;input.setSelectionRange(input.value.length,input.value.length);input.scrollLeft=0;source.repaint({immediate:true})});await compare('input-version-restored')
 await page.evaluate(()=>{window.regionProofForceSvg=true;window.regionProof.source.repaint({immediate:true})});await compare('svg-path-seed')
 await page.keyboard.type(' Alpha');await compare('typing',true)
 await page.keyboard.type('a');const reused=await compare('svg-reuse',true);assert.ok(reused.svgHits>0,'A repeated character must reuse the accepted SVG')
 await seedShort()
 await page.evaluate(()=>{const {input}=window.regionProof;input.setSelectionRange(0,0);input.scrollLeft=0;window.regionProofSvgFail=true})
 for(let attempt=0;attempt<3;attempt++){
  await page.keyboard.type('a')
  await page.waitForFunction(()=>window.regionProofSvgFail===false||window.regionProof.source.currentPaint()?.read>=window.regionProofRequiredRead)
  if(await page.evaluate(()=>window.regionProofSvgFail===false))break
  await settled()
 }
 assert.equal(await page.evaluate(()=>window.regionProofSvgFail),false,'A cached decode must consume the failure')
 await page.evaluate(()=>window.regionProof.source.repaint({immediate:true}));const svgRecovered=await compare('svg-decode-recovery');assert.ok(svgRecovered.svgAttempts>0&&svgRecovered.errors.some(error=>error.includes('deliberate region decode failure')))
 await page.keyboard.type('a');await compare('svg-reseed',true)
 await holdSvg()
 await page.evaluate(()=>{const release=window.regionProofRelease;window.regionProofRelease=null;release()});const heldSvg=await compare('svg-held-decode',true);assert.ok(heldSvg.svgHits>0,'Held decode must exercise SVG reuse')
 await page.keyboard.press('Backspace');await compare('backspace',true)
 await page.evaluate(()=>{window.regionProofForceSvg=false;window.regionProof.source.repaint({immediate:true})});await compare('direct-path-seed')
 await seedShort();await compare('direct-warmup',true);await page.keyboard.type('a');const direct=await compare('direct-text',true);if(directTextSupported){assert.ok(direct.textHits>0,'Repeated eligible CPU input must draw text without an SVG value decode');assert.equal(direct.svgHits,0)}else{assert.equal(direct.textHits,0);assert.equal(direct.textPreparations,0);assert.ok(direct.svgHits>0,'GPU input must retain the SVG path')}assert.deepEqual(direct.calls,[]);assert.equal(direct.focused,true);assert.ok(direct.styleCacheHits>0,'Steady input must reuse validated serialized styles');assert.equal(direct.styleSerializations,0,'Unchanged input styles must not be serialized again')
 await page.evaluate(()=>{
  const {input,source}=window.regionProof
  const style=document.createElement('style')
  style.textContent='label[data-region-style-proof]:has(input:valid){background:rgb(212,237,211)}label[data-region-style-proof]:has(input:invalid){background:rgb(247,211,217)}'
  document.head.append(style);window.regionProofStyleFixture={style,pattern:input.getAttribute('pattern')}
  input.parentElement.dataset.regionStyleProof='';input.pattern='a+';input.value='aa';input.setSelectionRange(0,0);input.scrollLeft=0;source.repaint({immediate:true})
 });await compare('style-validity-seed')
 await page.keyboard.type('a');await compare('style-validity-warmup',true)
 const validBefore=await page.evaluate(()=>({valid:window.regionProof.input.validity.valid,background:getComputedStyle(window.regionProof.input.parentElement).backgroundColor}))
 assert.equal(validBefore.valid,true)
 await page.keyboard.type('x')
 const invalidAfter=await page.evaluate(()=>({valid:window.regionProof.input.validity.valid,background:getComputedStyle(window.regionProof.input.parentElement).backgroundColor}))
 assert.equal(invalidAfter.valid,false);assert.notEqual(invalidAfter.background,validBefore.background)
 const invalidPixels=await compare('style-validity-invalid');assert.ok(invalidPixels.calls.some(call=>!call.clip));assert.equal(invalidPixels.focused,true)
 await page.keyboard.press('Backspace')
 const validPixels=await compare('style-validity-valid');assert.ok(validPixels.calls.some(call=>!call.clip));assert.equal(validPixels.focused,true)
 await page.evaluate(()=>{const {input,source}=window.regionProof,fixture=window.regionProofStyleFixture;fixture.style.remove();delete input.parentElement.dataset.regionStyleProof;if(fixture.pattern===null)input.removeAttribute('pattern');else input.setAttribute('pattern',fixture.pattern);source.repaint({immediate:true})});await compare('style-validity-restored')
 await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'light'}])
 await page.evaluate(()=>{
  const {source}=window.regionProof
  const style=document.createElement('style');style.textContent='.controls-board{background:rgb(225,237,244)!important}@media(prefers-color-scheme:dark){.controls-board{background:rgb(218,204,236)!important}}'
  document.head.append(style);window.regionProofStyleFixture={style};source.repaint({immediate:true})
 });await compare('style-media-seed')
 await seedShort();await compare('style-media-warmup',true)
 const lightBackground=await page.evaluate(()=>getComputedStyle(window.regionProof.form).backgroundColor)
 await rememberStylePixels()
 if(process.env.REGION_FREEZE_STYLES==='1')await page.evaluate(()=>{window.regionProofFreezeStyles=true})
 await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'dark'}])
 await page.waitForFunction(before=>getComputedStyle(window.regionProof.form).backgroundColor!==before,{},lightBackground)
 await compareStylePixels('style-media-dark')
 await page.keyboard.type('a');const darkPixels=await compare('style-media-dark');assert.ok(darkPixels.calls.some(call=>!call.clip));assert.equal(darkPixels.focused,true)
 await page.emulateMediaFeatures([]);await page.evaluate(()=>{window.regionProofStyleFixture.style.remove();window.regionProof.source.repaint({immediate:true})});await compare('style-media-restored')
 await page.evaluate(()=>{
  const {source,form}=window.regionProof
  window.regionProofStyleFixture={background:form.style.background,hostBackground:source.host.style.background}
  form.style.background='inherit';source.host.style.background='rgb(219,239,220)';source.repaint({immediate:true})
 });await compare('style-inherited-seed')
 await seedShort();await compare('style-inherited-warmup',true)
 await rememberStylePixels()
 await page.evaluate(()=>{window.regionProof.source.host.style.background='rgb(235,213,241)'})
 await compareStylePixels('style-inherited-change')
 await page.keyboard.type('a');const inheritedPixels=await compare('style-inherited-change');assert.ok(inheritedPixels.calls.some(call=>!call.clip));assert.equal(inheritedPixels.focused,true)
 await page.evaluate(()=>{
  const {source}=window.regionProof
  const animation=source.host.animate([{backgroundColor:'rgb(219,239,220)'},{backgroundColor:'rgb(235,213,241)'}],{duration:1000,fill:'both'})
  animation.pause();animation.currentTime=0;window.regionProofStyleAnimation=animation
 });await page.waitForFunction(()=>window.regionProofStyleAnimation.playState==='paused'&&getComputedStyle(window.regionProof.form).backgroundColor==='rgb(219, 239, 220)');await page.evaluate(()=>window.regionProof.source.repaint({immediate:true}));await compare('style-paused-animation-seed')
 await seedShort();await compare('style-paused-animation-warmup')
 const pausedBefore=await page.evaluate(()=>({color:getComputedStyle(window.regionProof.form).backgroundColor,state:window.regionProofStyleAnimation.playState,inside:window.regionProof.form.getAnimations({subtree:true}).includes(window.regionProofStyleAnimation)}))
 assert.equal(pausedBefore.state,'paused');assert.equal(pausedBefore.inside,false)
 await rememberStylePixels()
 await page.evaluate(()=>{window.regionProofStyleAnimation.currentTime=1000})
 await page.waitForFunction(before=>getComputedStyle(window.regionProof.form).backgroundColor!==before,{},pausedBefore.color)
 await compareStylePixels('style-paused-animation-change')
 await page.keyboard.type('a');const pausedPixels=await compare('style-paused-animation-change');assert.ok(pausedPixels.calls.some(call=>!call.clip));assert.equal(pausedPixels.focused,true)
 await page.evaluate(()=>{const {form,source}=window.regionProof,fixture=window.regionProofStyleFixture;window.regionProofStyleAnimation.cancel();form.style.background=fixture.background;source.host.style.background=fixture.hostBackground;source.repaint({immediate:true})});await compare('style-animation-restored')
 await page.evaluate(()=>{
  const {input,source}=window.regionProof
  window.regionProofCheckStyles=true
  input.style.setProperty('--region-empty-before',' ')
  source.repaint({immediate:true})
 });const propertySeed=await compare('style-custom-property-seed');assert.ok(propertySeed.styleIntegrityChecks>0,'The property-name fixture must compare actual serialized declarations')
 const propertyBefore=await page.evaluate(()=>{const style=getComputedStyle(window.regionProof.input);return {count:style.length,names:Array.from(style),value:style.getPropertyValue('--region-empty-before')}})
 assert.ok(propertyBefore.names.includes('--region-empty-before'));assert.equal(propertyBefore.value.trim(),'')
 await page.evaluate(()=>{const {input}=window.regionProof;input.style.removeProperty('--region-empty-before');input.style.setProperty('--region-empty-after',' ')})
 const propertyAfter=await page.evaluate(()=>{const style=getComputedStyle(window.regionProof.input);return {count:style.length,names:Array.from(style),value:style.getPropertyValue('--region-empty-after')}})
 assert.equal(propertyAfter.count,propertyBefore.count);assert.equal(propertyAfter.value,propertyBefore.value);assert.ok(propertyAfter.names.includes('--region-empty-after'));assert.equal(propertyAfter.names.includes('--region-empty-before'),false)
 await page.keyboard.type('a');const propertyRenamed=await compare('style-custom-property-renamed');assert.ok(propertyRenamed.styleIntegrityChecks>0);assert.ok(propertyRenamed.styleSerializations>0,'Renaming a property with the same empty value must replace the serialized declaration');assert.equal(propertyRenamed.focused,true)
 await page.evaluate(()=>{const {input,source}=window.regionProof;input.style.removeProperty('--region-empty-after');source.repaint({immediate:true})});await compare('style-custom-property-restored');await page.evaluate(()=>{window.regionProofCheckStyles=false})
 await page.evaluate(()=>{const {input,source}=window.regionProof;input.value='Direct projections';input.setSelectionRange(0,0);input.scrollLeft=0;source.repaint({immediate:true})});await compare('kerning-input-seed')
 await page.keyboard.type('a');await compare('kerning-template-seed',true)
 const inputSession=await page.createCDPSession()
 for(const [name,value] of [['direct-kerning','JY 1Op'],['direct-punctuation','m_ZKDxp<Lz=JY (*1Op.aiG~']]){
  await page.evaluate(()=>{const {input}=window.regionProof;window.regionProofAutoKerningActive=true;input.select();window.regionProofDirectTrusted=null;input.addEventListener('input',event=>{window.regionProofDirectTrusted=event.isTrusted},{once:true})})
  await inputSession.send('Input.insertText',{text:value})
  const edited=await compare(name,true);assert.equal(edited.value,value);assert.equal(edited.focused,true);if(directTextSupported){assert.ok(edited.textHits>0,'A trusted complete-value edit must exercise Canvas text');assert.equal(edited.svgHits,0)}else{assert.equal(edited.textHits,0);assert.equal(edited.textPreparations,0);assert.ok(edited.svgHits>0)}assert.deepEqual(edited.calls,[]);assert.equal(await page.evaluate(()=>window.regionProofDirectTrusted),true)
 }
 for(const target of ['field','ancestor','overflow']){
  const name='clipped-'+target
  const clipSetup=await page.evaluate(target=>{const {input,source}=window.regionProof;window.regionProofClipTarget=target==='field'?input:input.parentElement;if(target==='overflow'){input.style.width='332px';window.regionProofClipTarget.style.width='166px';window.regionProofClipTarget.style.overflow='hidden'}else window.regionProofClipTarget.style.clipPath='inset(0 50% 0 0)';input.value='a';input.setSelectionRange(0,0);input.scrollLeft=0;source.repaint({immediate:true});return {inputWidth:input.getBoundingClientRect().width,parentWidth:input.parentElement.getBoundingClientRect().width}},target);if(target==='overflow'){assert.equal(clipSetup.inputWidth,332);assert.equal(clipSetup.parentWidth,166)}await compare(name+'-seed')
  await page.keyboard.type('a');await compare(name+'-short-value',true)
  await page.evaluate(()=>{const {input}=window.regionProof;input.select();window.regionProofClipTrusted=null;input.addEventListener('input',event=>{window.regionProofClipTrusted=event.isTrusted},{once:true})})
  await inputSession.send('Input.insertText',{text:'MMMMMMMMMMMMMMMMMMMM'})
  const clipped=await compare(name+'-long-value');assert.equal(clipped.value,'MMMMMMMMMMMMMMMMMMMM');assert.equal(clipped.focused,true);assert.equal(clipped.textHits,0,'Clipped input text must use SVG');assert.ok(clipped.svgHits>0||clipped.calls.length>0,'Clipped text must exercise SVG fallback');assert.equal(await page.evaluate(()=>window.regionProofClipTrusted),true)
  await page.evaluate(target=>{const {input,source}=window.regionProof;window.regionProofClipTarget.style.clipPath='';if(target==='overflow'){input.style.width='';window.regionProofClipTarget.style.width='';window.regionProofClipTarget.style.overflow=''}source.repaint({immediate:true})},target);await compare(name+'-restored')
 }
 await inputSession.detach()
 if(directTextSupported){
 await seedShort();await page.keyboard.type('a');const failureReady=await compare('text-failure-ready',true);assert.ok(failureReady.textHits>0)
 const beforeTextFailure=await page.evaluate(()=>{const {source}=window.regionProof;window.regionProofTextBeforeFailure={paintCount:source.paintCount(),pixels:source.canvas.getContext('2d').getImageData(0,0,source.canvas.width,source.canvas.height).data};window.regionProofTextDrawFail=true;return source.paintCount()})
 await page.keyboard.type('a');await page.waitForFunction(()=>window.regionProofErrors.some(error=>error.includes('deliberate text draw failure')))
 const failedText=await page.evaluate(()=>{const {source}=window.regionProof,before=window.regionProofTextBeforeFailure,observed=source.canvas.getContext('2d').getImageData(0,0,source.canvas.width,source.canvas.height).data;return {paintCount:source.paintCount(),unchanged:before.pixels.length===observed.length&&before.pixels.every((channel,index)=>channel===observed[index]),pendingFault:window.regionProofTextDrawFail}})
 assert.equal(failedText.paintCount,beforeTextFailure,'A failed direct draw must not publish a frame');assert.equal(failedText.unchanged,true,'A failed direct draw must preserve displayed source pixels');assert.equal(failedText.pendingFault,false)
 await page.evaluate(()=>window.regionProof.source.repaint({immediate:true}));const textRecovered=await compare('text-draw-recovery');assert.deepEqual(textRecovered.errors,['Error: deliberate text draw failure']);assert.ok(textRecovered.textAttempts>0);assert.ok(textRecovered.calls.some(call=>!call.clip));assert.equal(textRecovered.focused,true)
 await holdTextPreparation()
 const beforeTextRefresh=await page.evaluate(()=>{const finished=window.regionProofTextFinished??0;window.regionProof.source.repaint({immediate:true});return finished})
 await page.waitForFunction(()=>window.regionProofTextPending.signal.aborted)
 const textRefreshResources=await page.evaluate(()=>{const {certificate,blank}=window.regionProofTextPending;return {connected:certificate.isConnected,certificateWidth:certificate.width,blankWidth:blank.width}})
 assert.deepEqual(textRefreshResources,{connected:false,certificateWidth:0,blankWidth:0})
 await page.evaluate(()=>{const release=window.regionProofTextRelease;window.regionProofTextRelease=null;release()});await page.waitForFunction(finished=>(window.regionProofTextFinished??0)>finished,{},beforeTextRefresh)
 const textRefreshed=await compare('text-preparation-refresh');assert.ok(textRefreshed.calls.some(call=>!call.clip))
 await seedShort();await page.keyboard.type('a');const refreshedDirect=await compare('direct-after-preparation-refresh',true);assert.ok(refreshedDirect.textHits>0)
 await holdTextPreparation()
 await page.evaluate(()=>{const {input}=window.regionProof;input.setSelectionRange(0,0);input.scrollLeft=0;window.regionProofSvgHold=true})
 await page.keyboard.type('a');await page.waitForFunction(()=>Boolean(window.regionProofRelease))
 const preparationRace=await page.evaluate(()=>({finished:window.regionProofTextFinished??0,paintCount:window.regionProof.source.paintCount()}))
 await page.evaluate(()=>{const release=window.regionProofTextRelease;window.regionProofTextRelease=null;release()});await page.waitForFunction(finished=>(window.regionProofTextFinished??0)>finished,{},preparationRace.finished)
 assert.equal(await page.evaluate(()=>window.regionProof.source.paintCount()),preparationRace.paintCount,'Completing preparation must not publish while the SVG capture is held')
 assert.equal(await page.evaluate(()=>Boolean(window.regionProofRelease)),true,'The SVG value capture must remain pending when preparation completes')
 await page.evaluate(()=>{const release=window.regionProofRelease;window.regionProofRelease=null;release()});const racedSvg=await compare('preparation-race-svg-finished',true);assert.ok(racedSvg.svgHits>0,'The race must complete an actual same-template SVG value capture')
 await page.keyboard.type('a');const racedDirect=await compare('direct-after-preparation-race',true);assert.ok(racedDirect.textHits>0,'A discarded preparation must allow the accepted template to prepare again');assert.equal(racedDirect.svgHits,0);assert.deepEqual(racedDirect.calls,[]);assert.equal(racedDirect.focused,true)
 }
 for(const [name,property,value] of [['group-opacity','opacity','.5'],['unsupported-typography','textIndent','2px']]){
  await page.evaluate(({property,value})=>{const {input,source}=window.regionProof;window.regionProofFallbackTarget=property==='opacity'?input.parentElement:input;window.regionProofFallbackTarget.style[property]=value;input.value='aa';input.setSelectionRange(0,0);input.scrollLeft=0;source.repaint({immediate:true})},{property,value});await compare(name+'-seed')
  await page.keyboard.type('a');await compare(name+'-first-edit',true)
  await page.keyboard.type('a');const fallback=await compare(name+'-fallback',true);assert.equal(fallback.textHits,0);assert.ok(fallback.svgHits>0||fallback.calls.some(call=>call.clip));assert.equal(fallback.focused,true)
  await page.evaluate(property=>{window.regionProofFallbackTarget.style[property]='';window.regionProof.source.repaint({immediate:true})},property);await compare(name+'-restored')
 }
 await page.evaluate(async()=>{
  const {input,source,form}=window.regionProof
  window.regionProofForceSvg=false
  const style=document.createElement('style');style.textContent="@font-face{font-family:RegionSubset;src:url('/fonts/archivo-400-900-latin.woff2') format('woff2');font-weight:900;unicode-range:U+0020-007E}@font-face{font-family:RegionSubset;src:url('/fonts/playfair-display-900-latin.woff2') format('woff2');font-weight:900;unicode-range:U+0042}"
  document.head.append(style)
  const text=[];const walker=document.createTreeWalker(form,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;if(node.textContent.includes('B')){text.push([node,node.textContent]);node.textContent=node.textContent.replaceAll('B','b')}}
  window.regionProofFontFixture={style,text,value:input.value,family:input.style.fontFamily,weight:input.style.fontWeight}
  input.style.fontFamily='RegionSubset';input.style.fontWeight='900';input.value='aa';input.setSelectionRange(0,0);input.scrollLeft=0
  await document.fonts.load('900 16px RegionSubset','a');await document.fonts.load('900 16px RegionSubset','B');await document.fonts.ready
  source.repaint({immediate:true})
 });await compare('font-subset-fixture')
 await page.keyboard.type('a');await compare('font-subset-seed',true)
 for(let attempt=0;attempt<3;attempt++){
  await page.keyboard.type('c');await settled()
  if(await page.evaluate(()=>(window.regionProofSvgHits??0)>0))break
 }
 const safeGlyph=await compare('font-subset-covered',true);assert.ok(safeGlyph.svgHits>0,'A new glyph covered by the embedded face must reuse SVG');assert.equal(safeGlyph.textHits,0,'An input family with an omitted ASCII font face must keep SVG rendering')
 await page.keyboard.type('B');const newFace=await compare('font-subset-new-face');assert.ok(newFace.calls.some(call=>call.clip),'A glyph selecting another face must capture it');assert.equal(newFace.svgHits,0,'An uncovered glyph must not reuse SVG')
 await page.evaluate(()=>{const {input,source}=window.regionProof,fixture=window.regionProofFontFixture;fixture.style.remove();for(const [node,text] of fixture.text)node.textContent=text;input.style.fontFamily=fixture.family;input.style.fontWeight=fixture.weight;input.value=fixture.value;input.setSelectionRange(0,0);input.scrollLeft=0;source.repaint({immediate:true})});await compare('font-subset-restored')
 await page.evaluate(()=>{window.regionProofForceSvg=false;window.regionProof.source.repaint({immediate:true})});await compare('text-after-font-fixture')
 for(const offset of [3,4]){
  await page.evaluate(offset=>{const {input,source}=window.regionProof;input.style.outlineOffset=offset+'px';source.repaint({immediate:true})},offset);await compare(`outline-${offset+2}`)
  await page.keyboard.type('o');const outlined=await compare(`outline-${offset+2}-typing`,offset===3)
  if(offset===4)assert.ok(outlined.storage?outlined.calls.every(call=>!call.clip):outlined.calls.some(call=>call.clip), 'Large outlines must use full capture on CPU and region capture on GPU')
 }
 await page.evaluate(()=>{window.regionProof.input.style.outlineOffset='';window.regionProof.source.repaint({immediate:true})});await compare('outline-restored')
 if(await page.evaluate(()=>window.regionProof.source.canvas.getContext('2d').getContextAttributes().willReadFrequently)){
  await page.evaluate(()=>{const {input,source}=window.regionProof;input.style.position='relative';input.style.left='.25px';source.repaint({immediate:true})});await compare('fractional-field')
  await page.keyboard.type('f');await compare('fractional-field-typing',true)
  await page.evaluate(()=>{const {input,source}=window.regionProof;input.style.position='';input.style.left='';source.repaint({immediate:true})});await compare('field-position-restored')
  await page.evaluate(()=>{const {input,source}=window.regionProof;input.parentElement.style.position='relative';input.parentElement.style.top='-.25px';source.repaint({immediate:true})});await compare('positioned-ancestor')
  await page.keyboard.type('p');await compare('positioned-ancestor-typing',true)
  await page.evaluate(()=>{const {input,source}=window.regionProof;input.parentElement.style.position='';input.parentElement.style.top='';source.repaint({immediate:true})});await compare('ancestor-position-restored')
  const flowTop=await page.evaluate(()=>{const {input,source}=window.regionProof;input.style.marginTop=-(input.getBoundingClientRect().top%1)+'px';input.setSelectionRange(0,0);input.scrollLeft=0;source.repaint({immediate:true});return input.getBoundingClientRect().top});assert.ok(Number.isInteger(flowTop));await compare('flow-integer-y')
  await page.evaluate(()=>{const {source}=window.regionProof,read=source.nextRead();window.regionProofFlowFrames=[];window.regionProofFlowUnsubscribe=source.subscribePaint(receipt=>{if(receipt.read>=read){const canvas=source.canvas;window.regionProofFlowFrames.push({read:receipt.read,width:canvas.width,height:canvas.height,pixels:canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data})}})})
  await page.keyboard.type('i');const flow=await compare('flow-integer-y-typing',true);assert.ok(flow.intermediateFrames.length>0)
  await page.evaluate(()=>{window.regionProofFlowUnsubscribe();window.regionProofFlowFrames=null;window.regionProof.input.style.marginTop='';window.regionProof.source.repaint({immediate:true})});await compare('flow-position-restored')
  await page.evaluate(()=>{const {input,source}=window.regionProof;input.style.boxShadow='0 2px 8px rgba(20,30,80,.4)';source.repaint({immediate:true})});await compare('outer-shadow')
  await page.keyboard.type('s');const shadowed=await compare('outer-shadow-typing');assert.ok(shadowed.calls.every(call=>!call.clip))
  await page.evaluate(()=>{window.regionProof.input.style.boxShadow='';window.regionProof.source.repaint({immediate:true})});await compare('inset-shadow-restored')
  await page.evaluate(()=>{const {input,source}=window.regionProof;input.style.position='relative';input.style.left='2000px';source.repaint({immediate:true})});await compare('outside-root')
  await page.keyboard.type('w');const outsideRoot=await compare('outside-root-typing');assert.ok(outsideRoot.calls.every(call=>!call.clip))
  await page.evaluate(()=>{const {input,source}=window.regionProof;input.style.position='';input.style.left='';source.repaint({immediate:true})});await compare('inside-root-restored')
 }
 await page.keyboard.type(' Long text that must scroll horizontally across the narrow field');await compare('horizontal-scroll',true)
 await page.evaluate(()=>window.regionProof.input.select());await page.keyboard.press('Backspace');await compare('empty')
 await page.evaluate(()=>{const {input,source}=window.regionProof;input.placeholder='project title';source.repaint({immediate:true})});await compare('placeholder')
 await page.keyboard.type('New text');await compare('from-placeholder')
 await page.keyboard.type(' value');await compare('after-placeholder',true)
 await page.evaluate(()=>{window.regionProof.form.querySelector('h2').textContent='Changed outside the input'});await page.keyboard.type('!');const outside=await compare('outside-change');assert.ok(outside.calls.some(c=>!c.clip))
 await page.evaluate(()=>{const sheet=new CSSStyleSheet();sheet.replaceSync('.controls-field input{color:rgb(180,20,60)!important}');document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];window.regionProof.source.repaint({immediate:true})});const cssom=await compare('cssom-refresh');assert.ok(cssom.calls.some(c=>!c.clip&&c.invalidate))
 for(const scale of [1,1.5,3,2]){
  await page.evaluate(scale=>window.regionProof.source.setScale(scale),scale);const density=await compare(`density-${scale}`)
  if(scale===3){assert.ok(density.width*density.height*4>8*1024*1024,'The density fixture must exceed the background budget');assert.equal(density.backgroundPreparations,0);assert.equal(density.backgroundHits,0);if(backgroundSupported)assert.ok(density.backgroundBudgetFallbacks>0,'The oversized capture must take the background-budget fallback')}
  await page.keyboard.type('x');await compare(`density-${scale}-typing`)
  if(scale===1){
   await page.evaluate(()=>{const {input,source}=window.regionProof;input.style.borderRadius='40px';source.repaint({immediate:true})});await compare('large-radius')
   await page.keyboard.type('r');await compare('large-radius-typing',true)
   await page.evaluate(()=>{window.regionProof.input.style.borderRadius='';window.regionProof.source.repaint({immediate:true})});await compare('radius-restored')
  }
 }
 await page.evaluate(()=>{window.regionProof.form.style.width='720px';window.regionProof.source.setSize(720,540)});await compare('resize')
 await page.keyboard.type('y');await compare('resized-typing')
 await page.evaluate(()=>{const {form,source}=window.regionProof;form.style.width='760px';source.setSize(760,540);source.resettle()});await compare('restored-size')
 await page.evaluate(()=>{window.regionProof.form.style.position='relative';window.regionProof.form.style.left='.25px';window.regionProof.source.repaint({immediate:true})});await compare('fractional-origin')
 await page.keyboard.type('f');const fractional=await compare('fractional-origin-typing');assert.ok(fractional.calls.every(c=>!c.clip))
 await page.evaluate(()=>{window.regionProof.form.style.left='0px';window.regionProof.source.repaint({immediate:true})});await compare('restored-origin')
 await page.keyboard.type('r');await compare('restored-typing',true)
 await page.evaluate(()=>{window.regionProof.input.style.filter='blur(12px)';window.regionProof.source.repaint({immediate:true})});await compare('blur')
 await page.keyboard.type('b');const blurred=await compare('blur-typing');assert.ok(blurred.calls.every(c=>!c.clip))
 await page.evaluate(()=>{window.regionProof.input.style.filter='none';window.regionProof.source.repaint({immediate:true})});await compare('unfiltered')
 await page.evaluate(()=>{window.regionProof.source.host.style.transform='scaleX(-1)';window.regionProof.source.repaint({immediate:true})});await compare('reflected-parent')
 await page.keyboard.type('m');const reflected=await compare('reflected-parent-typing');assert.ok(reflected.calls.every(c=>!c.clip))
 await page.evaluate(()=>{window.regionProof.source.host.style.transform='none';window.regionProof.source.repaint({immediate:true})});await compare('untransformed')
 await page.keyboard.type('n');await compare('untransformed-typing',true)
 await page.evaluate(()=>{const {form,input,source}=window.regionProof;input.id='duplicate-region-id';const near=document.createElement('input');near.id=input.id;near.placeholder='Nearby';near.dataset.munariAnchor='nearby';const a=form.getBoundingClientRect(),b=input.getBoundingClientRect();Object.assign(near.style,{position:'absolute',left:(b.right-a.left+2)+'px',top:(b.top-a.top)+'px',width:'22px',height:'39px'});form.append(near);window.regionProof.near=near;source.repaint({immediate:true})});await compare('neighbor')
 await page.keyboard.type('d');await compare('duplicate-id-unique-anchors',true)
 await page.evaluate(()=>{const {near,source}=window.regionProof;near.removeAttribute('id');near.removeAttribute('data-munari-anchor');source.repaint({immediate:true})});await compare('anonymous-neighbor')
 await page.keyboard.type('a');const anonymous=await compare('anonymous-neighbor-typing');assert.ok(anonymous.calls.every(c=>!c.clip))
 await page.evaluate(()=>{window.regionProof.near.remove();window.regionProof.source.repaint({immediate:true})});await compare('neighbor-removed')
 await page.evaluate(()=>{const {form,source}=window.regionProof;form.style.background='transparent';form.style.boxShadow='none';source.repaint({immediate:true})});await compare('transparent-background')
 await page.keyboard.type('t');await compare('transparent-background-typing',true)
 await page.evaluate(()=>{const {form,source}=window.regionProof;form.style.background='';form.style.boxShadow='';source.repaint({immediate:true})});await compare('background-restored')
 await page.evaluate(()=>{const style=document.createElement('style');style.textContent='.controls-board__foot{background:#badfda}@media(max-width:1400px){.controls-board__foot{background:#daa9c4}}';document.head.append(style)});await page.keyboard.type('h');const head=await compare('head-stylesheet');assert.ok(head.calls.some(c=>!c.clip))
 await page.setViewport({width:1300,height:1000,deviceScaleFactor:2});await page.keyboard.type('v');const media=await compare('media-query');assert.ok(media.calls.some(c=>!c.clip))
 await page.setViewport({width:1440,height:1000,deviceScaleFactor:2});await page.evaluate(()=>window.regionProof.source.repaint({immediate:true}));await compare('restored-viewport')
 await seedShort();await holdSvg()
 await page.evaluate(()=>{const {form,source}=window.regionProof;form.style.background='#badfda';source.repaint({immediate:true});const release=window.regionProofRelease;window.regionProofRelease=null;release()});const midflight=await compare('midflight-refresh');assert.ok(midflight.svgHits>0,'Refresh must interrupt an actual cached decode');assert.ok(midflight.calls.some(call=>!call.clip),'Refresh must capture current styles')
 await page.keyboard.type('a');await compare('midflight-future-edit',true)
 await page.evaluate(()=>{window.regionProofForceSvg=false;window.regionProof.form.style.background='';window.regionProof.source.repaint({immediate:true})});await compare('midflight-background-restored')
 await page.evaluate(()=>{window.regionProofDrawFail=true;window.regionProof.source.setScale(1)})
 await page.waitForFunction(()=>window.regionProofErrors.some(error=>error.includes('deliberate region cache draw failure')))
 await page.evaluate(()=>{const {source,input}=window.regionProof;source.setScale(2);input.value+='q';input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'q'}))})
 const drawn=await compare('cache-draw-recovery');assert.ok(drawn.errors.some(error=>error.includes('deliberate region cache draw failure')));assert.ok(drawn.calls.every(c=>!c.clip))
 await page.evaluate(()=>{window.regionProofForceSvg=true;window.regionProofFail=true});await page.keyboard.type('!');await settled()
 await page.evaluate(()=>window.regionProof.source.repaint({immediate:true}));const recovered=await compare('decode-recovery');assert.ok(recovered.errors.some(e=>e.includes('deliberate region decode failure')))
 await seedShort();await holdSvg()
 assert.ok(await page.evaluate(()=>(window.regionProofSvgAttempts??0)>0),'Disposal must interrupt an actual cached decode')
 disposed=await page.evaluate(async()=>{const {source}=window.regionProof;const before=source.paintCount();source.dispose();window.regionProofRelease();await new Promise(resolve=>setTimeout(resolve,300));return {before,after:source.paintCount(),connected:source.host.isConnected}})
 }
 assert.equal(disposed.after,disposed.before);assert.equal(disposed.connected,false);assert.deepEqual(errors,[])
 let textDisposed=null
 if(process.env.REGION_UNKNOWN_VIEWPORT!=='1'&&directTextSupported){
  await page.evaluate(async(root)=>{
   const {createDomTextureSource}=await import(root+'/packages/react/src/advanced.ts')
   const form=window.regionProof.form.cloneNode(true),input=form.querySelector('[data-munari-anchor="field:project"]')
   input.value='aa';input.placeholder='';input.setSelectionRange(0,0);input.scrollLeft=0
   window.regionProofExtraErrors=[];window.regionProofForceSvg=false
   const source=createDomTextureSource(form,760,540,{scale:2,onError:error=>window.regionProofExtraErrors.push(String(error))})
   document.getElementById('root').append(source.host);source.setHostPainted(true);window.regionProofExtra={source,form,input}
  },'/@fs'+root)
  await page.waitForFunction(()=>Boolean(window.regionProofExtra.source.currentPaint()))
  await page.evaluate(()=>{const {source,input}=window.regionProofExtra;input.focus();input.setSelectionRange(0,0);window.regionProofExtra.requiredRead=source.nextRead();source.repaint({immediate:true})})
  await page.waitForFunction(()=>window.regionProofExtra.source.currentPaint()?.read>=window.regionProofExtra.requiredRead)
  await page.evaluate(()=>{window.regionProofTextHold=true;window.regionProofExtra.requiredRead=window.regionProofExtra.source.nextRead()});await page.keyboard.type('a')
  await page.waitForFunction(()=>Boolean(window.regionProofTextRelease));await page.waitForFunction(()=>window.regionProofExtra.source.currentPaint()?.read>=window.regionProofExtra.requiredRead)
  const pendingTextDispose=await page.evaluate(()=>{const {certificate,blank,signal}=window.regionProofTextPending;return {connected:certificate.isConnected,certificateWidth:certificate.width,blankWidth:blank.width,aborted:signal.aborted}})
  assert.equal(pendingTextDispose.connected,true);assert.ok(pendingTextDispose.certificateWidth>0&&pendingTextDispose.blankWidth>0);assert.equal(pendingTextDispose.aborted,false)
  textDisposed=await page.evaluate(()=>{const {source}=window.regionProofExtra,before=source.paintCount(),finished=window.regionProofTextFinished??0;source.dispose();const {certificate,blank,signal}=window.regionProofTextPending;return {before,finished,connected:source.host.isConnected,certificateConnected:certificate.isConnected,certificateWidth:certificate.width,blankWidth:blank.width,aborted:signal.aborted}})
  assert.equal(textDisposed.connected,false);assert.equal(textDisposed.certificateConnected,false);assert.equal(textDisposed.certificateWidth,0);assert.equal(textDisposed.blankWidth,0);assert.equal(textDisposed.aborted,true)
  await page.evaluate(()=>{const release=window.regionProofTextRelease;window.regionProofTextRelease=null;release()});await page.waitForFunction(finished=>(window.regionProofTextFinished??0)>finished,{},textDisposed.finished)
  textDisposed.after=await page.evaluate(()=>window.regionProofExtra.source.paintCount());assert.equal(textDisposed.after,textDisposed.before);assert.deepEqual(await page.evaluate(()=>window.regionProofExtraErrors),[])
 }
 let backgroundDisposed=null
 if(process.env.REGION_UNKNOWN_VIEWPORT!=='1'&&directTextSupported){
  await page.evaluate(async(root)=>{
   const {createDomTextureSource}=await import(root+'/packages/react/src/advanced.ts')
   window.regionProofBackgroundExtraErrors=[]
   const form=window.regionProofPristineForm.cloneNode(true),input=form.querySelector('[data-munari-anchor="field:project"]');input.placeholder=''
   const preparations=window.regionProofBackgroundPreparations??0,source=createDomTextureSource(form,760,540,{scale:2,onError:error=>window.regionProofBackgroundExtraErrors.push(String(error))})
   document.getElementById('root').append(source.host);source.setHostPainted(true);window.regionProofBackgroundExtra={source,form,preparations}
  },'/@fs'+root)
  await page.waitForFunction(()=>Boolean(window.regionProofBackgroundExtra.source.currentPaint()))
  assert.ok(await page.evaluate(()=>(window.regionProofBackgroundPreparations??0)>window.regionProofBackgroundExtra.preparations),'The disposal fixture must prepare a real background before its held capture')
  await page.evaluate(()=>{const {source,form}=window.regionProofBackgroundExtra;window.regionProofBackgroundHold=true;form.style.background='linear-gradient(135deg,rgb(240,215,235),rgb(225,175,205))';source.repaint({immediate:true})})
  await page.waitForFunction(()=>Boolean(window.regionProofBackgroundRelease))
  const pendingBackground=await page.evaluate(()=>{const {canvas,signal}=window.regionProofBackgroundPending;return {width:canvas.width,height:canvas.height,aborted:signal.aborted}});assert.ok(pendingBackground.width>0&&pendingBackground.height>0);assert.equal(pendingBackground.aborted,false)
  backgroundDisposed=await page.evaluate(()=>{const {source}=window.regionProofBackgroundExtra,before=source.paintCount(),finished=window.regionProofBackgroundFinished??0;source.dispose();const {canvas,signal}=window.regionProofBackgroundPending;return {before,finished,connected:source.host.isConnected,width:canvas.width,height:canvas.height,aborted:signal.aborted}})
  assert.equal(backgroundDisposed.connected,false);assert.equal(backgroundDisposed.width,0);assert.equal(backgroundDisposed.height,0);assert.equal(backgroundDisposed.aborted,true)
  await page.evaluate(()=>{const release=window.regionProofBackgroundRelease;window.regionProofBackgroundRelease=null;release()});await page.waitForFunction(finished=>(window.regionProofBackgroundFinished??0)>finished,{},backgroundDisposed.finished)
  backgroundDisposed.after=await page.evaluate(()=>window.regionProofBackgroundExtra.source.paintCount());assert.equal(backgroundDisposed.after,backgroundDisposed.before);assert.deepEqual(await page.evaluate(()=>window.regionProofBackgroundExtraErrors),[])
 }
 await writeFile(path.join(output,'completion.json'),JSON.stringify({disposed,wrappedDisposed,textDisposed,backgroundDisposed,timerFallback,errors,browser:await browser.version()},null,2))
 console.log(JSON.stringify({checks:results.length,partialChecks:results.filter(r=>r.textHits>0||r.svgHits>0||r.calls.some(c=>c.clip)).map(r=>r.name),disposed,wrappedDisposed,textDisposed,backgroundDisposed,timerFallback,errors}))
}finally{
 if(browser){await browser.close();browser.process()?.stderr?.destroy()}
 await server.close()
}
