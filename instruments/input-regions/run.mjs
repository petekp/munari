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
  if(process.env.REGION_IGNORE_INPUT_VERSION==='1')source=replaceSource(source,' && cachedInputVersion === inputVersion','')
  if(process.env.REGION_REUSE_FAILED_CACHE==='1')source=replaceSource(source,'    cachedEpoch = -1\n','')
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
 if(id.endsWith('/src/snapdomInputSvg.ts')){
  return replaceSource(source,'  await image.decode()',`  window.regionProofSvgAttempts=(window.regionProofSvgAttempts??0)+1
  if(window.regionProofSvgFail){window.regionProofSvgFail=false;throw new Error('deliberate region decode failure')}
  if(window.regionProofSvgHold){window.regionProofSvgHold=false;await new Promise(resolve=>{window.regionProofRelease=resolve})}
  await image.decode()
  window.regionProofSvgHits=(window.regionProofSvgHits??0)+1`)
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
  window.regionProofRequiredRead=source.nextRead()
  document.addEventListener('input',event=>{if(form.contains(event.target))window.regionProofRequiredRead=Math.max(window.regionProofRequiredRead,source.nextRead())},true)
  for(const name of ['repaint','setScale','setSize']){
   const original=source[name].bind(source)
   source[name]=(...args)=>{const read=source.nextRead(),before=JSON.stringify([source.size(),source.rasterScale()]);const result=original(...args);if(name==='repaint'||before!==JSON.stringify([source.size(),source.rasterScale()]))window.regionProofRequiredRead=Math.max(window.regionProofRequiredRead,read);return result}
  }

 },'/@fs'+root)
 const settled=async()=>{await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,650)));await page.waitForFunction(()=>window.regionProof.source.currentPaint()?.read>=window.regionProofRequiredRead)}
 const seedShort=async()=>{
  await page.evaluate(()=>{const {input,source}=window.regionProof;input.value='aa';input.setSelectionRange(0,0);input.scrollLeft=0;source.repaint({immediate:true})})
  await settled()
  await page.keyboard.type('a');await settled()
 }
 const holdSvg=async()=>{
  await page.evaluate(()=>{const {input}=window.regionProof;input.setSelectionRange(0,0);input.scrollLeft=0;window.regionProofSvgHold=true})
  for(let attempt=0;attempt<3;attempt++){
   const before=await page.evaluate(()=>window.regionProof.source.paintCount())
   await page.keyboard.type('a')
   await page.waitForFunction(before=>Boolean(window.regionProofRelease)||window.regionProof.source.paintCount()>before,{},before)
   if(await page.evaluate(()=>Boolean(window.regionProofRelease)))return
   await settled()
  }
  assert.fail('A cached decode must consume the hold')
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
   return {svgHits,svgAttempts,intermediateFrames,changed,max,storage,cacheStorage:window.regionProofCacheMemory??null,width:canvas.width,height:canvas.height,value:input.value,focused:document.activeElement===input,calls:window.regionProofCalls.splice(0),errors:window.regionProofErrors.splice(0),png:canvas.toDataURL(),reference:ref.toDataURL()}
  })
  for(const key of ['png','reference']){await writeFile(path.join(output,`${name}-${key}.png`),Buffer.from(result[key].split(',')[1],'base64'));delete result[key]}
  results.push({name,...result});await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
  if(process.env.REGION_STORAGE)assert.equal(result.storage,process.env.REGION_STORAGE==='cpu',`${name}: requested storage must be exercised`)
  assert.equal(result.cacheStorage,result.storage,`${name}: region and source storage must match`)
  assert.equal(result.changed,0,`${name}: source pixels must equal a fresh full capture`)
  for(const frame of result.intermediateFrames)assert.equal(frame.changed,0,`${name}: every published frame must equal the stable full capture`)
  if(!['decode-recovery','svg-decode-recovery','cache-draw-recovery'].includes(name))assert.deepEqual(result.errors,[],`${name}: capture must succeed`)
  if(requirePartial)assert.ok(result.svgHits>0||result.calls.some(c=>c.clip),`${name}: must exercise partial capture`)
  return result
 }
 await settled();await page.focus('[data-munari-anchor="field:project"]');await compare('focused')
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
 await page.evaluate(async()=>{
  const {input,source,form}=window.regionProof
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
 const safeGlyph=await compare('font-subset-covered',true);assert.ok(safeGlyph.svgHits>0,'A new glyph covered by the embedded face must reuse SVG')
 await page.keyboard.type('B');const newFace=await compare('font-subset-new-face');assert.ok(newFace.calls.some(call=>call.clip),'A glyph selecting another face must capture it');assert.equal(newFace.svgHits,0,'An uncovered glyph must not reuse SVG')
 await page.evaluate(()=>{const {input,source}=window.regionProof,fixture=window.regionProofFontFixture;fixture.style.remove();for(const [node,text] of fixture.text)node.textContent=text;input.style.fontFamily=fixture.family;input.style.fontWeight=fixture.weight;input.value=fixture.value;input.setSelectionRange(0,0);input.scrollLeft=0;source.repaint({immediate:true})});await compare('font-subset-restored')
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
 await page.evaluate(()=>{window.regionProof.form.style.background='';window.regionProof.source.repaint({immediate:true})});await compare('midflight-background-restored')
 await page.evaluate(()=>{window.regionProofDrawFail=true;window.regionProof.source.setScale(1)})
 await page.waitForFunction(()=>window.regionProofErrors.some(error=>error.includes('deliberate region cache draw failure')))
 await page.evaluate(()=>{const {source,input}=window.regionProof;source.setScale(2);input.value+='q';input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'q'}))})
 const drawn=await compare('cache-draw-recovery');assert.ok(drawn.errors.some(error=>error.includes('deliberate region cache draw failure')));assert.ok(drawn.calls.every(c=>!c.clip))
 await page.evaluate(()=>{window.regionProofFail=true});await page.keyboard.type('!');await settled()
 await page.evaluate(()=>window.regionProof.source.repaint({immediate:true}));const recovered=await compare('decode-recovery');assert.ok(recovered.errors.some(e=>e.includes('deliberate region decode failure')))
 await seedShort();await holdSvg()
 assert.ok(await page.evaluate(()=>(window.regionProofSvgAttempts??0)>0),'Disposal must interrupt an actual cached decode')
 disposed=await page.evaluate(async()=>{const {source}=window.regionProof;const before=source.paintCount();source.dispose();window.regionProofRelease();await new Promise(resolve=>setTimeout(resolve,300));return {before,after:source.paintCount(),connected:source.host.isConnected}})
 }
 assert.equal(disposed.after,disposed.before);assert.equal(disposed.connected,false);assert.deepEqual(errors,[])
 await writeFile(path.join(output,'completion.json'),JSON.stringify({disposed,errors,browser:await browser.version()},null,2))
 console.log(JSON.stringify({checks:results.length,partialChecks:results.filter(r=>r.svgHits>0||r.calls.some(c=>c.clip)).map(r=>r.name),disposed,errors}))
}finally{if(browser)await browser.close();await server.close()}
