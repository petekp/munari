// Input region proof — cached source pixels must match a fresh full Controls capture.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
import {replaceSource} from '../home-light/replaceSource.mjs'
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
  source=replaceSource(source,'      context.drawImage(image, 0, 0, canvas.width, canvas.height)',`        if(window.regionProofDrawFail){window.regionProofDrawFail=false;throw new Error('deliberate region cache draw failure')}
        context.drawImage(image, 0, 0, canvas.width, canvas.height)`)
  if(process.env.REGION_SHIFT_PATCH==='1')source=replaceSource(source,
   'context.drawImage(image, x, y, image.width, image.height)',
   'context.drawImage(image, x + 1, y, image.width, image.height)')
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
 page.on('pageerror',e=>errors.push(String(e)))
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=controls&framed&capture=snapdom`,{waitUntil:'load'})
 await page.waitForFunction(()=>window.regionProofFull&&document.querySelector('.controls-board'))
 await page.evaluate(async(root)=>{
  await document.fonts.ready
  const {createDomTextureSource}=await import(root+'/packages/react/src/advanced.ts')
  const form=document.querySelector('.controls-board');form.remove();window.regionProofCalls=[];window.regionProofErrors=[]
  const source=createDomTextureSource(form,760,540,{scale:2,onError:error=>window.regionProofErrors.push(String(error))})
  document.getElementById('root').append(source.host);source.setHostPainted(true)
  window.regionProof={source,form,input:form.querySelector('[data-munari-anchor="field:project"]')}
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
 const compare=async(name,requirePartial=false)=>{
  await settled()
  const result=await page.evaluate(async()=>{
   const {source,form,input}=window.regionProof,canvas=source.canvas
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
   const svgHits=window.regionProofSvgHits??0,svgAttempts=window.regionProofSvgAttempts??0;window.regionProofSvgHits=0;window.regionProofSvgAttempts=0
   const textHits=window.regionProofTextHits??0,textAttempts=window.regionProofTextAttempts??0,textPreparations=window.regionProofTextPreparations??0;window.regionProofTextHits=0;window.regionProofTextAttempts=0;window.regionProofTextPreparations=0
   const styleCacheHits=window.regionProofStyleCacheHits??0,styleSerializations=window.regionProofStyleSerializations??0,frozenStyles=window.regionProofFrozenStyles??0,styleIntegrityChecks=window.regionProofStyleIntegrityChecks??0,styleMismatches=window.regionProofStyleMismatches??[];window.regionProofStyleCacheHits=0;window.regionProofStyleSerializations=0;window.regionProofFrozenStyles=0;window.regionProofStyleIntegrityChecks=0;window.regionProofStyleMismatches=[]
   const styleVisibility=window.regionProofStyleVisibility??null;window.regionProofStyleVisibility=null
   return {styleVisibility,styleCacheHits,styleSerializations,frozenStyles,styleIntegrityChecks,styleMismatches,textHits,textAttempts,textPreparations,svgHits,svgAttempts,intermediateFrames,changed,max,storage,cacheStorage:window.regionProofCacheMemory??null,width:canvas.width,height:canvas.height,value:input.value,focused:document.activeElement===input,calls:window.regionProofCalls.splice(0),errors:window.regionProofErrors.splice(0),png:canvas.toDataURL(),reference:ref.toDataURL()}
  })
  for(const key of ['png','reference']){await writeFile(path.join(output,`${name}-${key}.png`),Buffer.from(result[key].split(',')[1],'base64'));delete result[key]}
  results.push({name,...result});await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
  if(process.env.REGION_STORAGE)assert.equal(result.storage,process.env.REGION_STORAGE==='cpu',`${name}: requested storage must be exercised`)
  assert.equal(result.cacheStorage,result.storage,`${name}: region and source storage must match`)
  assert.equal(result.changed,0,`${name}: source pixels must equal a fresh full capture`)
  assert.deepEqual(result.styleMismatches,[],`${name}: cached serialization must equal the complete current declaration`)
  for(const frame of result.intermediateFrames)assert.equal(frame.changed,0,`${name}: every published frame must equal the stable full capture`)
  if(!['decode-recovery','svg-decode-recovery','cache-draw-recovery','text-draw-recovery'].includes(name))assert.deepEqual(result.errors,[],`${name}: capture must succeed`)
  if(requirePartial)assert.ok(result.textHits>0||result.svgHits>0||result.calls.some(c=>c.clip),`${name}: must exercise partial capture`)
  return result
 }
 await settled();await page.focus('[data-munari-anchor="field:project"]');const focused=await compare('focused')
 const directTextSupported=focused.storage
 let disposed
 if(process.env.REGION_UNKNOWN_VIEWPORT==='1'){
  assert.equal(await page.evaluate(()=>window.regionProof.source.canvas.getContext('2d').getContextAttributes().willReadFrequently),true,'Unknown viewport proof requires CPU storage')
  await page.evaluate(()=>{window.regionProofUnknownViewport=true})
  await page.keyboard.type('u');const fallback=await compare('unsupported-svg-fallback');assert.ok(fallback.calls.some(call=>call.clip)&&fallback.calls.some(call=>!call.clip))
  await page.evaluate(()=>{window.regionProofUnknownViewport=false})
  await page.keyboard.type('v');const disabled=await compare('unsupported-svg-stays-full');assert.ok(disabled.calls.length>0&&disabled.calls.every(call=>!call.clip))
  disposed=await page.evaluate(()=>{const {source}=window.regionProof;const before=source.paintCount();source.dispose();return {before,after:source.paintCount(),connected:source.host.isConnected}})
 }else{
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
  await page.evaluate(scale=>window.regionProof.source.setScale(scale),scale);await compare(`density-${scale}`)
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
 await writeFile(path.join(output,'completion.json'),JSON.stringify({disposed,textDisposed,errors,browser:await browser.version()},null,2))
 console.log(JSON.stringify({checks:results.length,partialChecks:results.filter(r=>r.textHits>0||r.svgHits>0||r.calls.some(c=>c.clip)).map(r=>r.name),disposed,textDisposed,errors}))
}finally{if(browser)await browser.close();await server.close()}
