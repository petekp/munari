// Verify the actual headline: native text, solid geometry, shader pixels and zoom.
// Observation and the flat-black colour control affect the served copy only.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
import {replaceSource} from '../home-light/replaceSource.mjs'
import {setChromeViewport} from '../chromeViewport.mjs'
import {textureClarity} from '../textureClarity.mjs'

const output=process.env.HEADLINE_OUTPUT??path.join(tmpdir(),'munari-headline')
await mkdir(output,{recursive:true})
const observer={name:'headline-observer',enforce:'pre',transform(code,id){
  if(id.endsWith('/homeHeadlineTreatments.ts')){
    code=replaceSource(code,'  const material=new THREE.ShaderMaterial','  uniforms.uTestBlack=new THREE.Uniform(0)\n  const material=new THREE.ShaderMaterial')
    const marker='  return {\n    render(reduced:boolean)'
    code=replaceSource(code,marker,'  window.__headline={renderer,letters,uniforms,inkCanvas,redraw:wake}\n'+marker)
  }
  if(id.endsWith('/homeHeadlineShaders.ts')){
    code=replaceSource(code,'uniform vec2 uPointer;','uniform vec2 uPointer;\nuniform float uTestBlack;')
    code=replaceSource(code,'gl_FragColor=vec4(colour,alpha);','gl_FragColor=vec4(colour*(1.0-uTestBlack),alpha);')
  }
  return code
}}
const server=await createServer({root:path.resolve(import.meta.dirname,'../../apps/lab'),plugins:[observer],cacheDir:path.join(output,'.vite'),logLevel:'warn',server:{host:'127.0.0.1',port:0}})
await server.listen()
let browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',defaultViewport:null,signal:AbortSignal.timeout(30_000),args:['--enable-features=CanvasDrawElement','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']})
const frames=(frame,count=4)=>frame.evaluate(count=>new Promise(resolve=>{const next=()=>--count?requestAnimationFrame(next):resolve();requestAnimationFrame(next)}),count)
const results={}
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)))
  await setChromeViewport(page,{width:1440,height:1000})
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=home`,{waitUntil:'load'})
  await page.waitForSelector('.home-page')
  assert.equal(await page.$('iframe.site-frame'),null,'Home must render in the site document')
  const frame=page
  await frame.waitForSelector('[data-headline-ready]');await frames(frame)
  await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-opening'))
  results.content=await frame.evaluate(()=>{
    const h=window.__headline,position=h.letters.geometry.getAttribute('position')
    let min=Infinity,max=-Infinity
    for(let i=0;i<position.count;i++){min=Math.min(min,position.getZ(i));max=Math.max(max,position.getZ(i))}
    return {html:document.querySelector('.home-headline-html').textContent,font:getComputedStyle(document.querySelector('.home-headline-html')).fontFamily,label:document.querySelector('h1').getAttribute('aria-label'),geometry:h.letters.geometry.type,depth:max-min,dpr:devicePixelRatio,rendererDpr:h.renderer.getPixelRatio()}
  })
  assert.equal(results.content.html,'<html>');assert.match(results.content.font,/Courier Prime/)
  assert.equal(results.content.label,'HTML, 3D, and Shaders, Unified.')
  assert.equal(results.content.geometry,'ExtrudeGeometry');assert.ok(results.content.depth>20)
  assert.equal(results.content.rendererDpr,results.content.dpr)
  results.layout=await frame.evaluate(()=>{
    const rect=selector=>document.querySelector('#root '+selector).getBoundingClientRect().toJSON()
    return {intro:rect('.home-masthead-intro'),card:rect('.home-hero-holder'),action:rect('.home-hero-row button'),tools:rect('.home-masthead-tools'),height:innerHeight}
  })
  assert.ok(results.layout.card.left-results.layout.intro.right>=24,'The introduction and demo need separate columns')
  assert.ok(results.layout.tools.bottom<results.layout.height,'Desktop demo controls must fit on the first screen')
  await page.screenshot({path:path.join(output,'desktop.png')})

  const parent={x:0,y:0}
  const word=await frame.$eval('.home-headline-shaders',element=>element.getBoundingClientRect().toJSON())
  const clip={x:Math.floor(parent.x+word.x-6),y:Math.floor(parent.y+word.y-6),width:Math.ceil(word.width+12),height:Math.ceil(word.height+12)}
  const shot=()=>page.screenshot({clip,encoding:'base64'})
  const coloured=await shot()
  await frame.evaluate(()=>{window.__headline.uniforms.uTestBlack.value=1;window.__headline.redraw()});await frames(frame)
  const black=await shot()
  await frame.evaluate(()=>{document.querySelector('.home-headline-canvas').style.visibility='hidden';document.querySelector('.home-headline-shaders').style.color='#000'})
  const native=await shot()
  results.pixels=await page.evaluate(async({coloured,black,native})=>{
    const decode=async data=>{const image=await createImageBitmap(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();return ctx.getImageData(0,0,canvas.width,canvas.height).data}
    const a=await decode(coloured),b=await decode(black),c=await decode(native)
    let colour=0,nativeError=0
    for(let i=0;i<a.length;i+=4)for(let channel=0;channel<3;channel++){colour+=Math.abs(a[i+channel]-b[i+channel]);nativeError+=Math.abs(b[i+channel]-c[i+channel])}
    return {colourDifference:colour/(a.length/4*3),nativeError:nativeError/(a.length/4*3)}
  },{coloured,black,native})
  for(const [name,data]of [['shader',coloured],['black-control',black],['native',native]])await writeFile(path.join(output,name+'.png'),Buffer.from(data,'base64'))
  assert.ok(results.pixels.colourDifference>5,'The shader must visibly change the native ink')
  results.sharpness=await textureClarity(page,native,black)
  await frame.evaluate(()=>{document.querySelector('.home-headline-canvas').style.visibility='';document.querySelector('.home-headline-shaders').style.color='';window.__headline.renderer.setPixelRatio(devicePixelRatio/2);window.__headline.redraw()});await frames(frame)
  const coarse=await shot()
  results.coarse=await textureClarity(page,native,coarse)
  await writeFile(path.join(output,'coarse-control.png'),Buffer.from(coarse,'base64'))
  await frame.evaluate(()=>{window.__headline.renderer.setPixelRatio(devicePixelRatio);window.__headline.redraw()})
  console.log(JSON.stringify({sharpness:results.sharpness,coarse:results.coarse}))
  assert.ok(results.sharpness.edgeEnergyRatio>=.95&&results.sharpness.edgeEnergyRatio<=1.05,'Shader glyphs must retain native text contrast')
  assert.ok(results.coarse.edgeEnergyRatio<.9,'The coarse rendering control must lose contrast')

  await frame.evaluate(()=>{document.querySelector('.home-headline-canvas').style.visibility='';document.querySelector('.home-headline-shaders').style.color='';window.__headline.uniforms.uTestBlack.value=0;window.__headline.redraw()})

  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}])
  const solid=await frame.$eval('.home-headline-3d',element=>element.getBoundingClientRect().toJSON())
  const before=await frame.evaluate(()=>window.__headline.letters.rotation.y)
  await page.mouse.move(parent.x+solid.right-3,parent.y+solid.y+solid.height/2);await frames(frame,50)
  const after=await frame.evaluate(()=>window.__headline.letters.rotation.y)
  assert.ok(Math.abs(after-before)>.05,'Hover must reveal the solid letter sides')
  await frame.click('#root .home-headline-3d',{count:2})
  assert.equal(await frame.evaluate(()=>getSelection().toString()),'3D')
  assert.equal(await frame.$eval('.home-headline-3d',element=>getComputedStyle(element,'::selection').color),'rgba(0, 0, 0, 0)','Selection must not paint a flat duplicate over the mesh')
  await page.mouse.move(parent.x+word.x+word.width*.35,parent.y+word.y+word.height*.5)
  await frames(frame)
  results.ripple=await frame.evaluate(()=>({age:window.__headline.uniforms.uRippleAge.value,point:window.__headline.uniforms.uPointer.value.toArray()}))
  assert.ok(results.ripple.age<1,'Pointer input must reach the shader ripple')
  await page.screenshot({path:path.join(output,'interactive.png')})
  await frame.click('.home-select-word')
  assert.equal(await frame.evaluate(()=>getSelection().toString()),'Unified.')
  await frame.click('.home-hero-row button')
  await frame.waitForFunction(()=>document.querySelector('.home-postcard-status').dataset.gl==='true')
  await frames(frame,100);await page.screenshot({path:path.join(output,'postcard.png')})

  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
  const client=await page.createCDPSession()
  await client.send('Input.synthesizePinchGesture',{x:parent.x+word.x+word.width*.4,y:parent.y+word.y+word.height*.5,scaleFactor:3,gestureSourceType:'touch'})
  const zoomScale=await page.evaluate(()=>visualViewport.scale)
  assert.ok(Math.abs(zoomScale-3)<.02,'Pinch zoom must keep the shader word in view')
  await frames(frame,8)
  results.zoom=await frame.evaluate(()=>{const h=window.__headline,c=h.renderer.domElement,r=c.getBoundingClientRect(),gl=h.renderer.getContext();return {ratio:h.renderer.getPixelRatio(),buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],canvas:[c.width,c.height],css:[r.width,r.height]}})
  assert.equal(results.zoom.ratio,results.content.dpr*zoomScale)
  assert.deepEqual(results.zoom.buffer,results.zoom.canvas)
  await page.screenshot({path:path.join(output,'zoom.png')})
  await client.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});await client.detach()
  await setChromeViewport(page,{width:390,height:844})
  await page.reload({waitUntil:'load'})
  const mobile=page
  await mobile.waitForSelector('[data-headline-ready]');await frames(mobile)
  await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-opening'))
  results.mobile=await mobile.evaluate(()=>({overflow:document.querySelector('.home-page').scrollWidth>document.querySelector('.home-page').clientWidth,ratio:window.__headline.renderer.getPixelRatio(),time:window.__headline.uniforms.uTime.value,ripple:window.__headline.uniforms.uRippleAge.value,actionBottom:document.querySelector('#root .home-hero-row button').getBoundingClientRect().bottom,height:innerHeight,lightTop:document.querySelector('#root .home-light').getBoundingClientRect().top}))
  assert.equal(results.mobile.overflow,false);assert.equal(results.mobile.time,0);assert.equal(results.mobile.ripple,1000)
  assert.ok(results.mobile.actionBottom<results.mobile.height,'The phone layout must expose the postcard action without scrolling')
  assert.ok(results.mobile.lightTop>=16,'The mobile lamp needs room below the navigation')
  await page.screenshot({path:path.join(output,'mobile.png')})
  await browser.close();browser=null
  results.fallbacks=[]
  for(const disabled of [false,true]){
    browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',defaultViewport:null,signal:AbortSignal.timeout(30_000),args:['--disable-features=CanvasDrawElement',...(disabled?['--disable-webgl']:[])]})
    const fallback=await browser.newPage();fallback.on('pageerror',error=>errors.push(String(error)))
    await setChromeViewport(fallback,{width:1200,height:900})
    await fallback.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=home`,{waitUntil:'load'})
    const content=fallback
    await content.waitForSelector('.home-headline-shaders');await content.evaluate(()=>document.fonts.ready)
    if(disabled)await content.waitForSelector('.home-light-host[data-degraded]')
    else await content.waitForSelector('[data-headline-ready]')
    await fallback.waitForFunction(()=>!document.documentElement.hasAttribute('data-opening'))
    const state=await content.evaluate(()=>({capture:'drawElementImage' in CanvasRenderingContext2D.prototype,enhanced:!!document.querySelector('[data-headline-ready]'),colour:getComputedStyle(document.querySelector('.home-headline-shaders')).color,text:document.querySelector('h1').textContent}))
    assert.equal(state.capture,false);assert.equal(state.enhanced,!disabled);assert.match(state.text,/<html>/)
    if(disabled)assert.notEqual(state.colour,'rgba(0, 0, 0, 0)')
    results.fallbacks.push({disabled,...state})
    await fallback.screenshot({path:path.join(output,disabled?'no-webgl.png':'no-capture.png')})
    await browser.close();browser=null
  }
  results.errors=errors;assert.deepEqual(errors,[])
  console.log(JSON.stringify(results));await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({results,error:String(error)},null,2));throw error}
finally{await browser?.close();await server.close()}
