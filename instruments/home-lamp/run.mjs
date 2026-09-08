// Real-page lamp optics and cord evidence. Controls change the served copy only.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
import {setChromeViewport} from '../chromeViewport.mjs'
import {lampObserver} from './observer.mjs'

const output=process.env.LAMP_OUTPUT??path.join(tmpdir(),'munari-home-lamp')
await mkdir(output,{recursive:true})
const server=await createServer({root:path.resolve(import.meta.dirname,'../../apps/lab'),plugins:[lampObserver],cacheDir:path.join(output,'.vite'),logLevel:'warn',server:{host:'127.0.0.1',port:0}})
await server.listen()
const launch=flags=>puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',defaultViewport:null,args:[...flags,'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']})
let browser
const results={},errors=[]
const frames=(page,count=4)=>page.evaluate(count=>new Promise(resolve=>{const next=()=>--count?requestAnimationFrame(next):resolve();requestAnimationFrame(next)}),count)
const move=async(page,x,y)=>{
  const box=await page.$eval('.home-light',e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})
  await page.mouse.move(box.x,box.y);await page.mouse.down();await page.mouse.move(x,y,{steps:20});await page.mouse.up();await frames(page)
}
const pixels=page=>page.evaluate(()=>new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{delete window.__lampRendered;reject(new Error('Lamp did not draw'))},5000)
  window.__lampRendered=canvas=>{
    clearTimeout(timeout)
    delete window.__lampRendered
    const gl=canvas.getContext('webgl2'),dpr=canvas.width/innerWidth,centre=window.__lamp.group.position,size=Math.round(86*dpr),data=new Uint8Array(size*size*4)
    gl.readPixels(Math.round((centre.x-43)*dpr),Math.round((centre.y-43)*dpr),size,size,gl.RGBA,gl.UNSIGNED_BYTE,data)
    resolve([...data])
  }
  window.__lampRedraw()
}))
const difference=(a,b)=>{
  let total=0,changed=0
  for(let i=0;i<a.length;i+=4){const d=Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])));total+=d;if(d>12)changed++}
  return {mean:total/(a.length/4),changed:changed/(a.length/4)}
}
const performanceProof=page=>page.evaluate(()=>new Promise(resolve=>{
  const gl=document.querySelector('.home-light-scene canvas').getContext('webgl2'),extension=gl.getExtension('EXT_disjoint_timer_query_webgl2'),queries=[],times=[]
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
    resolve({frames:stats(times),lampGpu:stats(gpu),capturePaints:window.__lampPaintCount()-paints,disjoint:Boolean(disjoint)})
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
    await page.waitForFunction(()=>window.__lamp?.uniforms.uPageReady.value===1)
    assert.equal(await page.evaluate(()=>document.querySelectorAll('.home-hero-holder [data-api-live]').length),1,'The page mirror must not claim another live postcard')
    await page.evaluate(()=>document.fonts.ready);await frames(page,12)
    results.display=await page.evaluate(()=>({dpr:devicePixelRatio,backing:document.querySelector('.home-light-scene canvas').width/innerWidth,capture:window.__lamp.uniforms.uPageReady.value}))
    await page.screenshot({path:path.join(output,'initial.png')})
    const target=await page.evaluate(()=>{const node=document.querySelector('.home-masthead-title span').firstChild,r=document.createRange();r.setStart(node,0);r.setEnd(node,1);const b=r.getBoundingClientRect();return {x:b.x+b.width*.25,y:b.y+b.height*.52}})
    await move(page,target.x,target.y)
    await page.evaluate(()=>window.__freezeLamp=true)
    const glass=await pixels(page)
    await page.screenshot({path:path.join(output,'over-type.png')})
    const clip={x:Math.max(0,target.x-90),y:Math.max(0,target.y-120),width:180,height:210}
    await page.screenshot({path:path.join(output,'glass.png'),clip,captureBeyondViewport:false})
    await page.evaluate(()=>window.__lamp.uniforms.uEmission.value=0)
    const dark=await pixels(page);results.emission=difference(glass,dark)
    await page.screenshot({path:path.join(output,'unlit-control.png'),clip,captureBeyondViewport:false})
    await page.evaluate(()=>{window.__lamp.uniforms.uEmission.value=1;window.__lamp.uniforms.uIor.value=1;window.__lamp.uniforms.uDispersion.value=0})
    const clear=await pixels(page);results.refraction=difference(glass,clear)
    await page.screenshot({path:path.join(output,'no-refraction-control.png'),clip,captureBeyondViewport:false})
    assert.ok(results.emission.changed>.002,'The filament must visibly emit light')
    assert.ok(results.refraction.changed>.01,'The glass must displace actual page content')
    await page.evaluate(()=>{window.__lamp.uniforms.uIor.value=1.5;window.__lamp.uniforms.uDispersion.value=.006;document.querySelector('.home-masthead-title span').style.color='#e32516'})
    await frames(page,16)
    const redHeading=await pixels(page);results.liveContent=difference(glass,redHeading)
    assert.ok(results.liveContent.changed>.02,'Changing the real heading colour must change the refracted image')
    await page.screenshot({path:path.join(output,'live-colour-control.png'),clip,captureBeyondViewport:false})
    await page.evaluate(()=>{document.querySelector('.home-masthead-title span').style.removeProperty('color');window.__freezeLamp=false})
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}])
    await frames(page,30)
    results.performance=await performanceProof(page)
    assert.ok(Number.isFinite(results.performance.capturePaints)&&results.performance.capturePaints<=2,'Moving only the lamp must not repeatedly capture the page')
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
      await page.waitForFunction(()=>window.__lamp.uniforms.uPageReady.value===1&&window.__lamp.uniforms.uViewport.value.x===innerWidth)
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
  results.native=await native.evaluate(()=>({captureAvailable:'drawElementImage' in CanvasRenderingContext2D.prototype,ready:window.__lamp.uniforms.uPageReady.value}))
  assert.equal(results.native.captureAvailable,false);assert.equal(results.native.ready,0)
  await move(native,600,280)
  await native.screenshot({path:path.join(output,'native.png')})
  assert.deepEqual(errors,[])
  await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2))
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({results,errors,error:String(error)},null,2));throw error}
finally{await browser?.close();await server.close()}
