// Pixel proof and real landing-page captures for the depth-aware light demo.
import assert from 'node:assert/strict'
import {replaceSource} from './replaceSource.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
import {setChromeViewport} from '../chromeViewport.mjs'
import {observeLightingDraw,measureLightingDraw} from './gpu.mjs'
import {observeShadowCapture,measureExampleShadows} from './exampleShadows.mjs'

const output=process.env.LIGHT_PROOF_OUTPUT??path.join(tmpdir(),'munari-home-light')
await mkdir(output,{recursive:true})
const root=path.resolve(import.meta.dirname,'../..')
const fixture=await createServer({configFile:false,root:import.meta.dirname,cacheDir:path.join(output,'.vite-fixture'),server:{host:'127.0.0.1',port:0,fs:{allow:[root]}},logLevel:'warn'})
const observer={name:'observe-home-light',enforce:'pre',transform(code,id){
  code=observeLightingDraw(code,id)
  code=observeShadowCapture(code,id)
  if(!id.endsWith('/homeLight.ts'))return code
  const marker='  material.uniforms.uLightHeight.value = lightHeight'
  assert.ok(code.includes(marker))
  return replaceSource(code,marker,'  window.__homeLightMaterial = material\n'+marker)
}}
const lab=await createServer({root:path.join(root,'apps/lab'),configFile:path.join(root,'apps/lab/vite.config.ts'),plugins:[observer],cacheDir:path.join(output,'.vite-lab'),server:{host:'127.0.0.1',port:0},logLevel:'warn'})
await fixture.listen();await lab.listen()
const executablePath=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].filter(Boolean).find(existsSync)
assert.ok(executablePath,'Set CHROME_PATH to a Chrome executable')
const launch=flags=>puppeteer.launch({executablePath,headless:process.env.HEADED!=='1',defaultViewport:null,args:[...flags,'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']})
let browser
const errors=[],results={}
try {
  browser=await launch(['--enable-features=CanvasDrawElement'])
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(String(error)))
  await setChromeViewport(page,{width:1200,height:900})
  await page.goto(`http://127.0.0.1:${fixture.httpServer.address().port}`,{waitUntil:'load'})
  await page.waitForFunction(()=>window.__homeShadowProof)
  results.geometry=await page.evaluate(()=>window.__homeShadowProof)
  console.log(JSON.stringify(results.geometry))
  const g=results.geometry
  assert.equal(g.error,0)
  assert.ok(g.gap[0]>220&&g.projected[0]<150,'An elevated thin stem must leave light between its outline and its projected shadow')
  assert.deepEqual(g.single,g.duplicate,'One light must not darken a shadow twice')
  assert.ok(Math.min(...g.single)<150,'The overlap comparison must include a cast shadow')
  assert.ok(g.raised[30]-g.page[30]>30,'The raised receiver must shorten the cast shadow')
  assert.ok(g.soft.some((value,i)=>value<g.hard[i]-10),'The area emitter must produce a penumbra')
  const partial=profile=>profile.slice(profile.findLastIndex(value=>value<=25)).filter(value=>value>25&&value<230).length
  results.penumbra={close:partial(g.closeSoft),far:partial(g.farSoft),pointLight:partial(g.farHard)}
  assert.ok(results.penumbra.close>=1&&results.penumbra.far>results.penumbra.close*2,'Increasing the sheet-to-page gap must visibly broaden the penumbra')
  assert.ok(results.penumbra.pointLight<=1,'A point light must keep a sharp edge even at the larger gap')
  results.defaultSoftness={near:partial(g.nearLamp),distant:partial(g.distantLamp),parallelNear:partial(g.parallelNear),parallelDistant:partial(g.parallelDistant)}
  assert.ok(results.defaultSoftness.distant>=12&&results.defaultSoftness.distant>results.defaultSoftness.near*2,'Default lighting must visibly soften long shadows when the bulb moves across the page')
  assert.ok(Math.abs(results.defaultSoftness.parallelNear-results.defaultSoftness.parallelDistant)<=1,'The parallel-emitter control must reproduce the missing progression')
  assert.ok(results.defaultSoftness.distant>results.defaultSoftness.parallelDistant*2,'Round-bulb projection must add visible softness beyond the old parallel-emitter control')
  // The 22px-gap ramp is broad. The old cone trace jumped
  // half the intensity in one pixel even though its width check passed (#50).
  assert.ok(g.farSoft.every((value,i)=>i===0||value>=g.farSoft[i-1]),'A straight shadow edge must soften without bands')
  assert.ok(Math.max(...g.farSoft.slice(1).map((value,i)=>value-g.farSoft[i]))<64,'A broad penumbra must not contain a quarter-intensity single-pixel jump')
  assert.deepEqual(g.selectedOnCard,g.highCard,'Selected heading shadows must stay behind the foreground postcard')
  assert.deepEqual(g.selectedGap,g.highCardGap,'Heading selection must not alter the foreground postcard lighting')
  assert.ok(g.ordinaryOnPage[0]-g.selectedOnPage[0]>30,'The heading must still cast its raised shadow onto the page')
  assert.deepEqual(g.coveredPaper,g.plainPaper,'Covered heading ink must not replace the foreground paper as the lighting receiver')
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
  await page.goto(`http://127.0.0.1:${lab.httpServer.address().port}/?scene=home&framed`,{waitUntil:'load'})
  await page.evaluate(()=>document.fonts.ready)
  await page.evaluate(async()=>{const a=await import('/src/scenes/home/homeFlyer.ts'),b=await import('/src/scenes/home/homePaperFrame.ts');window.__readPaper=a.readHomeFlyer;window.__paperPoint=b.paperFramePoint})
  await page.waitForSelector('[data-lit] .home-hero-holder')
  // A real redraw after worker completion, not a screenshot of initial fallback.
  await page.waitForFunction(()=>window.__homeLightMaterial?.uniforms.uInkReady.value===1&&window.__homeLightMaterial.uniforms.uReliefReady.value===1)
  await page.waitForFunction(()=>window.__homeLightMaterial.uniforms.uLightHeight.value===260)
  await page.hover('.home-hero-row button')
  assert.equal(await page.$eval('.home-hero-row button',button=>getComputedStyle(button).boxShadow),'none','Hover must not add a static CSS shadow over the light shader')
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}])
  results.performance=await measureLightingDraw(page)
  console.log(JSON.stringify({performance:results.performance}))
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
  await page.screenshot({path:path.join(output,'desktop.png')})
  await page.click('.home-select-word')
  await page.waitForFunction(()=>window.__homeLightMaterial.uniforms.uSelectionLift.value>35)
  results.selection=await page.evaluate(()=>{
    const line=document.querySelector('.home-masthead-em').getBoundingClientRect()
    const u=window.__homeLightMaterial.uniforms
    return {text:getSelection().toString(),count:u.uSelectionCount.value,top:u.uSelection.value[0].y+u.uFrameOrigin.value.y,lineTop:line.top}
  })
  assert.equal(results.selection.text,'Unified.')
  assert.ok(results.selection.top>=results.selection.lineTop-.5,'Selecting a line must not raise the preceding line')
  await page.screenshot({path:path.join(output,'selected.png')})
  await page.click('.home-hero-row button')
  await page.waitForFunction(()=>document.querySelector('.home-hero-row .home-postcard-status').dataset.gl==='true')
  await page.screenshot({path:path.join(output,'selected-scene.png')})
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}])
  await page.waitForFunction(()=>window.__readPaper()?.kind==='scene'&&window.__readPaper().paper.height===52)
  await page.screenshot({path:path.join(output,'selected-flying.png')})
  await page.evaluate(()=>{
    window.__headlinePointer=[]
    document.addEventListener('pointerdown',event=>window.__headlinePointer.push(Boolean(event.target.closest?.('.home-masthead-title'))),{capture:true})
  })
  await page.click('.home-headline-html',{count:2})
  results.nativeSelection=await page.evaluate(()=>({text:getSelection().toString(),targets:window.__headlinePointer}))
  // Native word selection excludes the following punctuation.
  assert.ok(results.nativeSelection.text==='html')
  assert.ok(results.nativeSelection.targets.some(Boolean),'Uncovered heading text must retain native pointer input')
  const selectedLight=await page.$('.home-light'),selectedLightBox=await selectedLight.boundingBox()
  const lightStart={x:selectedLightBox.x+selectedLightBox.width/2,y:selectedLightBox.y+selectedLightBox.height/2}
  await page.mouse.move(lightStart.x,lightStart.y);await page.mouse.down()
  await page.mouse.move(lightStart.x+36,lightStart.y+8,{steps:8});await page.mouse.up()
  assert.equal(await page.evaluate(()=>getSelection().toString()),results.nativeSelection.text,'Moving the light must preserve the selected words')
  assert.equal(await page.evaluate(()=>document.body.style.userSelect),'','Releasing the light must restore text selection')
  const fieldPoint=await page.evaluate(()=>{
    const input=document.querySelector('.home-hero-holder [data-api-live] input')
    const source=input.closest('.home-postcard').getBoundingClientRect(),box=input.getBoundingClientRect()
    const u=(box.x+box.width/2-source.x)/source.width,v=(box.y+box.height/2-source.y)/source.height
    window.__typingInput=input
    return window.__paperPoint(window.__readPaper().paper,u,v)
  })
  await page.mouse.click(fieldPoint.x,fieldPoint.y)
  await page.waitForFunction(()=>document.activeElement===window.__typingInput)
  await page.keyboard.type('Still live')
  await page.mouse.move(1150,800)
  await page.waitForFunction(()=>{
    const vertices=window.__readPaper().paper.vertices,previous=window.__lastPaperVertices
    let change=0
    if(previous)for(let i=0;i<vertices.length;i++)change=Math.max(change,Math.abs(vertices[i]-previous[i]))
    window.__lastPaperVertices=vertices.slice()
    window.__steadyPaperFrames=previous&&change<.02 ? (window.__steadyPaperFrames??0)+1 : 0
    return window.__steadyPaperFrames>20
  })
  assert.equal(await page.evaluate(()=>window.__typingInput.value),'Still live')
  await page.screenshot({path:path.join(output,'typing-scene.png')})
  await page.click('.home-hero-row button')
  await page.waitForFunction(()=>document.querySelector('.home-hero-row .home-postcard-status').dataset.gl==='false')
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
  await page.click('.home-masthead-copy')
  await page.waitForFunction(()=>window.__homeLightMaterial.uniforms.uSelectionCount.value===0)
  const light=await page.$('.home-light'),box=await light.boundingBox()
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2)
  await page.mouse.down();await page.mouse.move(780,400,{steps:16});await page.mouse.up()
  const released=await light.boundingBox()
  assert.ok(Math.abs(released.x+released.width/2-780)<1,'Releasing the light must retain its position')
  await page.screenshot({path:path.join(output,'moved.png')})
  await light.focus();await page.keyboard.press('ArrowLeft')
  const keyed=await light.boundingBox()
  assert.ok(Math.abs(keyed.x-released.x+16)<1,'ArrowLeft must move the light 16 CSS pixels')
  results.galleryShadows=await measureExampleShadows(page,output)
  await page.focus('[aria-label="Distance from the page"]')
  await page.keyboard.press('Home')
  await page.waitForFunction(()=>window.__homeLightMaterial.uniforms.uLightHeight.value===220)
  await page.screenshot({path:path.join(output,'low.png')})
  await setChromeViewport(page,{width:390,height:844})
  await page.waitForFunction(()=>window.__homeLightMaterial.uniforms.uInkRect.value.z<500&&window.__homeLightMaterial.uniforms.uReliefRect.value.z<500)
  await page.screenshot({path:path.join(output,'mobile.png')})
  results.page={dpr:await page.evaluate(()=>devicePixelRatio),overflow:await page.evaluate(()=>document.querySelector('.home-page').scrollWidth>innerWidth),errors}
  assert.equal(results.page.overflow,false)
  assert.deepEqual(errors,[])

  await setChromeViewport(page,{width:1440,height:1000})
  await page.goto(`http://127.0.0.1:${lab.httpServer.address().port}/?scene=home`,{waitUntil:'load'})
  const overview=await page.waitForFrame(frame=>frame.url().includes('&framed'))
  await overview.waitForFunction(()=>window.__homeLightMaterial?.uniforms.uInkReady.value===1&&window.__homeLightMaterial.uniforms.uReliefReady.value===1)
  await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-opening'))
  await page.screenshot({path:path.join(output,'website.png')})
  for(const width of [390,320]) {
    await setChromeViewport(page,{width,height:844})
    await overview.waitForFunction(()=>window.__homeLightMaterial?.uniforms.uResolution.value.x===innerWidth&&window.__homeLightMaterial.uniforms.uInkRect.value.z<innerWidth+100&&window.__homeLightMaterial.uniforms.uReliefReady.value===1)
    assert.equal(await overview.evaluate(()=>document.querySelector('.home-page').scrollWidth>innerWidth),false)
    await page.screenshot({path:path.join(output,`website-${width}.png`)})
    await overview.evaluate(()=>{window.__resizedInput=document.querySelector('.home-hero-holder [data-api-live] input')})
    await overview.click('.home-hero-row button')
    await overview.waitForFunction(()=>document.querySelector('.home-hero-row .home-postcard-status').dataset.gl==='true')
    await page.screenshot({path:path.join(output,`website-${width}-scene.png`)})
    await overview.click('.home-hero-row button')
    await overview.waitForFunction(()=>document.querySelector('.home-hero-row .home-postcard-status').dataset.gl==='false')
    assert.equal(await overview.evaluate(()=>document.querySelector('.home-hero-holder [data-api-live] input')===window.__resizedInput),true)
  }
  assert.deepEqual(errors,[])
  await browser.close();browser=null

  results.fallbacks={}
  for(const [name,flags] of [['native',[]],['no-webgl',['--disable-webgl']]]) {
    browser=await launch(flags)
    const fallback=await browser.newPage(),faults=[]
    fallback.on('pageerror',error=>faults.push(String(error)))
    await setChromeViewport(fallback,{width:1200,height:900})
    await fallback.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
    await fallback.goto(`http://127.0.0.1:${lab.httpServer.address().port}/?scene=home&framed`,{waitUntil:'load'})
    await fallback.waitForSelector('.home-masthead-title',{visible:true})
    if(name==='native') {
      await fallback.waitForFunction(()=>window.__homeLightMaterial?.uniforms.uInkReady.value===1&&window.__homeLightMaterial.uniforms.uReliefReady.value===1)
      await fallback.focus('[aria-label="Distance from the page"]');await fallback.keyboard.press('End')
      await fallback.waitForFunction(()=>window.__homeLightMaterial.uniforms.uLightHeight.value===600)
    }else {
      await fallback.waitForSelector('.home-light[data-degraded]')
      assert.equal(await fallback.$('[aria-label="Distance from the page"]'),null,'Unavailable lighting must not leave an ineffective control')
      await fallback.hover('.home-hero-row button')
      assert.notEqual(await fallback.$eval('.home-hero-row button',button=>getComputedStyle(button).boxShadow),'none','The native shadow must remain when WebGL is unavailable')
    }
    results.fallbacks[name]=await fallback.evaluate(()=>({captureAvailable:'drawElementImage' in CanvasRenderingContext2D.prototype,lightVisible:!!document.querySelector('.home-light')?.getClientRects().length,overflow:document.querySelector('.home-page').scrollWidth>innerWidth}))
    assert.equal(results.fallbacks[name].overflow,false)
    assert.equal(results.fallbacks[name].lightVisible,name==='native')
    assert.deepEqual(faults,[])
    await fallback.screenshot({path:path.join(output,`${name}.png`)})
    await browser.close();browser=null
  }
  await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
}catch(error){
  await writeFile(path.join(output,'failure.json'),JSON.stringify({results,errors,error:String(error)},null,2))
  throw error
}finally{await browser?.close();await fixture.close();await lab.close()}
