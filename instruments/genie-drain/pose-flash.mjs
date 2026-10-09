// Stationary Genie pose across the real handoff (decision #65).
// Fixed CSS and geometry isolate capture pixels from animation and drain motion.
// Compare every image after the first scene draw with the native figure.
// The two-way 1px neighborhood allows raster edges without discarding ink;
// the existing 40-RGB / 1% budgets must reject stale and blank texture controls.
// The first framebuffer is held for 40ms so later page frames still show it.
// Observation lasts 80ms, or until the second scene draw is recorded if that
// is later. Hosted runners drew the scene every 88-106ms (2026-09-29), so 80ms
// alone held one draw in 4 of 16 cases and the late-blank control judged nothing.
// This gate does not measure natural motion, freeze timing or performance.
import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {mkdir,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import {createServer} from 'vite'
import {IncompleteScreencastError,requirePageFrameCoverage} from '../screencastCoverage.ts'
import {createScreencastRecorder,scoreScreencast} from '../screencastRecording.ts'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'
const root=path.resolve(import.meta.dirname,'../..')
const output=process.env.POSE_OUTPUT??path.join(tmpdir(),'munari-genie-pose')
const rounds=Number(process.env.ROUNDS??1)
assert.ok(Number.isInteger(rounds)&&rounds>0,'ROUNDS must be a positive integer')
const modes=(process.env.POSE_MODES??'auto,snapdom').split(','),windows=(process.env.POSE_WINDOWS??'cerchio,quadrato').split(',')
assert.ok(modes.length&&modes.every(mode=>['auto','snapdom'].includes(mode)))
assert.ok(windows.length&&windows.every(win=>['cerchio','quadrato'].includes(win)))
const chrome=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean).find(existsSync)
assert.ok(chrome,'Chrome is required')
const getter='  const api: GestureApi = {',frame='  useFrame(({ clock }, rawDt) => {',deform='deformSheets([geo, filmGeoRef.current], f, params, visibleT, wobble)',sheet='createGenieMaterial(surface, values)'
const inspect={name:'stationary-genie-pose',enforce:'pre',transform(code,id){
 if(!id.endsWith('/scenes/genie/Genie.tsx'))return
 for(const marker of [getter,frame,deform,sheet])assert.equal(code.split(marker).length,2,`Unique observation point: ${marker}`)
 return `import {surfaceStoreOf as __poseStoreOf} from ${JSON.stringify('/@fs'+path.join(root,'packages/react/src/primitives/surface/surfaceHandle.ts'))};\n`+code
  .replace(getter,'  window.__poseStore=(win:WinId)=>__poseStoreOf(storeOf(win).handle);\n'+getter)
  .replace(frame,'  useFrame(({ clock, scene, camera, gl }, rawDt) => {')
  // The texture controls replace what the sheet samples, which on a node material is its capture node's value.
  .replace(sheet,'Object.assign(createGenieMaterial(surface, values), {userData: {captureNode: surface.map}})')
  .replace(deform,'deformSheets([geo, filmGeoRef.current], f, params, window.__fixedPose?.win===win ? 0 : visibleT, wobble); window.__fixedPose?.observe({scene,camera,gl,win})')
}}
let server,browser,failure=null,caseFailure=null
const includeCleanupFailure=(failure,cleanupError)=>{
 const errors=failure?.cleanupErrors===undefined?(failure===null?[cleanupError]:[failure.error,cleanupError]):[...failure.cleanupErrors,cleanupError]
 const cleanupOnly=failure===null||failure.cleanupOnly===true
 return{error:new AggregateError(errors,cleanupOnly?`Cleanup failed: ${errors.map(String).join('; ')}`:`${String(errors[0])}; cleanup failed: ${errors.slice(1).map(String).join('; ')}`,{cause:errors[0]}),cleanupErrors:errors,cleanupOnly}
}
const results=[],deadline=setTimeout(()=>{console.error('Stationary pose exceeded 300s');process.exit(1)},300000)
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
try{
 await mkdir(output,{recursive:true})
 server=await createServer({root:path.join(root,'apps/lab'),plugins:[inspect],cacheDir:path.join(output,'.vite'),server:{host:'127.0.0.1',port:0,fs:{allow:[root]}},logLevel:'warn'})
 await server.listen()
 browser=await puppeteer.launch({executablePath:chrome,headless:process.env.HEADED!=='1',args:[...WEBGPU_CHROME_ARGS,'--enable-unsafe-swiftshader','--enable-features=CanvasDrawElement','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding',...(process.env.CI?['--no-sandbox']:[])]})
 for(let round=0;round<rounds;round++)for(const mode of modes)for(const win of windows)for(const control of ['current','stale','blank','late-blank']){
  for(let attempt=0;attempt<3;attempt++){
  const name=`${mode}-${win}-${control}${rounds>1?`-${round+1}`:''}`,directory=path.join(output,name,`recording-${attempt+1}`),page=await browser.newPage(),errors=[]
  let observation=null,retry=false,recorder,attemptFailure=null,result
  page.on('pageerror',error=>errors.push(String(error)))
  page.on('console',message=>{if(message.type()==='error'&&!message.text().startsWith('Failed to load resource:'))errors.push(message.text())})
  try{
   await mkdir(directory,{recursive:true})
   await page.evaluateOnNewDocument(()=>{window.__longTasks=[];new PerformanceObserver(list=>{for(const e of list.getEntries())window.__longTasks.push([performance.timeOrigin+e.startTime,e.duration])}).observe({type:'longtask',buffered:true})})
   await page.setViewport({width:1100,height:800,deviceScaleFactor:1})
   await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}])
   await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=genie&framed${mode==='snapdom'?'&capture=snapdom':''}`,{waitUntil:'load'})
   await page.waitForFunction(win=>window.__poseStore?.(win).parts().some(part=>part.runtime?.currentPaint())&&document.fonts.status==='loaded',{timeout:20000},win)
   assert.equal(await page.evaluate(()=>window.__munari.engine()),mode==='snapdom'?'snapdom':'html-in-canvas')
   recorder=await createScreencastRecorder(page,{format:'png',everyNthFrame:1,maxWidth:1100,maxHeight:800})
   const box=await page.evaluate(async({win,control})=>{
    for(const slot of document.querySelectorAll('.gen-slot'))slot.style.visibility=slot.dataset.win===win?'':'hidden'
    const store=window.__poseStore(win),part=store.parts().find(part=>part.runtime),runtime=part.runtime
    const native=document.querySelector(`.gen-slot[data-win="${win}"] .gen-math-pattern`)
    const tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
    const pin=time=>{
     for(const pattern of document.querySelectorAll(`.gen-math-pattern[data-pattern="${win}"]`))for(const animation of pattern.getAnimations({subtree:true})){animation.pause();animation.currentTime=time}
    }
    // The dash repeat is shorter than the animation; use half its visual period.
    const firstAnimation=native.getAnimations({subtree:true})[0],keyframes=firstAnimation.effect.getKeyframes()
    const offsets=keyframes.map(frame=>Number.parseFloat(frame.strokeDashoffset)).filter(Number.isFinite)
    const travel=Math.abs(offsets.at(-1)-offsets[0]),dash=getComputedStyle(native.querySelector('.gen-math-line')).strokeDasharray.split(/[ ,]+/).map(Number.parseFloat).reduce((sum,value)=>sum+value,0)
    const seedTime=2400-firstAnimation.effect.getComputedTiming().duration*dash/(2*travel)
    if(!Number.isFinite(seedTime)||seedTime===2400)throw Error('Cannot choose a distinct half-period dash pose')
    pin(seedTime);await tick()
    const floor=runtime.nextRead();runtime.repaint({immediate:true})
    const start=performance.now()
    while((runtime.currentPaint()?.read??-1)<floor){if(performance.now()-start>5000)throw Error('The stale-pose seed was not captured');await tick()}
    const image=document.createElement('canvas');image.width=runtime.source.canvas.width;image.height=runtime.source.canvas.height
    if(control==='stale')image.getContext('2d').drawImage(runtime.source.canvas,0,0)
    // Texture.clone shares Source. Fault pixels need their own Source object.
    const healthyTexture=runtime.texture(),healthyImage=healthyTexture.image
    const fault=healthyTexture.clone();fault.source=new healthyTexture.source.constructor(image);fault.needsUpdate=true
    if(fault.source===healthyTexture.source||healthyTexture.image!==healthyImage)throw Error('The fault texture changed the healthy source')
    pin(2400);await tick()
    const animations=native.getAnimations({subtree:true})
    if(animations.length!==(win==='cerchio'?9:7)||animations.some(a=>a.pending||a.playState!=='paused'||a.currentTime!==2400))throw Error('The native reference pose did not pin')
    const r=native.getBoundingClientRect(),box={x:r.x,y:r.y,width:r.width,height:r.height}
    const marker=document.createElement('canvas');marker.width=80;marker.height=4;marker.style.cssText='position:fixed;left:2px;top:2px;width:80px;height:4px;z-index:2147483647;pointer-events:none';document.body.append(marker)
    const ink=marker.getContext('2d'),draws=[],watched=new WeakMap()
    const mark=id=>{const bits=[1,0,1,0,1,1,0,0];for(let i=0;i<24;i++)bits.push((id>>>i)&1);const check=(id^(id>>>8)^(id>>>16)^165)&255;for(let i=0;i<8;i++)bits.push((check>>>i)&1);bits.forEach((bit,i)=>{ink.fillStyle=bit?'#fff':'#000';ink.fillRect(i*2,0,2,4)})};mark(0)
    function placement(mesh,camera,gl){
     const root=store.parts().find(part=>part.runtime)?.captureRoot,figure=root?.querySelector('.gen-math-pattern')
     if(!root||!figure)throw Error('Capture figure disappeared')
     const a=root.getBoundingClientRect(),b=figure.getBoundingClientRect(),viewport=gl.domElement.getBoundingClientRect(),pos=mesh.geometry.getAttribute('position')
     const {widthSegments:cols,heightSegments:rows}=mesh.geometry.parameters
     if(!cols||!rows||pos.count!==(cols+1)*(rows+1))throw Error('Unexpected Genie plane geometry')
     const point=(u,v)=>{
      const col=Math.min(cols-1,Math.floor(u*cols)),row=Math.min(rows-1,Math.floor(v*rows)),x=u*cols-col,y=v*rows-row,index=row*(cols+1)+col,below=index+cols+1
      const samples=x+y<=1?[[index,1-x-y],[below,y],[index+1,x]]:[[below,1-x],[below+1,x+y-1],[index+1,1-y]],p=mesh.position.clone().set(0,0,0)
      for(const [i,k]of samples){p.x+=pos.getX(i)*k;p.y+=pos.getY(i)*k;p.z+=pos.getZ(i)*k}p.applyMatrix4(mesh.matrixWorld).project(camera)
      return {x:viewport.x+(p.x+1)*viewport.width/2,y:viewport.y+(1-p.y)*viewport.height/2}
     }
     const u0=(b.x-a.x)/a.width,v0=(b.y-a.y)/a.height,u1=(b.right-a.x)/a.width,v1=(b.bottom-a.y)/a.height
     const points=[point(u0,v0),point(u1,v0),point(u1,v1),point(u0,v1),point((u0+u1)/2,(v0+v1)/2)]
     const expected=[[box.x,box.y],[box.x+box.width,box.y],[box.x+box.width,box.y+box.height],[box.x,box.y+box.height],[box.x+box.width/2,box.y+box.height/2]]
     return Math.max(...points.map((point,i)=>Math.hypot(point.x-expected[i][0],point.y-expected[i][1])))
    }
    const cadence={firstAt:null,blocked:0,renderer:null,canvasPass:false}
    window.__fixedPose={win,seedTime,draws,cadence,observe({scene,camera,gl,win:drawWin}){
     if(drawWin!==win)return
     // Keep the first actual framebuffer available for two recorder intervals.
     if(cadence.renderer!==gl){cadence.renderer=gl;const original=gl.render;gl.render=function(...args){if(cadence.firstAt!==null&&performance.timeOrigin+performance.now()-cadence.firstAt<40){cadence.blocked++;return}const outer=cadence.canvasPass;cadence.canvasPass=gl.getRenderTarget()===null;try{return original.apply(this,args)}finally{cadence.canvasPass=outer}}}
     scene.traverse(mesh=>{
      if(!mesh.userData?.isGenieSheet||mesh.userData.win!==win)return
      const old=watched.get(mesh);if(old?.before===mesh.onBeforeRender&&old?.after===mesh.onAfterRender)return
      const originalBefore=mesh.onBeforeRender,originalAfter=mesh.onAfterRender;let pass=null
      const before=function(...args){
       originalBefore.apply(this,args)
       const eligible=mesh.material.colorWrite&&cadence.canvasPass===true
       const textureForced=(control==='stale'||control==='blank')&&eligible
       const droppedWrite=control==='late-blank'&&eligible&&cadence.firstAt!==null&&performance.timeOrigin+performance.now()-cadence.firstAt>=40
       if(droppedWrite)mesh.material.colorWrite=false
       const capture=mesh.material.userData.captureNode
       pass={writing:mesh.material.colorWrite&&cadence.canvasPass===true,sampler:capture.value,textureForced,droppedWrite,forced:textureForced||droppedWrite,placement:placement(mesh,camera,gl)}
       if(textureForced)capture.value=fault
      }
      const after=function(...args){const submitted=pass;originalAfter.apply(this,args);if(submitted.textureForced)mesh.material.userData.captureNode.value=submitted.sampler;const captured=store.parts().find(part=>part.runtime)?.captureRoot?.querySelector('.gen-math-pattern')?.getAnimations({subtree:true})??[];const row={id:draws.length+1,t:performance.timeOrigin+performance.now(),writing:submitted.writing,pageHeld:store.holdsPage(),forced:submitted.forced,droppedWrite:submitted.droppedWrite,placement:submitted.placement,posePinned:native.getAnimations({subtree:true}).length===animations.length&&native.getAnimations({subtree:true}).every(a=>a.playState==='paused'&&a.currentTime===2400),captureTimes:[...new Set(captured.map(a=>a.currentTime))],capturePaused:captured.length===animations.length&&captured.every(a=>a.playState==='paused'),read:runtime.currentPaint()?.read,uploadedRead:runtime.uploadedRead()};if(row.writing&&!row.pageHeld&&cadence.firstAt===null)cadence.firstAt=row.t;draws.push(row);mark(row.id)}
      mesh.onBeforeRender=before;mesh.onAfterRender=after;watched.set(mesh,{before,after})
     })
    }}
    return box
   },{win,control})
   assert.ok(box.width>0&&box.height>0)
   const reference=await page.screenshot({encoding:'base64'})
   await writeFile(path.join(directory,'native.png'),Buffer.from(reference,'base64'))
   const lamp=await page.$eval(`.gen-slot[data-win="${win}"] .gen-lamp[data-role="minimize"]`,element=>{const r=element.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})
   await page.mouse.move(lamp.x,lamp.y,{steps:6});await sleep(300)
   await recorder.start();await sleep(100)
   const cdp=await page.createCDPSession();await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:500});await cdp.send('Profiler.start')
   await page.tracing.start({categories:['devtools.timeline','toplevel','blink','gpu','cc','viz','disabled-by-default-devtools.timeline']})
   const pressAt=await page.evaluate(()=>performance.timeOrigin+performance.now())
   await page.mouse.down();await sleep(50);await page.mouse.up();await sleep(450)
   const collectionEnd=await page.evaluate(()=>performance.timeOrigin+performance.now())
   const {profile}=await cdp.send('Profiler.stop');await cdp.detach()
   const traceTop=(events=>{const names=new Map(events.filter(e=>e.ph==='M'&&e.name==='thread_name').map(e=>[`${e.pid}:${e.tid}`,e.args?.name]));const byThread=new Map();for(const e of events){if(e.ph!=='X'||!(e.dur>0))continue;const k=`${e.pid}:${e.tid}`;if(!byThread.has(k))byThread.set(k,[]);byThread.get(k).push(e)}const out={};for(const [k,list] of byThread){const name=names.get(k)??k;if(!/CrRendererMain|CrGpuMain|VizCompositor|Compositor/.test(name))continue;list.sort((a,b)=>a.ts-b.ts||b.dur-a.dur);const self=new Map(),stack=[];for(const e of list){while(stack.length&&stack.at(-1).ts+stack.at(-1).dur<=e.ts)stack.pop();const top=stack.at(-1);if(top)self.set(top,(self.get(top)??top.dur)-e.dur);self.set(e,e.dur);stack.push(e)}const total=new Map();for(const [e,v] of self)total.set(e.name,(total.get(e.name)??0)+v);out[name+' '+k]=[...total].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([n,v])=>`${Math.round(v/1000)} ${n}`)}return out})(JSON.parse(Buffer.from(await page.tracing.stop()).toString()).traceEvents)
   const profileTop=(()=>{const byId=new Map(profile.nodes.map(n=>[n.id,n])),parent=new Map();for(const n of profile.nodes)for(const c of n.children??[])parent.set(c,n.id);const self=new Map(),incl=new Map(),name=n=>`${n.callFrame.functionName}@${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber}`;profile.samples.forEach((id,i)=>{const d=profile.timeDeltas[i]??0,n=byId.get(id);self.set(name(n),(self.get(name(n))??0)+d);const seen=new Set();for(let c=id;c!==undefined;c=parent.get(c)){const k=name(byId.get(c));if(seen.has(k))continue;seen.add(k);incl.set(k,(incl.get(k)??0)+d)}});const top=(m,k)=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,k).map(([f,v])=>`${Math.round(v/1000)} ${f}`);return{self:top(self,15),incl:top(incl,40)}})()
   const capture=await recorder.stop({through:collectionEnd,timeoutMs:5000}),frames=capture.frames
   const state=await page.evaluate(()=>({draws:window.__fixedPose.draws,seedTime:window.__fixedPose.seedTime,blockedDraws:window.__fixedPose.cadence.blocked,longTasks:window.__longTasks})),draws=state.draws,firstDraw=draws.find(draw=>draw.writing&&!draw.pageHeld)
   const scored=await scoreScreencast(page,capture,{
    reference:{kind:'image',encoding:'png',data:reference},
    context:{draws,box},
    createScorer(referenceImage,{draws,box}){
     const width=Math.round(box.width),height=Math.round(box.height),crop=image=>image.ctx.getImageData(Math.round(box.x),Math.round(box.y),width,height).data
     if(referenceImage.width!==1100||referenceImage.height!==800)throw Error('Reference viewport changed')
     const native=crop(referenceImage),total=width*height,background=[native[0],native[1],native[2]],delta=(a,i,b,j)=>Math.abs(a[i]-b[j])+Math.abs(a[i+1]-b[j+1])+Math.abs(a[i+2]-b[j+2])
     let nativeInk=0;for(let i=0;i<native.length;i+=4)if(Math.abs(native[i]-background[0])+Math.abs(native[i+1]-background[1])+Math.abs(native[i+2]-background[2])>40)nativeInk++
     // Both directions retain missing ink as evidence, unlike an excluded edge band.
     const mismatch=(a,b)=>{let count=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;let best=Infinity;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=Math.max(0,Math.min(width-1,x+dx)),ny=Math.max(0,Math.min(height-1,y+dy));best=Math.min(best,delta(a,i,b,(ny*width+nx)*4))}if(best>40)count++}return 100*count/total}
     const byId=new Map(draws.map(draw=>[draw.id,draw]))
     let presented=false
     return{
      inspect(image){
       if(image.width!==1100||image.height!==800)throw Error('Compositor viewport changed')
       const bits=[];for(let i=0;i<40;i++)bits.push(image.ctx.getImageData(3+i*2,3,1,1).data[0]>127?1:0)
       let id=0;for(let i=0;i<24;i++)id|=bits[i+8]<<i;let checksum=0;for(let i=0;i<8;i++)checksum|=bits[i+32]<<i
       const markerValid=bits.slice(0,8).join('')==='10101100'&&checksum===((id^(id>>>8)^(id>>>16)^165)&255)
       if(!markerValid)throw Error('Unreadable draw marker')
       const draw=byId.get(id)
       if(!presented){if(!draw?.writing||draw.pageHeld)return null;presented=true}
       // Once presentation starts, a blank or page-held image is still evidence.
       if(!draw)throw Error('A frame after presentation has no known draw marker')
       const pixels=crop(image)
       return{draw,nativeToScene:mismatch(native,pixels),sceneToNative:mismatch(pixels,native)}
      },
      summarize:()=>({nativeInk,total}),
     }
    },
   })
   const sceneRows=scored.rows.filter(row=>row.value!==null).map(row=>({index:row.index,t:row.t,draw:row.value.draw,nativeToScene:row.value.nativeToScene,sceneToNative:row.value.sceneToNative}))
   const clock=scored.rows.map(row=>({t:row.t,pageFrame:row.pageFrame}))
   const start=sceneRows[0]?.t,second=sceneRows.find(row=>row.draw.id!==sceneRows[0].draw.id)
   const end=second===undefined?start+80:Math.max(start+80,second.t),observed=sceneRows.filter(row=>row.t<=end)
   observation={firstDraw:firstDraw?.id,firstRecorded:observed[0]?.draw.id,secondRecorded:second?.draw.id,frames:observed.length,blockedDraws:state.blockedDraws,maximumPixelError:Math.max(...observed.map(row=>Math.max(row.nativeToScene,row.sceneToNative))),
    // Milliseconds after the press, so a failed run shows which wait ran out.
    timing:{firstDraw:firstDraw&&Math.round(firstDraw.t-pressAt),firstImage:start&&Math.round(start-pressAt),secondImage:second&&Math.round(second.t-pressAt),lastImage:frames.length?Math.round(frames.at(-1).t-pressAt):null,collectionEnd:Math.round(collectionEnd-pressAt),draws:draws.map(d=>[Math.round(d.t-pressAt),d.writing?1:0,d.pageHeld?1:0,d.read,d.uploadedRead]),profile:profileTop,trace:traceTop,longTasks:state.longTasks.map(([t,d])=>[Math.round(t-pressAt),Math.round(d)]).filter(([t])=>t>-200),drawGaps:draws.slice(1).map((draw,i)=>Math.round(draw.t-draws[i].t))}}
   await writeFile(path.join(directory,'measurement.json'),JSON.stringify({box,...scored.summary,firstDraw,seedTime:state.seedTime,blockedDraws:state.blockedDraws,draws,frames:observed,recording:{collectionEnd:capture.collectionEnd,...capture.diagnostics,scoring:scored.diagnostics}},null,2))
   const frameByIndex=new Map(frames.map(frame=>[frame.index,frame]))
   if(observed.length){await writeFile(path.join(directory,'first-scene.png'),Buffer.from(frameByIndex.get(observed[0].index).data,'base64'));await writeFile(path.join(directory,'last-scene.png'),Buffer.from(frameByIndex.get(observed.at(-1).index).data,'base64'))}
   assert.ok(firstDraw,'A direct scene presentation must be observed')
   assert.ok(scored.summary.nativeInk>scored.summary.total*.01,'Reference ink must exceed the failure budget so a blank figure cannot pass')
   assert.ok(sceneRows.length,'No scene compositor frame was captured')
   // Slow renderers may need no interception; the first recorded image is the proof.
   assert.equal(sceneRows[0].draw.id,firstDraw.id,'The first direct scene draw must be captured and judged')
   assert.equal(observed.length,frames.filter(frame=>frame.t>=start&&frame.t<=end).length,'Every recorded image in the interval must be scored')
   assert.ok(observed.every(row=>row.draw.posePinned),'The native pose must remain pinned')
   assert.ok(observed.every(row=>Number.isFinite(row.draw.placement)&&row.draw.placement<=.25),'Actual figure geometry must match its native rectangle within 0.25 CSS px')
   const rejected=observed.map(row=>row.nativeToScene>1||row.sceneToNative>1)
   if(control==='current')assert.ok(rejected.every(value=>!value),'A displayed scene frame differs from the fixed native pose')
   else if(control==='late-blank'){
    assert.ok(!observed[0].draw.forced&&!rejected[0],'The late-loss control must begin with a correct scene frame')
    if(second!==undefined)assert.ok(observed.some(row=>row.draw.droppedWrite&&!row.draw.writing),'A later suppressed-write image must be recorded and scored')
    assert.ok(observed.every((row,index)=>rejected[index]===row.draw.droppedWrite),'Judge both the initial correct images and every later blank image')
   }
   else{assert.ok(observed.every(row=>row.draw.forced),'The fault must reach every judged draw');assert.ok(rejected.every(Boolean),'The first and every stable wrong-pose/blank frame must fail')}
   assert.deepEqual(errors,[])
   requirePageFrameCoverage(clock,start,start+80)
   if(second===undefined)throw new IncompleteScreencastError('No second distinct known draw marker was recorded after the first presentation')
   if(end>start+80)requirePageFrameCoverage(clock,start,end)
   result={name,passed:true,recordings:attempt+1,timing:observation.timing,seedTime:state.seedTime,blockedDraws:state.blockedDraws,nativeInk:scored.summary.nativeInk,frames:observed,controlRejected:control==='current'?null:true,recording:{collectionEnd:capture.collectionEnd,...capture.diagnostics,scoring:scored.diagnostics}}
  }catch(error){
   attemptFailure={error}
  }finally{
   for(const close of [()=>recorder?.dispose(),()=>page.close()]){
    try{await close()}catch(cleanupError){attemptFailure=includeCleanupFailure(attemptFailure,cleanupError)}
   }
  }
  if(attemptFailure!==null){
   const error=attemptFailure.error
   // Cleanup failures are aggregates, so an incomplete observation cannot retry them.
   retry=attempt<2&&error instanceof IncompleteScreencastError
   if(retry)console.warn(`${name}: recording ${attempt+1}/3 unverified: ${error.message}`)
   else{if(caseFailure===null)caseFailure=attemptFailure;results.push({name,passed:false,recordings:attempt+1,error:String(error),errors,observation});process.exitCode=1}
  }else results.push(result)
  await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
  if(!retry)console.log(JSON.stringify(results.at(-1)))
  if(!retry)break
  }
 }
}catch(error){failure={error}}finally{
 for(const close of [()=>browser?.close(),()=>server?.close()]){
  try{await close()}catch(cleanupError){
   if(failure===null&&caseFailure!==null)failure=caseFailure
   failure=includeCleanupFailure(failure,cleanupError)
  }
 }
 clearTimeout(deadline)
}
if(failure!==null)throw failure.error
