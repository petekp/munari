import { setChromeViewport } from '../chromeViewport.mjs'
// Visible selection and focus during deliberately delayed scene preparation.
// Screenshots measure fidelity; these observer timings are not unrecorded frame budgets.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import puppeteer from 'puppeteer-core'
const output=process.env.API_PROOF_OUTPUT??path.join(tmpdir(),'munari-api/preparation')
await mkdir(output,{recursive:true})
const browser=await puppeteer.launch({defaultViewport:null,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',args:['--enable-features=CanvasDrawElement','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']})
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)))
 await setChromeViewport(page,{width:1280,height:900})
 await page.bringToFront()
 await page.goto(`${process.env.API_PROOF_URL??'http://127.0.0.1:5173'}/?scene=controls&framed&delayScene`,{waitUntil:'load'})
 await page.waitForFunction(()=>window.__apiControls?.status?.supported&&document.querySelector('[data-api-live] input'))
 await page.evaluate(()=>document.fonts.ready)
 await page.focus('[data-api-live] input')
 const clip=await page.evaluate(()=>{
  const input=document.querySelector('[data-api-live] input');window.originalInput=input;input.setSelectionRange(0,4)
  const r=input.getBoundingClientRect();return {x:Math.floor(r.x-4),y:Math.floor(r.y-4),width:Math.ceil(r.width+8),height:Math.ceil(r.height+8)}
 })
 await page.screenshot({path:path.join(output,'page-selection.png')})
 const session=await page.createCDPSession(),frames=[]
 let firstFrame
 const referenceReady=new Promise(resolve=>{firstFrame=resolve})
 session.on('Page.screencastFrame',frame=>{frames.push(frame);firstFrame(frame);void session.send('Page.screencastFrameAck',{sessionId:frame.sessionId})})
 await session.send('Page.startScreencast',{format:'png',everyNthFrame:1})
 const referenceFrame=await referenceReady
 const reference=referenceFrame.data
 const requestTime=await page.evaluate(()=>{window.__apiControls.request(true);return Date.now()/1000})
 await page.waitForFunction(()=>window.__apiControls.status.isTransitioning&&!window.__apiControls.sceneResolved)
 const preparing=await page.evaluate(()=>({focus:document.activeElement===window.originalInput,selection:[window.originalInput.selectionStart,window.originalInput.selectionEnd],status:window.__apiControls.status,resolved:window.__apiControls.sceneResolved}))
 const capture=await page.evaluate(()=>window.originalInput.closest('canvas').toDataURL())
 await writeFile(path.join(output,'captured-selection.png'),Buffer.from(capture.split(',')[1],'base64'))
 assert.ok(!preparing.resolved&&preparing.focus)
 await page.evaluate(()=>new Promise(resolve=>{const end=performance.now()+700;const sample=()=>performance.now()>=end?resolve():requestAnimationFrame(sample);sample()}))
 await session.send('Page.stopScreencast')
 await page.screenshot({path:path.join(output,'preparing-selection.png')})
 await writeFile(path.join(output,'frame-metadata.json'),JSON.stringify(frames.map(frame=>frame.metadata),null,2))
 for(let i=0;i<Math.min(frames.length,8);i++)await writeFile(path.join(output,`frame-${i}.png`),Buffer.from(frames[i].data,'base64'))
 const pixelFrames=[]
 for(const frame of frames.filter(frame=>frame.metadata.timestamp>=requestTime&&frame.metadata.timestamp<requestTime+1)){
  const error=await page.evaluate(async({reference,data,clip,deviceWidth})=>{
   const pixels=async(data)=>{const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(data),char=>char.charCodeAt(0))],{type:'image/png'}));const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();const scale=canvas.width/deviceWidth;return context.getImageData(clip.x*scale,clip.y*scale,clip.width*scale,clip.height*scale).data}
   const a=await pixels(reference),b=await pixels(data);let error=0
   for(let i=0;i<a.length;i++)error+=Math.abs(a[i]-b[i])
   return error/a.length
  },{reference,data:frame.data,clip,deviceWidth:frame.metadata.deviceWidth})
  pixelFrames.push({timestamp:frame.metadata.timestamp,error})
 }
 assert.ok(pixelFrames.length>0,'The compositor must supply preparation frames')
 assert.ok(pixelFrames.every(frame=>frame.error<=0.5),JSON.stringify(pixelFrames))
 await page.waitForFunction(()=>window.__apiControls.status.presentation==='scene')
 await page.evaluate(()=>window.__apiControls.request(false))
 await page.waitForFunction(()=>window.__apiControls.status.presentation==='page'&&!window.__apiControls.status.isTransitioning)
 const returned=await page.evaluate(()=>({same:document.querySelector('[data-api-live] input')===window.originalInput,focus:document.activeElement===window.originalInput,selection:[window.originalInput.selectionStart,window.originalInput.selectionEnd]}))
 assert.ok(returned.same&&returned.focus);assert.deepEqual(returned.selection,[0,4]);assert.deepEqual(errors,[])
 await writeFile(path.join(output,'results.json'),JSON.stringify({preparing,returned,pixelFrames,errors,browser:await browser.version()},null,2))
 console.log(JSON.stringify({preparing,returned,pixelFrames,errors}))
}finally{await browser.close()}
