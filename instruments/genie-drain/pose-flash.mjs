// Stationary Genie pose across the real handoff (decision #65).
// Fixed CSS and geometry isolate capture pixels from animation and drain motion.
// Compare every image after the first scene draw with the native figure.
// The two-way 1px neighborhood allows raster edges without discarding ink;
// the existing 40-RGB / 1% budgets must reject stale and blank texture controls.
// The first framebuffer is held for 40ms so two 20ms recorder intervals can see it.
// This gate does not measure natural motion, freeze timing or performance.
import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {mkdir,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import {createServer} from 'vite'
import {IncompleteScreencastError,installScreencastClock,requireScreencastCoverage} from '../screencastCoverage.ts'
const root=path.resolve(import.meta.dirname,'../..')
const output=process.env.POSE_OUTPUT??path.join(tmpdir(),'munari-genie-pose')
const rounds=Number(process.env.ROUNDS??1)
assert.ok(Number.isInteger(rounds)&&rounds>0,'ROUNDS must be a positive integer')
const modes=(process.env.POSE_MODES??'auto,snapdom').split(','),windows=(process.env.POSE_WINDOWS??'cerchio,quadrato').split(',')
assert.ok(modes.length&&modes.every(mode=>['auto','snapdom'].includes(mode)))
assert.ok(windows.length&&windows.every(win=>['cerchio','quadrato'].includes(win)))
const chrome=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean).find(existsSync)
assert.ok(chrome,'Chrome is required')
const getter='  const api: GestureApi = {',frame='  useFrame(({ clock }, rawDt) => {',deform='deformSheets([geo, filmGeoRef.current], f, params, visibleT, wobble)'
const inspect={name:'stationary-genie-pose',enforce:'pre',transform(code,id){
 if(!id.endsWith('/scenes/genie/Genie.tsx'))return
 for(const marker of [getter,frame,deform])assert.equal(code.split(marker).length,2,`Unique observation point: ${marker}`)
 return `import {surfaceStoreOf as __poseStoreOf} from ${JSON.stringify('/@fs'+path.join(root,'packages/react/src/primitives/surface/surfaceHandle.ts'))};\n`+code
  .replace(getter,'  window.__poseStore=(win:WinId)=>__poseStoreOf(storeOf(win).handle);\n'+getter)
  .replace(frame,'  useFrame(({ clock, scene, camera, gl }, rawDt) => {')
  .replace(deform,'deformSheets([geo, filmGeoRef.current], f, params, window.__fixedPose?.win===win ? 0 : visibleT, wobble); window.__fixedPose?.observe({scene,camera,gl,win})')
}}
let server,browser
const results=[],deadline=setTimeout(()=>{console.error('Stationary pose exceeded 300s');process.exit(1)},300000)
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
try{
 await mkdir(output,{recursive:true})
 server=await createServer({root:path.join(root,'apps/lab'),plugins:[inspect],cacheDir:path.join(output,'.vite'),server:{host:'127.0.0.1',port:0,fs:{allow:[root]}},logLevel:'warn'})
 await server.listen()
 browser=await puppeteer.launch({executablePath:chrome,headless:process.env.HEADED!=='1',args:['--enable-features=CanvasDrawElement','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding',...(process.env.CI?['--no-sandbox']:[])]})
 for(let round=0;round<rounds;round++)for(const mode of modes)for(const win of windows)for(const control of ['current','stale','blank','late-blank']){
  for(let attempt=0;attempt<3;attempt++){
  const name=`${mode}-${win}-${control}${rounds>1?`-${round+1}`:''}`,directory=path.join(output,name,`recording-${attempt+1}`),page=await browser.newPage(),errors=[]
  let observation=null,retry=false
  await mkdir(directory,{recursive:true})
  page.on('pageerror',error=>errors.push(String(error)))
  page.on('console',message=>{if(message.type()==='error'&&!message.text().startsWith('Failed to load resource:'))errors.push(message.text())})
  try{
   await page.setViewport({width:1100,height:800,deviceScaleFactor:1})
   await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}])
   await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=genie&framed${mode==='snapdom'?'&capture=snapdom':''}`,{waitUntil:'load'})
   await page.waitForFunction(win=>window.__poseStore?.(win).parts().some(part=>part.runtime?.currentPaint())&&document.fonts.status==='loaded',{timeout:20000},win)
   assert.equal(await page.evaluate(()=>window.__munari.engine()),mode==='snapdom'?'snapdom':'html-in-canvas')
   await page.evaluate(installScreencastClock)
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
    const cadence={firstAt:null,blocked:0,renderer:null}
    window.__fixedPose={win,seedTime,draws,cadence,observe({scene,camera,gl,win:drawWin}){
     if(drawWin!==win)return
     // Keep the first actual framebuffer available for two recorder intervals.
     if(cadence.renderer!==gl){cadence.renderer=gl;const original=gl.render;gl.render=function(...args){if(cadence.firstAt!==null&&performance.timeOrigin+performance.now()-cadence.firstAt<40){cadence.blocked++;return}return original.apply(this,args)}}
     scene.traverse(mesh=>{
      if(!mesh.userData?.isGenieSheet||mesh.userData.win!==win)return
      const old=watched.get(mesh);if(old?.before===mesh.onBeforeRender&&old?.after===mesh.onAfterRender)return
      const originalBefore=mesh.onBeforeRender,originalAfter=mesh.onAfterRender;let pass=null
      const before=function(...args){
       originalBefore.apply(this,args)
       const eligible=mesh.material.colorWrite&&gl.getRenderTarget()===null
       const textureForced=(control==='stale'||control==='blank')&&eligible
       const droppedWrite=control==='late-blank'&&eligible&&cadence.firstAt!==null&&performance.timeOrigin+performance.now()-cadence.firstAt>=40
       if(droppedWrite)mesh.material.colorWrite=false
       pass={writing:mesh.material.colorWrite&&gl.getRenderTarget()===null,sampler:mesh.material.uniforms.tMap.value,textureForced,droppedWrite,forced:textureForced||droppedWrite,placement:placement(mesh,camera,gl)}
       if(textureForced)mesh.material.uniforms.tMap.value=fault
      }
      const after=function(...args){const submitted=pass;originalAfter.apply(this,args);if(submitted.textureForced)mesh.material.uniforms.tMap.value=submitted.sampler;const captured=store.parts().find(part=>part.runtime)?.captureRoot?.querySelector('.gen-math-pattern')?.getAnimations({subtree:true})??[];const row={id:draws.length+1,t:performance.timeOrigin+performance.now(),writing:submitted.writing,pageHeld:store.holdsPage(),forced:submitted.forced,droppedWrite:submitted.droppedWrite,placement:submitted.placement,posePinned:native.getAnimations({subtree:true}).length===animations.length&&native.getAnimations({subtree:true}).every(a=>a.playState==='paused'&&a.currentTime===2400),captureTimes:[...new Set(captured.map(a=>a.currentTime))],capturePaused:captured.length===animations.length&&captured.every(a=>a.playState==='paused'),read:runtime.currentPaint()?.read,uploadedRead:runtime.uploadedRead()};if(row.writing&&!row.pageHeld&&cadence.firstAt===null)cadence.firstAt=row.t;draws.push(row);mark(row.id)}
      mesh.onBeforeRender=before;mesh.onAfterRender=after;watched.set(mesh,{before,after})
     })
    }}
    return box
   },{win,control})
   assert.ok(box.width>0&&box.height>0)
   const reference=await page.screenshot({encoding:'base64'})
   await writeFile(path.join(directory,'native.png'),Buffer.from(reference,'base64'))
   const client=await page.createCDPSession(),frames=[]
   client.on('Page.screencastFrame',frame=>{frames.push({t:frame.metadata.timestamp*1000,data:frame.data});void client.send('Page.screencastFrameAck',{sessionId:frame.sessionId}).catch(()=>{})})
   const lamp=await page.$eval(`.gen-slot[data-win="${win}"] .gen-lamp[data-role="minimize"]`,element=>{const r=element.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})
   await page.mouse.move(lamp.x,lamp.y,{steps:6});await sleep(300)
   await client.send('Page.startScreencast',{format:'png',everyNthFrame:1,maxWidth:1100,maxHeight:800});await sleep(100)
   await page.mouse.down();await sleep(50);await page.mouse.up();await sleep(450)
   await client.send('Page.stopScreencast');await sleep(60)
   const state=await page.evaluate(()=>({draws:window.__fixedPose.draws,seedTime:window.__fixedPose.seedTime,blockedDraws:window.__fixedPose.cadence.blocked})),draws=state.draws,firstDraw=draws.find(draw=>draw.writing&&!draw.pageHeld)
   frames.sort((a,b)=>a.t-b.t)
   const scored=await page.evaluate(async({reference,frames,draws,box})=>{
    const decode=async data=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);return{ctx,width:image.width,height:image.height}}
    const referenceImage=await decode(reference),width=Math.round(box.width),height=Math.round(box.height),crop=image=>image.ctx.getImageData(Math.round(box.x),Math.round(box.y),width,height).data
    if(referenceImage.width!==1100||referenceImage.height!==800)throw Error('Reference viewport changed')
    const native=crop(referenceImage),total=width*height,background=[native[0],native[1],native[2]],delta=(a,i,b,j)=>Math.abs(a[i]-b[j])+Math.abs(a[i+1]-b[j+1])+Math.abs(a[i+2]-b[j+2])
    let nativeInk=0;for(let i=0;i<native.length;i+=4)if(Math.abs(native[i]-background[0])+Math.abs(native[i+1]-background[1])+Math.abs(native[i+2]-background[2])>40)nativeInk++
    // Both directions retain missing ink as evidence, unlike an excluded edge band.
    const mismatch=(a,b)=>{let count=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;let best=Infinity;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=Math.max(0,Math.min(width-1,x+dx)),ny=Math.max(0,Math.min(height-1,y+dy));best=Math.min(best,delta(a,i,b,(ny*width+nx)*4))}if(best>40)count++}return 100*count/total}
    const byId=new Map(draws.map(draw=>[draw.id,draw])),rows=[]
    let presented=false
    for(let index=0;index<frames.length;index++){
     const image=await decode(frames[index].data);if(image.width!==1100||image.height!==800)throw Error('Compositor viewport changed')
     const bits=[];for(let i=0;i<40;i++)bits.push(image.ctx.getImageData(3+i*2,3,1,1).data[0]>127?1:0)
     let id=0;for(let i=0;i<24;i++)id|=bits[i+8]<<i;let checksum=0;for(let i=0;i<8;i++)checksum|=bits[i+32]<<i
     const markerValid=bits.slice(0,8).join('')==='10101100'&&checksum===((id^(id>>>8)^(id>>>16)^165)&255)
     if(!markerValid)throw Error('Unreadable draw marker')
     const draw=byId.get(id)
     if(!presented){if(!draw?.writing||draw.pageHeld)continue;presented=true}
     // Once presentation starts, a blank or page-held image is still evidence.
     if(!draw)throw Error('A frame after presentation has no known draw marker')
     const pixels=crop(image);rows.push({index,t:frames[index].t,draw,nativeToScene:mismatch(native,pixels),sceneToNative:mismatch(pixels,native)})
    }
    return{nativeInk,total,rows}
   },{reference,frames,draws,box})
   const start=scored.rows[0]?.t,observed=scored.rows.filter(row=>row.t<=start+80)
   observation={firstDraw:firstDraw?.id,firstRecorded:observed[0]?.draw.id,frames:observed.length,blockedDraws:state.blockedDraws,maximumPixelError:Math.max(...observed.map(row=>Math.max(row.nativeToScene,row.sceneToNative)))}
   await writeFile(path.join(directory,'measurement.json'),JSON.stringify({box,nativeInk:scored.nativeInk,total:scored.total,firstDraw,seedTime:state.seedTime,blockedDraws:state.blockedDraws,draws,frames:observed},null,2))
   if(observed.length){await writeFile(path.join(directory,'first-scene.png'),Buffer.from(frames[observed[0].index].data,'base64'));await writeFile(path.join(directory,'last-scene.png'),Buffer.from(frames[observed.at(-1).index].data,'base64'))}
   assert.ok(firstDraw,'A direct scene presentation must be observed')
   assert.ok(scored.nativeInk>scored.total*.01,'Reference ink must exceed the failure budget so a blank figure cannot pass')
   assert.ok(scored.rows.length,'No scene compositor frame was captured')
   // Slow renderers may need no interception; the first recorded image is the proof.
   assert.equal(scored.rows[0].draw.id,firstDraw.id,'The first direct scene draw must be captured and judged')
   assert.equal(observed.length,frames.filter(frame=>frame.t>=start&&frame.t<=start+80).length,'Every recorded image in the interval must be scored')
   assert.ok(observed.every(row=>row.draw.posePinned),'The native pose must remain pinned')
   assert.ok(observed.every(row=>Number.isFinite(row.draw.placement)&&row.draw.placement<=.25),'Actual figure geometry must match its native rectangle within 0.25 CSS px')
   const rejected=observed.map(row=>row.nativeToScene>1||row.sceneToNative>1)
   if(control==='current')assert.ok(rejected.every(value=>!value),'A displayed scene frame differs from the fixed native pose')
   else if(control==='late-blank'){
    assert.ok(!observed[0].draw.forced&&!rejected[0],'The late-loss control must begin with a correct scene frame')
    assert.ok(observed.some(row=>row.draw.droppedWrite&&!row.draw.writing),'A later suppressed-write image must be recorded and scored')
    assert.ok(observed.every((row,index)=>rejected[index]===row.draw.droppedWrite),'Judge both the initial correct images and every later blank image')
   }
   else{assert.ok(observed.every(row=>row.draw.forced),'The fault must reach every judged draw');assert.ok(rejected.every(Boolean),'The first and every stable wrong-pose/blank frame must fail')}
   assert.deepEqual(errors,[])
   requireScreencastCoverage(frames,start,start+80,20)
   results.push({name,passed:true,recordings:attempt+1,seedTime:state.seedTime,blockedDraws:state.blockedDraws,nativeInk:scored.nativeInk,frames:observed,controlRejected:control==='current'?null:true})
   await client.detach()
  }catch(error){
   // Pixel and control assertions run first. Only missing recording coverage retries.
   retry=attempt<2&&error instanceof IncompleteScreencastError
   if(retry)console.warn(`${name}: recording ${attempt+1}/3 unverified: ${error.message}`)
   else{results.push({name,passed:false,recordings:attempt+1,error:String(error),errors,observation});process.exitCode=1}
  }
  finally{await page.close();await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));if(!retry)console.log(JSON.stringify(results.at(-1)))}
  if(!retry)break
  }
 }
}finally{clearTimeout(deadline);await browser?.close();await server?.close()}
