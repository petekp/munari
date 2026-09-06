// Late hosts, context loss, unmount, and native fallback preserve the same editable HTML.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
const output=process.env.API_PROOF_OUTPUT??path.join(tmpdir(),'munari-api/lifecycle')
await mkdir(output,{recursive:true})
const server=await createServer({configFile:false,root:import.meta.dirname,server:{host:'127.0.0.1',port:0},esbuild:{jsx:'automatic'},logLevel:'warn'})
await server.listen()
const rows=[]
try{
 for(const mode of ['enhanced','native','no-webgl']){
  const capable=mode!=='native',noWebGL=mode==='no-webgl'
  const browser=await puppeteer.launch({defaultViewport:null,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',args:[...(capable?['--enable-features=CanvasDrawElement']:[]),...(noWebGL?['--disable-webgl','--disable-webgl2']:[])]})
  try{
   const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)))
   await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/surface.html?lateHost&strict`,{waitUntil:'load'})
   await page.waitForFunction(()=>document.querySelector('[data-api-live] #counter'))
   await page.evaluate(()=>{window.originalField=document.querySelector('[data-api-live] #uncontrolled');window.__stateful.request(true)})
   await page.waitForFunction(()=>window.__stateful.state.requestedInScene)
   assert.equal(await page.evaluate(()=>window.__stateful.state.presentation),'page')
   assert.deepEqual(await page.evaluate(()=>window.__stateful.errors),[])
   await page.click('[data-api-live] #counter')
   await page.evaluate(()=>window.__stateful.host(true))
   if(noWebGL){
    const started=Date.now()
    while(!errors.some(error=>error.includes('Error creating WebGL context'))){
     if(Date.now()-started>5000)throw new Error('The renderer failure was not observed')
     await new Promise(resolve=>setTimeout(resolve,25))
    }
   }else await page.waitForFunction(()=>window.__statefulRenderer?.gl)
   if(capable&&!noWebGL){
    await page.waitForFunction(()=>window.__stateful.state.presentation==='scene')
    await page.evaluate(()=>{window.loss=window.__statefulRenderer.gl.getContext().getExtension('WEBGL_lose_context');window.loss.loseContext()})
    await page.waitForFunction(()=>window.__stateful.state.presentation==='page')
    await page.click('[data-api-live] #counter')
    await page.evaluate(()=>window.loss.restoreContext())
    await page.waitForFunction(()=>window.__stateful.state.presentation==='scene')
    await page.evaluate(()=>window.__stateful.host(false))
    await page.waitForFunction(()=>window.__stateful.state.presentation==='page')
    await page.click('[data-api-live] #counter')
    await page.evaluate(()=>window.__stateful.host(true))
    await page.waitForFunction(()=>window.__stateful.state.presentation==='scene')
   }else{
    assert.equal(await page.evaluate(()=>window.__stateful.state.supported),capable)
    await page.click('[data-api-live] #counter')
    assert.equal(await page.evaluate(()=>window.__stateful.state.presentation),'page')
   }
   await page.evaluate(()=>window.__stateful.request(false))
   await page.waitForFunction(()=>window.__stateful.state.presentation==='page')
   const row=await page.evaluate(()=>({same:window.originalField===document.querySelector('[data-api-live] #uncontrolled'),count:document.querySelector('[data-api-live] #counter').textContent,errors:window.__stateful.errors,mounts:window.__stateful.mounts,unmounts:window.__stateful.unmounts}))
   assert.equal(row.same,true);assert.equal(row.count,capable&&!noWebGL?'Count 3':'Count 2');assert.deepEqual(row.errors,[]);if(noWebGL)assert.ok(errors.every(error=>error.includes('Error creating WebGL context')));else assert.deepEqual(errors,[])
   rows.push({mode,capable,...row,rendererErrors:errors,browser:await browser.version()});console.log(JSON.stringify(rows.at(-1)))
  }finally{await browser.close()}
 }
 await writeFile(path.join(output,'results.json'),JSON.stringify(rows,null,2))
}finally{await server.close()}
