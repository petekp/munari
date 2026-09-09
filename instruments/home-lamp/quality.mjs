// Pinch zoom must sharpen the lamp, and emission must light more than its wire.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
import {setChromeViewport} from '../chromeViewport.mjs'
import {lampObserver} from './observer.mjs'

const output=process.env.LAMP_OUTPUT??path.join(tmpdir(),'munari-lamp-quality')
await mkdir(output,{recursive:true})
const shell={name:'lamp-zoom-frame',configureServer(server){server.middlewares.use((req,res,next)=>{
  if(req.url!=='/__lamp_zoom'){next();return}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><style>html,body{margin:0;height:100%;overflow:hidden}iframe{position:absolute;left:-100px;top:-40px;width:calc(100vw + 100px);height:calc(100vh + 40px);border:0;display:block}</style><iframe src="/?scene=home&framed"></iframe></html>')
})}}
const server=await createServer({root:path.resolve(import.meta.dirname,'../../apps/lab'),plugins:[lampObserver,shell],cacheDir:path.join(output,'.vite'),logLevel:'warn',server:{host:'127.0.0.1',port:0}})
await server.listen()
const frames=(page,count=4)=>page.evaluate(count=>new Promise(resolve=>{const next=()=>--count?requestAnimationFrame(next):resolve();requestAnimationFrame(next)}),count)
const draw=frame=>frame.evaluate(()=>new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Lamp draw did not complete')),5000)
  window.__lampRendered=canvas=>{clearTimeout(timeout);delete window.__lampRendered;resolve(canvas.toDataURL().split(',')[1])}
  window.__lampRedraw()
}))
let browser
const results={}
try{
  for(const enhanced of [true,false]){
    browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',defaultViewport:null,args:[...(enhanced?['--enable-features=CanvasDrawElement']:[]),'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']})
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
    const name=enhanced?'captured':'native'
    await setChromeViewport(page,{width:1000,height:600})
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__lamp_zoom`,{waitUntil:'load'})
    const frame=await page.waitForFrame(f=>f.url().includes('scene=home'))
    await frame.waitForFunction(()=>window.__lamp?.group.visible)
    await frame.evaluate(()=>document.fonts.ready);await frames(page,8)
    assert.equal(await frame.evaluate(()=>'drawElementImage' in CanvasRenderingContext2D.prototype),enhanced)
    if(enhanced)await frame.waitForFunction(()=>window.__lamp.uniforms.uPageReady.value===1)
    const frameBox=await page.$eval('iframe',e=>e.getBoundingClientRect().toJSON())
    const box=await frame.$eval('.home-light',e=>e.getBoundingClientRect().toJSON())
    await page.mouse.move(frameBox.x+box.x+box.width/2,frameBox.y+box.y+box.height/2);await page.mouse.down();await page.mouse.move(170,130,{steps:16});await page.mouse.up()
    await frame.evaluate(()=>{window.__freezeLamp=true;window.__lamp.group.rotation.z=.7})
    const client=await page.createCDPSession();await client.send('Emulation.setPageScaleFactor',{pageScaleFactor:3})
    const meta=await page.evaluate(()=>({dpr:devicePixelRatio,scale:visualViewport.scale,width:visualViewport.width,height:visualViewport.height,left:visualViewport.offsetLeft,top:visualViewport.offsetTop}))
    await frame.waitForFunction(ratio=>Math.abs(window.__lampRenderer.getPixelRatio()-ratio)<.01,{},meta.dpr*meta.scale)
    await frames(page,8)
    if(enhanced)await frame.waitForFunction(()=>window.__lamp.uniforms.uPageReady.value===1)
    const capture=async(label)=>{const png=await page.screenshot({encoding:'base64'});await writeFile(path.join(output,`${name}-${label}.png`),Buffer.from(png,'base64'));return png}
    const on=await capture('lit')
    await frame.evaluate(()=>window.__lamp.uniforms.uEmission.value=0)
    const alpha=await draw(frame),off=await capture('unlit')
    const allocation=await frame.evaluate(()=>{const renderer=window.__lampRenderer,c=renderer.domElement,r=c.getBoundingClientRect(),gl=renderer.getContext();return {ratio:renderer.getPixelRatio(),width:c.width,height:c.height,buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],css:[r.x,r.y,r.width,r.height],innerZoom:visualViewport.scale,point:[window.__lamp.group.position.x,innerHeight-window.__lamp.group.position.y]}})
    assert.deepEqual([allocation.width,allocation.height],allocation.buffer)
    assert.equal(allocation.innerZoom,1,'This must exercise a zoomed parent with an unzoomed iframe')
    await frame.evaluate(ratio=>window.__lampRenderer.setPixelRatio(ratio),meta.dpr*meta.scale*2)
    await draw(frame);const reference=await capture('reference')
    await frame.evaluate(ratio=>window.__lampRenderer.setPixelRatio(ratio),meta.dpr)
    await draw(frame);const coarse=await capture('coarse-control')
    let recoloured=null
    if(enhanced){
      await frame.evaluate(ratio=>window.__lampRenderer.setPixelRatio(ratio),meta.dpr*meta.scale)
      const previous=await frame.evaluate(()=>{const count=window.__lampPaintCount();document.querySelector('.home-masthead-title span').style.color='#e32516';return count})
      await frame.waitForFunction(previous=>window.__lampPaintCount()>previous,{},previous)
      await frames(page);await draw(frame);recoloured=await capture('live-colour-control')
    }
    const quality=await page.evaluate(async({on,off,alpha,reference,coarse,recoloured,meta,allocation,frameBox})=>{
      const decode=async data=>{const image=await createImageBitmap(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();return {data:ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas,ctx}}
      const lit=await decode(on),dark=await decode(off),mask=await decode(alpha),fine=await decode(reference),low=await decode(coarse)
      const colour=recoloured?await decode(recoloured):null
      const scale=lit.canvas.width/meta.width,cx=(frameBox.x+allocation.point[0]-meta.left)*scale,cy=(frameBox.y+allocation.point[1]-meta.top)*scale
      const a=(x,y)=>{const px=Math.floor((x/scale+meta.left-frameBox.x-allocation.css[0])*allocation.ratio),py=Math.floor((y/scale+meta.top-frameBox.y-allocation.css[1])*allocation.ratio);return px<0||py<0||px>=mask.canvas.width||py>=mask.canvas.height?0:mask.data[(py*mask.canvas.width+px)*4+3]}
      let edgeCount=0,nativeError=0,coarseError=0,inside=0,insideGain=0,outside=0,outsideGain=0,colourCount=0,colourDifference=0
      for(let y=2;y<lit.canvas.height-2;y++)for(let x=2;x<lit.canvas.width-2;x++){
        const distance=Math.hypot(x-cx,y-cy)/scale,i=(y*lit.canvas.width+x)*4
        if(distance>65)continue
        const gain=(lit.data[i]-dark.data[i]+lit.data[i+1]-dark.data[i+1]+lit.data[i+2]-dark.data[i+2])/3
        if(colour&&distance<24&&a(x,y)>250){colourCount++;for(let c=0;c<3;c++)colourDifference+=Math.abs(colour.data[i+c]-dark.data[i+c])}
        if(distance>16&&distance<24){inside++;insideGain+=gain}
        if(distance>35&&distance<48){outside++;outsideGain+=gain}
        if(distance<24||distance>45)continue
        const coverage=[a(x,y),a(x-2,y),a(x+2,y),a(x,y-2),a(x,y+2)]
        if(Math.min(...coverage)>10||Math.max(...coverage)<240)continue
        for(let c=0;c<3;c++){nativeError+=Math.abs(dark.data[i+c]-fine.data[i+c]);coarseError+=Math.abs(low.data[i+c]-fine.data[i+c])}edgeCount++
      }
      const left=Math.max(0,Math.floor(cx-70*scale)),top=Math.max(0,Math.floor(cy-90*scale))
      const crop=new OffscreenCanvas(Math.min(lit.canvas.width-left,Math.ceil(140*scale)),Math.min(lit.canvas.height-top,Math.ceil(170*scale))),ctx=crop.getContext('2d')
      ctx.drawImage(lit.canvas,left,top,crop.width,crop.height,0,0,crop.width,crop.height)
      const bytes=new Uint8Array(await (await crop.convertToBlob()).arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte)
      return {edgeCount,nativeError:nativeError/(edgeCount*3),coarseError:coarseError/(edgeCount*3),glassGain:insideGain/inside,haloGain:outsideGain/outside,liveColour:colourCount?colourDifference/(colourCount*3):null,crop:btoa(binary),image:[lit.canvas.width,lit.canvas.height]}
    },{on,off,alpha,reference,coarse,recoloured,meta,allocation,frameBox})
    await writeFile(path.join(output,`${name}-close.png`),Buffer.from(quality.crop,'base64'));delete quality.crop
    results[name]={meta,allocation,...quality,errors}
    console.log(JSON.stringify(results[name]))
    assert.ok(quality.edgeCount>100,'Measure the glass edge with emission disabled')
    assert.ok(quality.nativeError<quality.coarseError*.65,'Zoom-aware pixels must improve the unlit edge over a stretched bitmap')
    assert.ok(quality.glassGain>10,'Emission must brighten the glass beyond the filament')
    assert.ok(quality.haloGain>5,'Emission must spill beyond the glass silhouette')
    if(enhanced)assert.ok(quality.liveColour>3,'Zoomed refraction must sample the real heading through the viewport offset')
    assert.deepEqual(errors,[])
    await client.detach();await browser.close();browser=null
  }
  await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({results,error:String(error)},null,2));throw error}
finally{await browser?.close();await server.close()}
