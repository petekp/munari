// Real-page lamp optics and cord evidence. Controls change the served copy only.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
import {setChromeViewport} from '../chromeViewport.mjs'
import {lampObserver} from './observer.mjs'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'

const output=process.env.LAMP_OUTPUT??path.join(tmpdir(),'munari-home-lamp')
await mkdir(output,{recursive:true})
const server=await createServer({root:path.resolve(import.meta.dirname,'../../apps/lab'),plugins:[lampObserver],cacheDir:path.join(output,'.vite'),logLevel:'warn',server:{host:'127.0.0.1',port:0}})
await server.listen()
const launch=flags=>puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',defaultViewport:null,args:[...WEBGPU_CHROME_ARGS,...flags,'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']})
let browser
const results={},errors=[]
const frames=(page,count=4)=>page.evaluate(count=>new Promise(resolve=>{const next=()=>--count?requestAnimationFrame(next):resolve();requestAnimationFrame(next)}),count)
const move=async(page,x,y)=>{
  const box=await page.$eval('.home-light',e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})
  await page.mouse.move(box.x,box.y);await page.mouse.down();await page.mouse.move(x,y,{steps:20});await page.mouse.up();await frames(page)
}
const lampFrame=page=>page.evaluate(async url=>{window.__lampFrame=await import(url)},'/@fs'+path.join(import.meta.dirname,'lampFrame.mjs'))
const pixels=page=>page.evaluate(()=>window.__lampFrame.drawLamp((canvas,readCanvasRect)=>{
  const dpr=canvas.width/innerWidth,centre=window.__lamp.group.position,size=Math.round(86*dpr)
  const x=Math.round((centre.x-43)*dpr),y=Math.round((centre.y-43)*dpr),[width,height]=window.__lampFrame.canvasBuffer(window.__lampRenderer)
  if(size<=0||x<0||y<0||x+size>width||y+size>height)throw new Error('Lamp sample is outside a readable framebuffer')
  return [...readCanvasRect(canvas,x,y,size,size)]
}))
const difference=(a,b)=>{
  assert.ok(a.length>0&&a.length===b.length,'Optical comparisons need matching nonempty pixel buffers')
  let total=0,changed=0
  for(let i=0;i<a.length;i+=4){const d=Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])));total+=d;if(d>12)changed++}
  return {mean:total/(a.length/4),changed:changed/(a.length/4)}
}
// GPU time is the lamp's render() under TIME_ELAPSED, texture uploads included.
// WebGPU timestamps cover render passes only, not the canvas copies before them,
// so that backend reports the interval as unmeasured rather than a shorter one.
const performanceProof=page=>page.evaluate(()=>new Promise(resolve=>{
  const gl=window.__lampRenderer.backend.gl,extension=gl?.getExtension('EXT_disjoint_timer_query_webgl2'),queries=[],times=[]
  let current=null,count=0,previous=0
  const paints=window.__lampPaintCount()
  if(extension){
    window.__lampGpuStart=()=>{if(queries.length<90){current=gl.createQuery();gl.beginQuery(extension.TIME_ELAPSED_EXT,current)}}
    window.__lampGpuEnd=()=>{if(current){gl.endQuery(extension.TIME_ELAPSED_EXT);queries.push(current);current=null}}
  }
  const tick=time=>{
    if(previous)times.push(time-previous);previous=time
    if(++count<150){requestAnimationFrame(tick);return}
    delete window.__lampGpuStart;delete window.__lampGpuEnd
    const disjoint=extension&&gl.getParameter(extension.GPU_DISJOINT_EXT)
    const gpu=extension&&!disjoint?queries.filter(q=>gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)).map(q=>gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6):[]
    queries.forEach(q=>gl.deleteQuery(q))
    const stats=values=>{const sorted=values.slice(8).sort((a,b)=>a-b);return {samples:sorted.length,p95:sorted[Math.floor(sorted.length*.95)]??null,max:sorted.at(-1)??null}}
    const lampGpu=stats(gpu)
    resolve({frames:stats(times),lampGpu,capturePaints:window.__lampPaintCount()-paints,disjoint:Boolean(disjoint),gpuStatus:!gl?'webgpu-unmeasured':!extension?'unsupported':disjoint?'disjoint':lampGpu.samples?'measured':'unobserved'})
  }
  requestAnimationFrame(tick)
}))
try{
  browser=await launch(['--enable-features=CanvasDrawElement'])
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)))
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('404'))errors.push(message.text())})
  await setChromeViewport(page,{width:1200,height:900})
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=home&framed`,{waitUntil:'load'})
  const capable=await page.evaluate(()=>'drawElementImage' in CanvasRenderingContext2D.prototype)
  if(!capable){assert.notEqual(process.env.STRICT_CAPABILITY,'1','HTML-in-canvas is required');console.log('SKIP: HTML-in-canvas unavailable');process.exitCode=0}
  else{
    await page.waitForFunction(()=>window.__lamp?.backdrop.pageReady.value===1)
    await lampFrame(page)
    assert.equal(await page.evaluate(()=>document.querySelectorAll('.home-hero-holder [data-api-live]').length),1,'The page mirror must not claim another live postcard')
    await page.evaluate(()=>document.fonts.ready);await frames(page,12)
    results.display=await page.evaluate(()=>({dpr:devicePixelRatio,backing:document.querySelector('.home-light-scene canvas').width/innerWidth,capture:window.__lamp.backdrop.pageReady.value}))
    await page.screenshot({path:path.join(output,'initial.png')})
    const target=await page.evaluate(()=>{const node=document.querySelector('.home-masthead-title span').firstChild,r=document.createRange();r.setStart(node,0);r.setEnd(node,1);const b=r.getBoundingClientRect();return {x:b.x+b.width*.25,y:b.y+b.height*.52}})
    await move(page,target.x,target.y)
    await page.evaluate(()=>window.__freezeLamp=true)
    const glass=await pixels(page)
    await page.screenshot({path:path.join(output,'over-type.png')})
    const clip={x:Math.max(0,target.x-90),y:Math.max(0,target.y-120),width:180,height:210}
    await page.screenshot({path:path.join(output,'glass.png'),clip,captureBeyondViewport:false})
    await page.evaluate(()=>window.__lamp.values.emission.value=0)
    const dark=await pixels(page);results.emission=difference(glass,dark)
    await page.screenshot({path:path.join(output,'unlit-control.png'),clip,captureBeyondViewport:false})
    await page.evaluate(()=>{window.__lamp.values.emission.value=1;window.__lamp.values.ior.value=1;window.__lamp.values.dispersion.value=0})
    const clear=await pixels(page);results.refraction=difference(glass,clear)
    await page.screenshot({path:path.join(output,'no-refraction-control.png'),clip,captureBeyondViewport:false})
    assert.ok(results.emission.changed>.002,'The filament must visibly emit light')
    assert.ok(results.refraction.changed>.01,'The glass must displace actual page content')
    await page.evaluate(()=>{window.__lamp.values.ior.value=1.5;window.__lamp.values.dispersion.value=.006;document.querySelector('.home-masthead-title span').style.color='#e32516'})
    await frames(page,16)
    const redHeading=await pixels(page);results.liveContent=difference(glass,redHeading)
    assert.ok(results.liveContent.changed>.02,'Changing the real heading colour must change the refracted image')
    await page.screenshot({path:path.join(output,'live-colour-control.png'),clip,captureBeyondViewport:false})
    await page.evaluate(()=>{document.querySelector('.home-masthead-title span').style.removeProperty('color');window.__freezeLamp=false})
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}])
    await frames(page,30)
    results.performance=await performanceProof(page)
    assert.ok(Number.isFinite(results.performance.capturePaints)&&results.performance.capturePaints>=0&&results.performance.capturePaints<=2,'Moving only the lamp must not repeatedly capture or reset the page source')
    await move(page,700,330);await frames(page,4)
    results.cord=await page.evaluate(()=>{
      const c=window.__lamp.cord,p=c.points,dx=c.endX-c.anchorX,dy=c.endY+100,length=Math.hypot(dx,dy)
      let deviation=0;for(let i=2;i<p.length-2;i+=2)deviation=Math.max(deviation,Math.abs((p[i]-c.anchorX)*dy-(p[i+1]+100)*dx)/length)
      const lamp=window.__lamp,angle=lamp.body.rotation.z,socketX=lamp.group.position.x-Math.sin(angle)*55,socketY=innerHeight-lamp.group.position.y-Math.cos(angle)*55
      return {deviation,finite:[...p].every(Number.isFinite),pinned:Math.hypot(p.at(-2)-c.endX,p.at(-1)-c.endY),socketGap:Math.hypot(p.at(-2)-socketX,p.at(-1)-socketY)}
    })
    assert.ok(results.cord.deviation>1,'The cord must visibly bend away from a rigid rod')
    assert.equal(results.cord.finite,true);assert.equal(results.cord.pinned,0)
    assert.ok(results.cord.socketGap<.01,'The cord must end at the moving socket')
    await page.screenshot({path:path.join(output,'cord.png')})
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await frames(page)
    await page.click('.home-hero-row button')
    await page.waitForFunction(()=>document.querySelector('.home-hero-row .home-postcard-status').dataset.gl==='true')
    await move(page,340,640);await frames(page,12)
    await page.screenshot({path:path.join(output,'over-postcard.png')})
    await page.click('.home-hero-row button')
    await page.waitForFunction(()=>document.querySelector('.home-hero-row .home-postcard-status').dataset.gl==='false')
    await page.evaluate(()=>document.querySelector('.home-page').scrollTop=700);await frames(page,30)
    await page.screenshot({path:path.join(output,'scrolled.png')})
    for(const width of [390,320]){
      await setChromeViewport(page,{width,height:844})
      await page.waitForFunction(()=>window.__lamp.backdrop.pageReady.value===1&&window.__lamp.backdrop.viewport.value.x===innerWidth)
      assert.equal(await page.evaluate(()=>document.querySelector('.home-page').scrollWidth>innerWidth),false)
      await page.screenshot({path:path.join(output,`mobile-${width}.png`)})
    }
    assert.deepEqual(errors,[])
  }
  await browser.close();browser=null
  browser=await launch([])
  const native=await browser.newPage();native.on('pageerror',e=>errors.push(String(e)))
  await setChromeViewport(native,{width:1200,height:900})
  await native.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=home&framed`,{waitUntil:'load'})
  await native.waitForFunction(()=>window.__lamp?.group.visible)
  results.native=await native.evaluate(()=>({captureAvailable:'drawElementImage' in CanvasRenderingContext2D.prototype,ready:window.__lamp.backdrop.pageReady.value}))
  assert.equal(results.native.captureAvailable,false);assert.equal(results.native.ready,0)
  await move(native,600,280)
  await native.screenshot({path:path.join(output,'native.png')})
  assert.deepEqual(errors,[])
  await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2))
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({results,errors,error:String(error)},null,2));throw error}
finally{await browser?.close();await server.close()}
