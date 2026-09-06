import { setChromeViewport } from '../chromeViewport.mjs'
import { tmpdir } from 'node:os'
// The postcard's actual composited frames, slot geometry, and frame gaps.
// Pointer-held lighting removes light drift from the handoff comparison.
import puppeteer from 'puppeteer-core'
import { companionPixels } from './pixels.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'

const output = process.env.API_PROOF_OUTPUT ?? path.join(tmpdir(),'munari-api/evidence/postcard')
const pointerInput = process.env.POSTCARD_INPUT === 'pointer'
const recordPixels = process.env.POSTCARD_RECORD ? process.env.POSTCARD_RECORD === '1' : !pointerInput
const cycles = Number(process.env.POSTCARD_CYCLES ?? (pointerInput ? 3 : 6))
let url = process.env.API_LAB_URL
let server
if (!url) {
  server = await createServer({root:path.resolve(import.meta.dirname,'../../apps/lab'),logLevel:'warn',server:{host:'127.0.0.1',port:0}})
  await server.listen()
  url = `http://127.0.0.1:${server.httpServer.address().port}`
}
await mkdir(output, { recursive: true })
const browser = await puppeteer.launch({defaultViewport:null, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.HEADED !== '1', args: ['--enable-features=CanvasDrawElement','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'] })
try {
  const page = await browser.newPage()
  await setChromeViewport(page,{ width: 1200, height: 900 })
  const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}))
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(url + '/?scene=home&framed', {waitUntil:'load'})
  await page.waitForFunction(() => document.querySelector('.home-hero-holder [data-api-live]'))
  if (process.env.POSTCARD_CANVAS === 'fixed') await page.$eval('.home-canvas', element => Object.assign(element.style,{position:'fixed',inset:'0',width:'100%',height:'100%',transform:'none'}))
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => {
    const scroller = document.querySelector('.home-page')
    scroller.scrollTop += document.querySelector('.home-hero').getBoundingClientRect().top - 80
  })
  await page.waitForFunction(() => {
    const r = document.querySelector('.home-hero-holder').getBoundingClientRect()
    return r.top > 0 && r.bottom < innerHeight
  })
  if (!await page.evaluate(() => 'drawElementImage' in document.createElement('canvas').getContext('2d'))) throw new Error('HTML capture is required')
  const light = await page.$('.home-light')
  const lightBox = await light.boundingBox()
  if (!pointerInput) {
    await page.mouse.move(lightBox.x+lightBox.width/2,lightBox.y+lightBox.height/2)
    await page.mouse.down()
    await page.mouse.move(550,100,{steps:5})
  }
  const flip = async (scene) => {
    if (pointerInput) await page.click('.home-hero-row button')
    else await page.evaluate(() => document.querySelector('.home-hero-row button').click())
    await page.waitForFunction(wanted => document.querySelector('.home-hero-row .home-lamp').dataset.gl === String(wanted), {timeout:10000}, scene)
  }
  await flip(true)
  await page.waitForFunction(() => {
    const original = document.querySelector('.home-hero-holder [data-api-live]')
    return original?.closest('canvas') !== null
  })
  // One full launch establishes the initial material and capture setup.
  await new Promise(resolve => setTimeout(resolve,1300))
  await flip(false)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.evaluate(() => {
    const holder = document.querySelector('.home-hero-holder')
    const page = holder.querySelector('[data-api-live]').parentElement
    const scroller = document.querySelector('.home-page')
    const record = {frames:[],holds:[],active:true,raf:0,origin:performance.timeOrigin}
    let previous = 0
    let previousWall = 0
    let scene = page.style.visibility === 'hidden'
    const observer = new MutationObserver(() => {
      const next = page.style.visibility === 'hidden'
      if (next !== scene) { scene=next;record.holds.push({time:performance.now(),scene:next}) }
    })
    observer.observe(page,{attributes:true,attributeFilter:['style']})
    const tick = time => {
      const r = holder.getBoundingClientRect()
      const wall = performance.now()
      if (previousWall && wall-previousWall>18) performance.mark('postcard-frame-gap')
      record.frames.push({time,gap:previous ? time-previous : 0,wall,wallGap:previousWall ? wall-previousWall : 0,x:r.x,y:r.y+scroller.scrollTop,w:r.width,h:r.height,innerHeight:document.querySelector('.home-inner').getBoundingClientRect().height,noteHeight:document.querySelector('.home-note').getBoundingClientRect().height,scene})
      previous=time
      previousWall=wall
      if(record.active)record.raf=requestAnimationFrame(tick)
    }
    record.raf=requestAnimationFrame(tick)
    window.__postcardContinuity=record
    window.__stopPostcard=()=>{record.active=false;cancelAnimationFrame(record.raf);observer.disconnect()}
  })
  const client = await page.createCDPSession()
  const frames = []
  client.on('Page.screencastFrame', event => {
    frames.push({data:event.data,timestamp:event.metadata.timestamp,metadata:event.metadata})
    void client.send('Page.screencastFrameAck',{sessionId:event.sessionId})
  })
  if (process.env.POSTCARD_TRACE === '1') { await client.send('Profiler.enable'); await client.send('Profiler.setSamplingInterval',{interval:100}); await client.send('Profiler.start') }
  if (process.env.POSTCARD_TRACE === '1') await page.tracing.start({path:path.join(output,'trace.json'),categories:['devtools.timeline','v8.execute','blink.user_timing']})
  if (recordPixels) await client.send('Page.startScreencast',{format:'png',everyNthFrame:1})
  const box = await page.$eval('.home-hero-holder',element=>element.getBoundingClientRect().toJSON())
  const exclude = await page.$$eval('.home-hero-row,.home-hero-status,.home-hero-copy',elements=>elements.map(element=>element.getBoundingClientRect().toJSON()))
  for(let cycle=0;cycle<cycles;cycle++) {
    await flip(true)
    await new Promise(resolve=>setTimeout(resolve,1250))
    await flip(false)
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  }
  if (recordPixels) await client.send('Page.stopScreencast')
  const record = await page.evaluate(()=>{window.__stopPostcard();return window.__postcardContinuity})
  if (process.env.POSTCARD_TRACE === '1') { await page.tracing.stop(); const {profile}=await client.send('Profiler.stop'); await writeFile(path.join(output,'cpu.json'),JSON.stringify(profile)) }
  await client.detach()
  if (!pointerInput) await page.mouse.up()
  for(let i=0;i<frames.length;i++) await writeFile(path.join(output,`frame-${String(i).padStart(4,'0')}.png`),Buffer.from(frames[i].data,'base64'))
  const gaps=record.frames.filter(frame=>frame.gap>0).map(frame=>frame.gap).sort((a,b)=>a-b)
  const period=gaps[Math.floor(gaps.length/2)]
  const near=record.frames.filter(frame=>record.holds.some(hold=>Math.min(Math.abs(frame.time-hold.time),Math.abs(frame.time-frame.gap-hold.time))<1000))
  const maxGap=Math.max(...near.map(frame=>frame.gap))
  const maxWallGap=Math.max(...near.map(frame=>frame.wallGap))
  const first=record.frames[0]
  const layoutDrift=Math.max(...record.frames.map(frame=>Math.max(Math.abs(frame.x-first.x),Math.abs(frame.y-first.y),Math.abs(frame.w-first.w),Math.abs(frame.h-first.h))))
  const result={...record,input:pointerInput?'trusted-pointer':'fixed-light',cycles,recordPixels,box,exclude,viewport,images:frames.map((frame,index)=>({index,time:frame.timestamp*1000-record.origin,deviceWidth:frame.metadata.deviceWidth})),errors,period,frameGapBudget:2*period+2,maxGap,maxWallGap,layoutDrift,browser:await browser.version()}
  await writeFile(path.join(output,'record.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify({holds:record.holds.length,compositedFrames:frames.length,period,maxGap,maxWallGap,budget:result.frameGapBudget,layoutDrift,errors}))
  if(recordPixels){
    const pixels=await companionPixels(page,result,frames)
    await writeFile(path.join(output,'pixels.json'),JSON.stringify(pixels,null,2))
    console.log(JSON.stringify({maxBoundaryMae:pixels.maxBoundaryMae,maxSingleFrameSpike:pixels.maxSingleFrameSpike,sampledPixels:pixels.sampledPixels}))
    if(pixels.maxBoundaryMae>0.5||pixels.maxSingleFrameSpike>0.5)process.exitCode=1
  }
  if(record.holds.length!==cycles*2 || errors.length || layoutDrift>0.5 || (!recordPixels && maxGap>result.frameGapBudget))process.exitCode=1
} finally { await browser.close(); await server?.close() }
