// Late hosts, GPU loss, unmount, and native fallback preserve the same editable HTML.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
import { WEBGPU_CHROME_ARGS } from '../webgpuChrome.mjs'
const output=process.env.API_PROOF_OUTPUT??path.join(tmpdir(),'munari-api/lifecycle')
await mkdir(output,{recursive:true})
const server=await createServer({configFile:false,root:import.meta.dirname,server:{host:'127.0.0.1',port:0},esbuild:{jsx:'automatic'},logLevel:'warn'})
await server.listen()
const rows=[],rendererFailure='SurfaceCanvas could not start WebGPU or its WebGL 2 fallback'
try{
 for(const mode of ['enhanced','native','no-gpu']){
  const capable=mode!=='native',noGpu=mode==='no-gpu'
  const browser=await puppeteer.launch({defaultViewport:null,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',args:[...WEBGPU_CHROME_ARGS,...(capable?['--enable-features=CanvasDrawElement']:[]),...(noGpu?['--disable-webgl','--disable-webgl2']:[])]})
  try{
   const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)))
   // Hiding navigator.gpu is a browser without WebGPU; Three then tries the disabled WebGL 2.
   if(noGpu)await page.evaluateOnNewDocument(()=>Object.defineProperty(Navigator.prototype,'gpu',{get:()=>undefined}))
   await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/surface.html?lateHost&strict`,{waitUntil:'load'})
   await page.waitForFunction(()=>document.querySelector('[data-api-live] #counter'))
   await page.evaluate(()=>{window.originalField=document.querySelector('[data-api-live] #uncontrolled');window.__stateful.request(true)})
   await page.waitForFunction(()=>window.__stateful.state.requestedInScene)
   assert.equal(await page.evaluate(()=>window.__stateful.state.presentation),'page')
   assert.deepEqual(await page.evaluate(()=>window.__stateful.errors),[])
   await page.click('[data-api-live] #counter')
   await page.evaluate(()=>window.__stateful.host(true))
   // Content returning to the page must keep the control the user was typing in.
   // A native input is focused where the content currently lives, then the return is made.
   const focusLog=[]
   const returnKeepsFocus=async(label,leave)=>{
    const from=await page.evaluate(()=>{window.originalField.focus();return window.__stateful.state.presentation+(window.originalField.closest('[data-munari-source-host]')?' (live node in capture container)':' (live node on page)')})
    assert.equal(await page.evaluate(()=>document.activeElement===window.originalField),true,`${label}: setup could not focus the field`)
    await leave()
    const kept=await page.evaluate(()=>document.activeElement===window.originalField)
    const active=await page.evaluate(()=>document.activeElement?.id||document.activeElement?.tagName)
    focusLog.push({label,from,active,kept});console.log(JSON.stringify({mode,focus:focusLog.at(-1)}))
    assert.equal(kept,true,`${label}: focus left the field on return (active: ${active})`)
   }
   if(noGpu){
    const started=Date.now()
    while(!errors.some(error=>error.includes(rendererFailure))){
     if(Date.now()-started>5000)throw new Error('The renderer failure was not observed')
     await new Promise(resolve=>setTimeout(resolve,25))
    }
   }else await page.waitForFunction(()=>window.__statefulRenderer?.gl)
   if(capable&&!noGpu){
    await page.waitForFunction(()=>window.__stateful.state.presentation==='scene')
    await returnKeepsFocus('canvas removed',async()=>{
     await page.evaluate(()=>window.__stateful.host(false))
     await page.waitForFunction(()=>window.__stateful.state.presentation==='page')
    })
    await page.click('[data-api-live] #counter')
    await page.evaluate(()=>window.__stateful.host(true))
    await page.waitForFunction(()=>window.__stateful.state.presentation==='scene')
    await returnKeepsFocus('scene released',async()=>{
     await page.evaluate(()=>window.__stateful.request(false))
     await page.waitForFunction(()=>window.__stateful.state.presentation==='page')
    })
    await page.evaluate(()=>window.__stateful.request(true))
    await page.waitForFunction(()=>window.__stateful.state.presentation==='scene')
    // Crashing the GPU process is how a real loss arrives, and it reaches both
    // backends: WebGPU has no call that loses one device the way Three reports it.
    // Chrome turns the GPU off after the second crash, so the losses come last.
    const loseGpu=async()=>{const cdp=await browser.target().createCDPSession();await cdp.send('Browser.crashGpuProcess');await cdp.detach()}
    await page.evaluate(()=>{window.lostRenderer=window.__statefulRenderer.gl})
    await returnKeepsFocus('GPU lost',async()=>{
     await loseGpu()
     await page.waitForFunction(()=>window.__stateful.state.presentation==='page')
    })
    await page.click('[data-api-live] #counter')
    // Three's renderer never draws after a loss, so the scene returns on a new one.
    await page.waitForFunction(()=>window.__stateful.state.presentation==='scene'&&window.__statefulRenderer.gl!==window.lostRenderer,{timeout:15_000})
    // A replacement lost within 10 s of its creation is not replaced again.
    await page.evaluate(()=>{window.lostRenderer=window.__statefulRenderer.gl})
    await loseGpu()
    await page.waitForFunction(()=>window.__stateful.state.presentation==='page')
    await new Promise(resolve=>setTimeout(resolve,3000))
    assert.equal(await page.evaluate(()=>window.__stateful.state.presentation),'page','a repeated loss must leave the page HTML in place')
    assert.equal(await page.evaluate(()=>window.__statefulRenderer.gl===window.lostRenderer),true,'a repeated loss must not create another renderer')
   }else{
    assert.equal(await page.evaluate(()=>window.__stateful.state.supported),capable)
    await page.click('[data-api-live] #counter')
    assert.equal(await page.evaluate(()=>window.__stateful.state.presentation),'page')
   }
   await returnKeepsFocus('final release',async()=>{
    await page.evaluate(()=>window.__stateful.request(false))
    await page.waitForFunction(()=>window.__stateful.state.presentation==='page')
   })
   const row=await page.evaluate(()=>({same:window.originalField===document.querySelector('[data-api-live] #uncontrolled'),count:document.querySelector('[data-api-live] #counter').textContent,errors:window.__stateful.errors,mounts:window.__stateful.mounts,unmounts:window.__stateful.unmounts}))
   assert.equal(row.same,true);assert.equal(row.count,capable&&!noGpu?'Count 3':'Count 2');assert.deepEqual(row.errors,[]);if(noGpu)assert.ok(errors.every(error=>error.includes(rendererFailure)));else assert.deepEqual(errors,[])
   rows.push({mode,capable,...row,focus:focusLog,rendererErrors:errors,browser:await browser.version()});console.log(JSON.stringify(rows.at(-1)))
  }finally{await browser.close()}
 }
 await writeFile(path.join(output,'results.json'),JSON.stringify(rows,null,2))
}finally{await server.close()}
