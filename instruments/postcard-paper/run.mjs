// Real paper motion, native controls, and a short recorded Chrome sequence.
import assert from 'node:assert/strict'
import {replaceSource} from '../home-light/replaceSource.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import path from 'node:path'
import {tmpdir} from 'node:os'
import puppeteer from 'puppeteer-core'
import {createServer} from 'vite'
import {setChromeViewport} from '../chromeViewport.mjs'
import {observeLightingDraw,measureLightingDraw} from '../home-light/gpu.mjs'
import {installPaperReader,paperMetrics,controlPoint,silhouetteMetrics} from './metrics.mjs'

const output=process.env.PAPER_OUTPUT??path.join(tmpdir(),'munari-paper')
await mkdir(output,{recursive:true})
const flat=process.env.PAPER_FLAT==='1',record=process.env.PAPER_RECORD==='1'
const observer={name:'paper-observer',enforce:'pre',transform(code,id){
  code=observeLightingDraw(code,id)
  if(id.endsWith('/HomePostcard.tsx'))code=replaceSource(code,'gl={{ alpha: true }}','gl={{ alpha: true, preserveDrawingBuffer: true }}')
  if(id.endsWith('/homeLight.ts'))code=replaceSource(code,'  material.uniforms.uLightHeight.value = lightHeight','  window.__paperLight = material\n  material.uniforms.uLightHeight.value = lightHeight')
  if(id.endsWith('/HomePostcardMesh.tsx')){
    const marker='  deformSurfaceGeometry(mesh.geometry,[HERO_W,HERO_H],(x,y)=>paperPoint(x,y,shape))'
    assert.ok(code.includes(marker),'Paper observation point changed')
    code=replaceSource(code,marker,'  window.__paperShape = shape\n  window.__paperRipplePeak = Math.max(window.__paperRipplePeak ?? 0, shape.ripple)\n  window.__paperContact = {quiet:modes.quiet,edgeA,edgeB}\n'+marker)
    if(flat)code=replaceSource(code,'paperPoint(x,y,shape)','({x,y,z:0})')
  }
  return code
}}
const server=await createServer({root:path.resolve(import.meta.dirname,'../../apps/lab'),plugins:[observer],cacheDir:path.join(output,'.vite'),logLevel:'warn',server:{host:'127.0.0.1',port:0}})
await server.listen()
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',defaultViewport:null,args:['--enable-features=CanvasDrawElement','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']})
const errors=[],results={flat}
try{
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(String(error)))
  await setChromeViewport(page,{width:Number(process.env.PAPER_VIEWPORT_WIDTH??1200),height:900})
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}])
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=home`,{waitUntil:'load'})
  await page.waitForSelector('.home-hero-holder [data-api-live] input')
  assert.equal(await page.$('iframe.site-frame'),null,'Paper must run in the inline site')
  await page.waitForFunction(()=>document.querySelector('.home-page')?.dataset.homeReady==='true'&&!document.documentElement.hasAttribute('data-opening'))
  await page.evaluate(()=>document.fonts.ready)
  await installPaperReader(page)
  await page.waitForFunction(()=>window.__paperLight?.uniforms.uPaperReady.value===1)
  await page.evaluate(()=>{
    const holder=document.querySelector('.home-hero-holder')
    document.querySelector('.home-page').scrollTop+=holder.getBoundingClientRect().top-220
    window.__originalPaperInput=holder.querySelector('[data-api-live] input')
  })
  await page.screenshot({path:path.join(output,'native.png')})
  const client=await page.createCDPSession(),frames=[],acks=new Set()
  let recording=record
  const onFrame=event=>{
    if(recording)frames.push({data:event.data,time:event.metadata.timestamp})
    const ack=client.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(error=>{if(recording)errors.push(String(error))}).finally(()=>acks.delete(ack))
    acks.add(ack)
  }
  if(record){client.on('Page.screencastFrame',onFrame);await client.send('Page.startScreencast',{format:'png',everyNthFrame:1})}
  await page.click('.home-hero-row button')
  await page.waitForFunction(()=>window.__readPaper()?.kind==='scene'&&window.__readPaper().paper.height>18&&window.__readPaper().paper.height<48)
  await page.screenshot({path:path.join(output,'peel.png')})
  await page.waitForFunction(()=>window.__readPaper()?.kind==='scene'&&window.__readPaper().paper.height===52)
  if(!record)results.performance=await measureLightingDraw(page)
  results.geometry=await paperMetrics(page)
  results.silhouette=await silhouetteMetrics(page)
  await page.screenshot({path:path.join(output,'floating.png')})
  const overlapClip=await page.$eval('.home-hero-holder',element=>{
    const r=element.getBoundingClientRect(),x=Math.max(0,r.x-20),y=Math.max(0,r.y-100)
    return {x,y,width:Math.min(innerWidth-x,r.width+40),height:Math.min(innerHeight-y,r.bottom+12-y)}
  })
  await page.screenshot({path:path.join(output,'heading-overlap.png'),clip:overlapClip,captureBeyondViewport:false})
  assert.equal(results.geometry.mapsReady,1)
  if(flat){
    assert.ok(results.geometry.maxBend<.1);assert.ok(results.silhouette.nonQuadArea<100)
    assert.ok(results.silhouette.headingOverlapArea>50,'The foreground check must actually overlap heading ink')
    assert.ok(results.silhouette.headingHoleArea<1,'Heading ink must not punch holes through the foreground postcard')
  }
  else{assert.ok(results.geometry.maxBend>25,'The paper must visibly bend beyond a rigid plane');assert.ok(results.silhouette.nonQuadArea>100,'The rendered outline must depart from a transformed quad');assert.ok(results.geometry.backArea>100,'The rolled corner must reveal its reverse side');assert.ok(results.silhouette.backStockArea/results.silhouette.opaqueArea>.003,'The visible reverse must show unprinted stock')}
  const corner=await page.evaluate(()=>window.__paperPoint(window.__readPaper().paper,.98,.02))
  await page.mouse.move(corner.x,corner.y,{steps:12})
  await page.waitForFunction(()=>window.__paperContact.quiet<.1&&window.__paperContact.edgeA>.45&&window.__paperShape.curlA>2.45)
  await page.screenshot({path:path.join(output,'curl.png')})
  results.curled=await paperMetrics(page)
  const input=await controlPoint(page,'input')
  await page.mouse.click(input.x,input.y)
  await page.waitForFunction(()=>document.activeElement===window.__originalPaperInput)
  await page.keyboard.type('Paper still works')
  await page.mouse.move(1100,800)
  await page.waitForFunction(()=>window.__paperShape.curlA<.5&&window.__paperShape.curlB<.5)
  await page.screenshot({path:path.join(output,'typing.png')})
  const stamp=await controlPoint(page,'button')
  // Observe the short pulse in the frame callback, even if CDP resumes after its peak.
  await page.evaluate(()=>{window.__paperRipplePeak=0})
  await page.mouse.click(stamp.x,stamp.y)
  await page.waitForFunction(()=>document.querySelectorAll('[data-api-live] .home-postmark').length===1)
  await page.waitForFunction(()=>window.__paperRipplePeak>.2)
  results.stampRipple=await page.evaluate(()=>window.__paperRipplePeak)
  await page.screenshot({path:path.join(output,'stamp.png')})
  await page.click('.home-hero-row button')
  await page.waitForFunction(()=>document.querySelector('.home-hero-row .home-postcard-status').dataset.gl==='false')
  await page.screenshot({path:path.join(output,'landed.png')})
  assert.equal(await page.evaluate(()=>document.querySelector('.home-hero-holder [data-api-live] input')===window.__originalPaperInput&&window.__originalPaperInput.value==='Paper still works'),true)
  if(record){
    await client.send('Page.stopScreencast');recording=false;await Promise.all([...acks]);client.off('Page.screencastFrame',onFrame)
    const lines=['ffconcat version 1.0']
    for(let i=0;i<frames.length;i++){
      const name=`frame-${String(i).padStart(4,'0')}.png`
      await writeFile(path.join(output,name),Buffer.from(frames[i].data,'base64'))
      lines.push(`file '${name}'`,'option framerate 1000',`duration ${Math.max(1/240,(frames[i+1]?.time??frames[i].time+1/60)-frames[i].time)}`)
    }
    await writeFile(path.join(output,'frames.ffconcat'),lines.join('\n'))
    const movie=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',path.join(output,'frames.ffconcat'),'-vf','fps=60,scale=1200:-2','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',path.join(output,'postcard.mp4')],{encoding:'utf8'})
    if(movie.status!==0)throw new Error(`Video encoding failed: ${movie.stderr}`)
    results.frames=frames.length
  }
  await client.detach()
  results.errors=errors
  assert.deepEqual(errors,[])
  await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
  console.log(JSON.stringify(results))
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({results,errors,error:String(error)},null,2));throw error}
finally{await browser.close();await server.close()}
