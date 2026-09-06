// Moving to another display must resize an existing capture without replacing its content.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import puppeteer from 'puppeteer-core'
const output=process.env.API_PROOF_OUTPUT??path.join(tmpdir(),'munari-api/display-density')
await mkdir(output,{recursive:true})
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-features=CanvasDrawElement']})
try{
 const page=await browser.newPage(),records=[]
 await page.setViewport({width:1200,height:900,deviceScaleFactor:2})
 await page.goto(process.env.API_CAPTURE_URL??'http://127.0.0.1:5174')
 await page.waitForFunction(()=>window.__captureProbe?.read().frame)
 assert.ok(await page.evaluate(()=>Object.hasOwn(window.__apiControls.status,'sceneReady')),'The capture fixture must load the current public API')
 await page.evaluate(()=>{window.originalCapture=document.querySelector('[data-api-capture]');window.originalCaptureContent=window.originalCapture.firstElementChild})
 for(const dpr of [2,3,1]){
  // CDP changes resolution matches without delivering their change event in
  // Chrome 151. Resize the window too, exercising the real resize subscription.
  await page.setViewport({width:1200+dpr,height:900,deviceScaleFactor:dpr})
  await page.waitForFunction(dpr=>{
   const source=window.originalCapture
   return devicePixelRatio===dpr&&source.width===200*dpr&&source.height===120*dpr
  },{timeout:10000},dpr).catch(async error=>{
   const observed=await page.evaluate(()=>({dpr:devicePixelRatio,size:[window.originalCapture.width,window.originalCapture.height],connected:window.originalCapture.isConnected,style:window.originalCapture.style.cssText,frame:window.__captureProbe.read().frame,media:matchMedia(`(resolution: ${devicePixelRatio}dppx)`).matches}))
   await writeFile(path.join(output,'failure.json'),JSON.stringify({requested:dpr,observed,records},null,2))
   console.log(JSON.stringify({requested:dpr,observed}));throw error
  })
  const result=await page.evaluate(()=>({dpr:devicePixelRatio,size:[window.originalCapture.width,window.originalCapture.height],same:document.querySelector('[data-api-capture]')===window.originalCapture&&window.originalCapture.firstElementChild===window.originalCaptureContent,frame:window.__captureProbe.read().frame}))
  assert.ok(result.same);records.push(result)
 }
 assert.equal(new Set(records.map(row=>row.frame.sourceId)).size,1)
 await writeFile(path.join(output,'results.json'),JSON.stringify({records,browser:await browser.version()},null,2));console.log(JSON.stringify(records))
}finally{await browser.close()}
