// Pixel proof for the lighting shader, then the real Light and Postcard pages.
// Light: selection lift, native selection, light drag and keys, light distance.
// Postcard: hover shadow, a typed scene round trip, and narrow-width resizes.
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

const output=process.env.LIGHT_PROOF_OUTPUT??path.join(tmpdir(),'munari-light')
await mkdir(output,{recursive:true})
const root=path.resolve(import.meta.dirname,'../..')
const fixture=await createServer({configFile:false,root:import.meta.dirname,cacheDir:path.join(output,'.vite-fixture'),server:{host:'127.0.0.1',port:0,fs:{allow:[root]}},logLevel:'warn'})
const observer={name:'observe-light',enforce:'pre',transform(code,id){
  code=observeLightingDraw(code,id)
  if(!id.endsWith('/lightShadowMaterial.ts'))return code
  const marker='  material.uniforms.uLightHeight.value = lightHeight'
  return replaceSource(code,marker,'  window.__lightMaterial = material\n'+marker)
}}
const lab=await createServer({root:path.join(root,'apps/lab'),configFile:path.join(root,'apps/lab/vite.config.ts'),plugins:[observer],cacheDir:path.join(output,'.vite-lab'),server:{host:'127.0.0.1',port:0},logLevel:'warn'})
await fixture.listen();await lab.listen()
const labUrl=scene=>`http://127.0.0.1:${lab.httpServer.address().port}/?scene=${scene}&framed`
const executablePath=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].filter(Boolean).find(existsSync)
assert.ok(executablePath,'Set CHROME_PATH to a Chrome executable')
const launch=flags=>puppeteer.launch({executablePath,headless:process.env.HEADED!=='1',defaultViewport:null,args:[...flags,'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']})
const pageReady=page=>page.waitForFunction(()=>document.querySelector('.light-page')?.dataset.pageReady==='true')
let browser
const errors=[],results={}
try {
  browser=await launch(['--enable-features=CanvasDrawElement'])
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(String(error)))
  await setChromeViewport(page,{width:1200,height:900})
  await page.goto(`http://127.0.0.1:${fixture.httpServer.address().port}`,{waitUntil:'load'})
  await page.waitForFunction(()=>window.__lightShadowProof)
  results.geometry=await page.evaluate(()=>window.__lightShadowProof)
  console.log(JSON.stringify(results.geometry))
  const g=results.geometry
  assert.equal(g.error,0)
  for(const [name,sample] of Object.entries(g))if(Array.isArray(sample))assert.ok(sample.length>0&&sample.every(Number.isFinite),`${name}: the fixture must return measured pixels`)
  assert.ok(g.gap[0]>220&&g.projected[0]<150,'An elevated thin stem must leave light between its outline and its projected shadow')
  assert.deepEqual(g.single,g.duplicate,'One light must not darken a shadow twice')
  assert.ok(Math.min(...g.single)<150,'The overlap comparison must include a cast shadow')
  assert.ok(g.raised[30]-g.page[30]>30,'The raised receiver must shorten the cast shadow')
  assert.ok(g.soft.some((value,i)=>value<g.hard[i]-10),'The area emitter must produce a penumbra')
  const partial=profile=>{
    assert.ok(profile.some(value=>value<=25)&&profile.some(value=>value>=230),'A penumbra profile must contain both the dark and lit side')
    return profile.slice(profile.findLastIndex(value=>value<=25)).filter(value=>value>25&&value<230).length
  }
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
  assert.ok(g.ordinaryOnPage[0]-g.selectedOnPage[0]>30,'Raised selected heading ink must cast a longer shadow onto the page')

  // ── Light ─────
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
  await page.goto(labUrl('light'),{waitUntil:'load'})
  assert.equal(await page.evaluate(()=>'drawElementImage' in CanvasRenderingContext2D.prototype),true,'HTML-in-canvas is required')
  await page.evaluate(()=>document.fonts.ready)
  // A real redraw after the mask and lamp backdrop complete, not the initial fallback.
  await pageReady(page)
  await page.waitForFunction(()=>window.__lightMaterial?.uniforms.uInkReady.value===1&&window.__lightMaterial.uniforms.uLightHeight.value===260)
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}])
  results.performance=await measureLightingDraw(page)
  console.log(JSON.stringify({performance:results.performance}))
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
  await page.screenshot({path:path.join(output,'light.png')})
  await page.click('.light-select-word')
  await page.waitForFunction(()=>window.__lightMaterial.uniforms.uSelectionLift.value>35)
  results.selection=await page.evaluate(()=>{
    const line=document.querySelector('.light-masthead-em').getBoundingClientRect()
    const u=window.__lightMaterial.uniforms
    return {text:getSelection().toString(),count:u.uSelectionCount.value,top:u.uSelection.value[0].y+u.uFrameOrigin.value.y,lineTop:line.top}
  })
  assert.equal(results.selection.text,'Unified.')
  assert.ok(results.selection.top>=results.selection.lineTop-.5,'Selecting a line must not raise the preceding line')
  await page.screenshot({path:path.join(output,'selected.png')})
  await page.evaluate(()=>{
    window.__headlinePointer=[]
    document.addEventListener('pointerdown',event=>window.__headlinePointer.push(Boolean(event.target.closest?.('.light-masthead-title'))),{capture:true})
  })
  await page.click('.light-headline-html',{count:2})
  results.nativeSelection=await page.evaluate(()=>({text:getSelection().toString(),targets:window.__headlinePointer}))
  // Native word selection excludes the following punctuation.
  assert.equal(results.nativeSelection.text,'html')
  assert.ok(results.nativeSelection.targets.some(Boolean),'Heading text must receive native pointer input through the lighting layers')
  const selectedLight=await page.$('.light-handle'),selectedLightBox=await selectedLight.boundingBox()
  const lightStart={x:selectedLightBox.x+selectedLightBox.width/2,y:selectedLightBox.y+selectedLightBox.height/2}
  await page.mouse.move(lightStart.x,lightStart.y);await page.mouse.down()
  await page.mouse.move(lightStart.x+36,lightStart.y+8,{steps:8});await page.mouse.up()
  assert.equal(await page.evaluate(()=>getSelection().toString()),results.nativeSelection.text,'Moving the light must preserve the selected words')
  assert.equal(await page.evaluate(()=>document.body.style.userSelect),'','Releasing the light must restore text selection')
  await page.click('.light-masthead-copy')
  await page.waitForFunction(()=>window.__lightMaterial.uniforms.uSelectionCount.value===0)
  const light=await page.$('.light-handle'),box=await light.boundingBox()
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2)
  await page.mouse.down();await page.mouse.move(780,400,{steps:16});await page.mouse.up()
  const released=await light.boundingBox()
  assert.ok(Math.abs(released.x+released.width/2-780)<1,'Releasing the light must retain its position')
  await page.screenshot({path:path.join(output,'moved.png')})
  await light.focus();await page.keyboard.press('ArrowLeft')
  const keyed=await light.boundingBox()
  assert.ok(Math.abs(keyed.x-released.x+16)<1,'ArrowLeft must move the light 16 CSS pixels')
  await page.focus('[aria-label="Distance from the page"]')
  await page.keyboard.press('Home')
  await page.waitForFunction(()=>window.__lightMaterial.uniforms.uLightHeight.value===220)
  await page.screenshot({path:path.join(output,'low.png')})
  results.lightResize={}
  for(const width of [390,320]){
    await setChromeViewport(page,{width,height:844})
    await page.waitForFunction(()=>window.__lightMaterial.uniforms.uResolution.value.x===document.querySelector('.light-page').clientWidth&&window.__lightMaterial.uniforms.uInkRect.value.z<innerWidth+100)
    results.lightResize[width]={overflow:await page.evaluate(()=>document.querySelector('.light-page').scrollWidth>innerWidth)}
    assert.equal(results.lightResize[width].overflow,false)
    await page.screenshot({path:path.join(output,`light-${width}.png`)})
  }
  assert.deepEqual(errors,[])

  // ── Postcard ─────
  await setChromeViewport(page,{width:1200,height:900})
  await page.goto(labUrl('postcard'),{waitUntil:'load'})
  await page.evaluate(()=>document.fonts.ready)
  await page.waitForSelector('[data-lit] .postcard-hero-holder')
  await pageReady(page)
  await page.evaluate(async()=>{if(!window.__readPaper)throw new Error('Missing postcard observer');const b=await import('/src/scenes/light/lightPaperFrame.ts');window.__paperPoint=b.paperFramePoint})
  await page.waitForFunction(()=>window.__lightMaterial?.uniforms.uReliefReady.value===1&&window.__lightMaterial.uniforms.uLightHeight.value===260)
  await page.hover('.postcard-hero-row button')
  assert.equal(await page.$eval('.postcard-hero-row button',button=>getComputedStyle(button).boxShadow),'none','Hover must not add a static CSS shadow over the light shader')
  await page.screenshot({path:path.join(output,'postcard.png')})
  const liftAndReturn=async label=>{
    await page.click('.postcard-hero-row button')
    await page.waitForFunction(()=>document.querySelector('.postcard-hero-row .postcard-status').dataset.gl==='true')
    await page.screenshot({path:path.join(output,`${label}-scene.png`)})
    await page.click('.postcard-hero-row button')
    await page.waitForFunction(()=>document.querySelector('.postcard-hero-row .postcard-status').dataset.gl==='false')
  }
  await page.evaluate(()=>{window.__typingInput=document.querySelector('.postcard-hero-holder [data-api-live] input')})
  await page.click('.postcard-hero-row button')
  await page.waitForFunction(()=>document.querySelector('.postcard-hero-row .postcard-status').dataset.gl==='true')
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}])
  await page.waitForFunction(()=>window.__readPaper()?.kind==='scene'&&window.__readPaper().paper.height===52)
  await page.screenshot({path:path.join(output,'postcard-flying.png')})
  const fieldPoint=await page.evaluate(()=>{
    const input=window.__typingInput
    const source=input.closest('.postcard-card').getBoundingClientRect(),box=input.getBoundingClientRect()
    const u=(box.x+box.width/2-source.x)/source.width,v=(box.y+box.height/2-source.y)/source.height
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
  await page.click('.postcard-hero-row button')
  await page.waitForFunction(()=>document.querySelector('.postcard-hero-row .postcard-status').dataset.gl==='false')
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
  const sameInput=()=>page.evaluate(()=>document.querySelector('.postcard-hero-holder [data-api-live] input')===window.__typingInput&&window.__typingInput.value==='Still live')
  assert.equal(await sameInput(),true,'The returned postcard must keep the typed input element')
  results.postcardResize={}
  for(const width of [390,320]){
    await setChromeViewport(page,{width,height:844})
    await page.waitForFunction(()=>window.__lightMaterial.uniforms.uResolution.value.x===document.querySelector('.light-page').clientWidth&&window.__lightMaterial.uniforms.uReliefReady.value===1)
    results.postcardResize[width]={overflow:await page.evaluate(()=>document.querySelector('.light-page').scrollWidth>innerWidth)}
    assert.equal(results.postcardResize[width].overflow,false)
    await page.screenshot({path:path.join(output,`postcard-${width}.png`)})
    await liftAndReturn(`postcard-${width}`)
    assert.equal(await sameInput(),true,`The postcard must keep its input element through a round trip at ${width}px`)
  }
  results.page={dpr:await page.evaluate(()=>devicePixelRatio),errors}
  assert.deepEqual(errors,[])
  await browser.close();browser=null

  results.fallbacks={}
  for(const [name,flags] of [['native',[]],['no-webgl',['--disable-webgl']]]) {
    browser=await launch(flags)
    const fallback=await browser.newPage(),faults=[]
    fallback.on('pageerror',error=>faults.push(String(error)))
    await setChromeViewport(fallback,{width:1200,height:900})
    await fallback.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
    await fallback.goto(labUrl('light'),{waitUntil:'load'})
    await fallback.waitForSelector('.light-masthead-title',{visible:true})
    if(name==='native') {
      await fallback.waitForFunction(()=>window.__lightMaterial?.uniforms.uInkReady.value===1)
      await fallback.focus('[aria-label="Distance from the page"]');await fallback.keyboard.press('End')
      await fallback.waitForFunction(()=>window.__lightMaterial.uniforms.uLightHeight.value===600)
    }else {
      await fallback.waitForSelector('.light-handle[data-degraded]')
      assert.equal(await fallback.$('[aria-label="Distance from the page"]'),null,'Unavailable lighting must not leave an ineffective control')
    }
    results.fallbacks[name]=await fallback.evaluate(()=>({captureAvailable:'drawElementImage' in CanvasRenderingContext2D.prototype,lightVisible:!!document.querySelector('.light-handle')?.getClientRects().length,overflow:document.querySelector('.light-page').scrollWidth>innerWidth}))
    await fallback.screenshot({path:path.join(output,`${name}.png`)})
    if(name==='no-webgl'){
      await fallback.goto(labUrl('postcard'),{waitUntil:'load'})
      await fallback.waitForSelector('.light-handle[data-degraded]')
      await fallback.hover('.postcard-hero-row button')
      results.fallbacks[name].postcardShadow=await fallback.$eval('.postcard-hero-row button',button=>getComputedStyle(button).boxShadow)
      assert.notEqual(results.fallbacks[name].postcardShadow,'none','The native shadow must remain when WebGL is unavailable')
      await fallback.screenshot({path:path.join(output,`${name}-postcard.png`)})
    }
    assert.equal(results.fallbacks[name].captureAvailable,false,'The fallback profile must actually disable HTML capture')
    assert.equal(results.fallbacks[name].overflow,false)
    assert.equal(results.fallbacks[name].lightVisible,name==='native')
    assert.deepEqual(faults,[])
    await browser.close();browser=null
  }
  await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
}catch(error){
  await writeFile(path.join(output,'failure.json'),JSON.stringify({results,errors,error:String(error)},null,2))
  throw error
}finally{await browser?.close();await fixture.close();await lab.close()}
