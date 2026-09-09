// Compare the real curled postcard at native density with a supersampled draw.
// The fixed pose and renderer controls exist only in the served instrument copy.
import assert from 'node:assert/strict'
import {replaceSource} from '../home-light/replaceSource.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
import {setChromeViewport} from '../chromeViewport.mjs'

const output=process.env.PAPER_OUTPUT??path.join(tmpdir(),'munari-postcard-edges')
await mkdir(output,{recursive:true})
const observer={name:'postcard-edge-observer',enforce:'pre',transform(code,id){
  if(id.endsWith('/HomePostcard.tsx'))code=replaceSource(code,'gl={{ alpha: true }}','gl={{ alpha: true, preserveDrawingBuffer: true }}')
  if(id.endsWith('/HomePostcardMesh.tsx')){
    const marker='    const frameState = readSurfaceFrameState(surface)'
    assert.ok(code.includes(marker))
    code=replaceSource(code,marker,'    if(window.__freezeEdgePose)return;\n'+marker)
    const pose='    const st = f.current\n    const a = aim.current'
    assert.ok(code.includes(pose))
    code=replaceSource(code,pose,`    window.__setEdgePose=()=>{
      f.current.phase='afloat';f.current.t=1;f.current.still=1;
      group.position.set(sx,sy+HOVER_LIFT,0);group.rotation.set(-.22,-.06,-.035);
      deformSurfaceGeometry(mesh.geometry,[HERO_W,HERO_H],(x,y)=>paperPoint(x,y,{amount:1,bow:.6,curlA:2.85,curlB:.7,twist:0,ripple:0,time:0}));
      window.__freezeEdgePose=true;
    };\n`+pose)
  }
  if(id.endsWith('/HomeMasthead.tsx')){
    const marker='    pass.paper = createPaperLighting(renderer,pass.mesh.material)'
    assert.ok(code.includes(marker))
    code=replaceSource(code,marker,marker+'\n    window.__edgeLight={renderer,draw:()=>state.draw()};')
  }
  return code
}}
const server=await createServer({root:path.resolve(import.meta.dirname,'../../apps/lab'),plugins:[observer],cacheDir:path.join(output,'.vite'),logLevel:'warn',server:{host:'127.0.0.1',port:0}})
await server.listen()
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',defaultViewport:null,args:['--enable-features=CanvasDrawElement','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']})
const frames=(page,count=4)=>page.evaluate(count=>new Promise(resolve=>{const next=()=>--count?requestAnimationFrame(next):resolve();requestAnimationFrame(next)}),count)
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)))
  // The 2x reference needs a drawing buffer below Chrome's pixel-area limit.
  // A taller page can silently clamp the buffer and invalidate the comparison.
  await setChromeViewport(page,{width:1000,height:500})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=home&framed`,{waitUntil:'load'})
  assert.equal(await page.evaluate(()=>'drawElementImage' in CanvasRenderingContext2D.prototype),true,'The enhanced postcard is required')
  await page.evaluate(()=>document.fonts.ready)
  await page.evaluate(()=>{const holder=document.querySelector('.home-hero-holder');document.querySelector('.home-page').scrollTop+=holder.getBoundingClientRect().top-180})
  await page.click('.home-hero-row button')
  await page.waitForFunction(()=>window.__setEdgePose&&document.querySelector('.home-hero-row .home-postcard-status').dataset.gl==='true')
  const box=await page.$eval('.home-hero-holder',e=>e.getBoundingClientRect().toJSON())
  const light=await page.$eval('.home-light',e=>e.getBoundingClientRect().toJSON())
  await page.mouse.move(light.x+light.width/2,light.y+light.height/2);await page.mouse.down();await page.mouse.move(box.right+110,box.top-130,{steps:15})
  await page.evaluate(()=>window.__setEdgePose());await frames(page,12)
  const clip={x:Math.max(0,Math.floor(box.x-30)),y:Math.max(0,Math.floor(box.y-110)),width:Math.ceil(box.width+60),height:Math.ceil(box.height+145)}
  const capture=async(name)=>{const png=await page.screenshot({clip,encoding:'base64',captureBeyondViewport:false});await writeFile(path.join(output,`${name}.png`),Buffer.from(png,'base64'));return png}
  const native=await capture('native')
  const display=await page.evaluate(()=>({dpr:devicePixelRatio,lighting:window.__edgeLight.renderer.getPixelRatio(),antialias:window.__edgeLight.renderer.getContext().getContextAttributes().antialias}))
  if(process.env.EDGE_BASELINE_ONLY==='1'){console.log(JSON.stringify({display,errors}));await writeFile(path.join(output,'results.json'),JSON.stringify({display,errors},null,2))}
  else{
    assert.equal(display.lighting,display.dpr,'Paper lighting must retain native display density')
    assert.equal(display.antialias,true,'Geometry edges must have sample coverage')
    await page.evaluate(()=>{window.__edgeLight.renderer.setPixelRatio(devicePixelRatio*2);window.__edgeLight.draw()});await frames(page)
    const allocation=await page.evaluate(()=>{const renderer=window.__edgeLight.renderer,gl=renderer.getContext();return {canvas:[renderer.domElement.width,renderer.domElement.height],buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight]}})
    assert.deepEqual(allocation.canvas,allocation.buffer,'The supersampled drawing buffer must not be clamped')
    const reference=await capture('reference')
    await page.evaluate(()=>{window.__edgeLight.renderer.setPixelRatio(devicePixelRatio/2);window.__edgeLight.draw()});await frames(page)
    const coarse=await capture('coarse-control')
    const result=await page.evaluate(async({native,reference,coarse,clip})=>{
      const decode=async data=>{const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'}));const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();return {data:ctx.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height}}
      const a=await decode(native),b=await decode(reference),c=await decode(coarse)
      const source=document.querySelector('.home-canvas canvas'),rect=source.getBoundingClientRect(),mask=await decode(source.toDataURL().split(',')[1]),density=a.width/clip.width
      const alpha=(x,y)=>{const mx=Math.floor((clip.x+(x+.5)/density-rect.x)*mask.width/rect.width),my=Math.floor((clip.y+(y+.5)/density-rect.y)*mask.height/rect.height);return mx<0||my<0||mx>=mask.width||my>=mask.height?0:mask.data[(my*mask.width+mx)*4+3]}
      let samples=0,nativeError=0,coarseError=0
      for(let y=2;y<a.height-2;y++)for(let x=2;x<a.width-2;x++){
        const coverage=[alpha(x,y),alpha(x-2,y),alpha(x+2,y),alpha(x,y-2),alpha(x,y+2)]
        if(Math.min(...coverage)>10||Math.max(...coverage)<245)continue
        const offset=(y*a.width+x)*4
        for(let channel=0;channel<3;channel++){nativeError+=Math.abs(a.data[offset+channel]-b.data[offset+channel]);coarseError+=Math.abs(c.data[offset+channel]-b.data[offset+channel])}
        samples++
      }
      return {samples,nativeError:nativeError/(samples*3),coarseError:coarseError/(samples*3)}
    },{native,reference,coarse,clip})
    await page.evaluate(()=>{window.__edgeLight.renderer.setPixelRatio(devicePixelRatio);window.__edgeLight.draw()})
    assert.ok(result.samples>500,'The comparison must include the actual curved silhouette')
    assert.ok(result.nativeError<result.coarseError*.65,'Native paper edges must be closer to the supersampled reference than the coarse control')
    // A larger native-density band must stay aligned even when Chrome limits
    // its total pixel area. Only the scrolling margin may shrink.
    await page.mouse.up()
    await page.evaluate(()=>window.__freezeEdgePose=false)
    await setChromeViewport(page,{width:1200,height:900,deviceScaleFactor:4})
    await page.waitForFunction(()=>window.__edgeLight.renderer.getPixelRatio()===devicePixelRatio)
    const large=await page.evaluate(()=>{const renderer=window.__edgeLight.renderer,gl=renderer.getContext(),rect=renderer.domElement.getBoundingClientRect();return {dpr:devicePixelRatio,canvas:[renderer.domElement.width,renderer.domElement.height],buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],width:rect.width,height:rect.height,viewport:innerHeight}})
    assert.deepEqual(large.canvas,large.buffer,'Production must not display a clamped buffer')
    assert.equal(large.canvas[0]/large.width,large.dpr,'A large band must retain native horizontal density')
    assert.ok(large.height>=large.viewport,'The light band must cover the viewport')
    console.log(JSON.stringify({display,...result,large,errors}))
    await writeFile(path.join(output,'results.json'),JSON.stringify({display,...result,large,errors},null,2))
    assert.deepEqual(errors,[])
  }
}finally{await browser.close();await server.close()}
