// Companion pose/camera/target evidence across two passes of every renderer frame.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
const output=process.env.API_PROOF_OUTPUT??path.join(tmpdir(),'munari-api/render-passes')
await mkdir(output,{recursive:true})
const server=await createServer({configFile:false,root:import.meta.dirname,server:{host:'127.0.0.1',port:0},esbuild:{jsx:'automatic'},logLevel:'warn'})
await server.listen()
const browser=await puppeteer.launch({defaultViewport:null,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',args:['--enable-features=CanvasDrawElement']})
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)))
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?nodes=${process.env.MATRIX_NODES??0}`,{waitUntil:'load'})
 await page.click('#companion-toggle')
 await page.waitForFunction(()=>window.__frameCompanion.frames>=120)
 const result=await page.evaluate(()=>{
  const r=window.__frameCompanion,samples=[...r.matrixSamples].sort((a,b)=>a-b)
  return {maxPoseShiftPixels:r.maxPoseShiftPixels,frames:r.frames,callbacks:r.callbacks,mismatches:r.mismatches,naiveMismatches:r.naiveMismatches,cameras:[...new Set(r.passes.map(p=>p.camera))],targets:[...new Set(r.passes.map(p=>p.target))],nodeCount:r.nodeCount,traversals:samples.length,matrixMs:{p50:samples[Math.floor(samples.length*0.5)],p95:samples[Math.floor(samples.length*0.95)],max:samples.at(-1)}}
 })
 assert.ok(result.matrixMs.p95<=1&&result.matrixMs.max<=4,JSON.stringify(result.matrixMs))
 assert.ok(result.maxPoseShiftPixels<=0.71)
 assert.equal(result.mismatches,0);assert.ok(result.naiveMismatches>20)
 assert.equal(result.cameras.length,2);assert.equal(result.targets.length,2);assert.ok(result.targets.includes(null))
 await page.click('#companion-toggle')
 await page.waitForFunction(()=>window.__composition?.holds?.some(hold=>hold.presentation==='page')||window.__frameCompanion.frames>0)
 await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,600)))
 const before=await page.evaluate(()=>window.__frameCompanion.callbacks)
 await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,200)))
 assert.equal(await page.evaluate(()=>window.__frameCompanion.callbacks),before)
 assert.deepEqual(errors,[])
 await writeFile(path.join(output,'results.json'),JSON.stringify({...result,errors,browser:await browser.version()},null,2))
 console.log(JSON.stringify(result))
}finally{await browser.close();await server.close()}
