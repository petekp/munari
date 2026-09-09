// Source allocation regression — a late LOD request must preserve every draw.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
import {setChromeViewport} from '../chromeViewport.mjs'

const output=process.env.API_PROOF_OUTPUT??path.join(tmpdir(),'munari-api/surface-textures')
await mkdir(output,{recursive:true})
const server=await createServer({configFile:false,root:import.meta.dirname,cacheDir:path.join(output,'.vite'),server:{host:'127.0.0.1',port:0,fs:{allow:[path.resolve(import.meta.dirname,'../..')]}},esbuild:{jsx:'automatic'},logLevel:'warn'})
await server.listen()
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',defaultViewport:null,args:['--enable-features=CanvasDrawElement','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']})
const results=[]
try {
  for(const pinned of [false,true]) {
    const page=await browser.newPage(),errors=[]
    page.on('pageerror',error=>errors.push(String(error)))
    await setChromeViewport(page,{width:900,height:650})
    try {
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?${pinned?'pinned':''}`,{waitUntil:'load'})
      assert.equal(await page.evaluate(()=>'drawElementImage' in CanvasRenderingContext2D.prototype),true)
      await page.waitForFunction(()=>window.__textureProof)
      const rows=await page.evaluate(()=>window.__textureProof)
      await page.screenshot({path:path.join(output,`${pinned?'pinned':'auto'}.png`)})
      const result={pinned,rows,errors,dpr:await page.evaluate(()=>devicePixelRatio)}
      results.push(result)
      console.log(JSON.stringify(result))
      await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
      assert.deepEqual(errors,[])
      if(process.env.OBSERVE_ONLY!=='1')for(const row of rows) {
        assert.equal(row.error,0,`${row.name}: WebGL rejected the upload`)
        const blue=row.name.endsWith('-2')||row.name.endsWith('-3')
        assert.deepEqual(row.left,blue?[0,0,255,255]:[255,0,0,255],`${row.name}: left source pixels changed`)
        assert.deepEqual(row.right,blue?[255,255,0,255]:[0,255,0,255],`${row.name}: right source pixels changed`)
      }
    } finally {await page.close()}
  }
  const page=await browser.newPage()
  try {
    await setChromeViewport(page,{width:900,height:650})
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/lit.html`,{waitUntil:'load'})
    await page.waitForFunction(()=>Object.values(window.__litProof?.statuses??{}).length===12&&Object.values(window.__litProof.statuses).every(value=>value==='scene'))
    const pixels=await page.evaluate(()=>window.__litProof.read())
    results.push({lit:pixels});console.log(JSON.stringify({lit:pixels}))
    await page.screenshot({path:path.join(output,'lit.png')})
    await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
    if(process.env.OBSERVE_ONLY!=='1') {
      assert.equal(pixels.error,0)
      for(const row of pixels.rows) {
        assert.equal(row.opaque[3],255)
        assert.ok(Math.abs(row.half[3]-128)<=1)
        assert.ok(Math.abs(row.quarter[3]-64)<=1)
        for(const sample of [row.half,row.quarter])for(let channel=0;channel<3;channel++)assert.ok(Math.abs(sample[channel]-row.opaque[channel]*sample[3]/255)<=2,JSON.stringify(row))
      }
      for(const row of pixels.edges) {
        assert.ok(row.edge[3]>16&&row.edge[3]<240,'The edge sample must be filtered')
        for(let channel=0;channel<3;channel++)assert.ok(Math.abs(row.edge[channel]-row.solid[channel]*row.edge[3]/255)<=2,JSON.stringify(row))
      }
      assert.deepEqual(pixels.corner,[0,0,0,0])
      assert.deepEqual(pixels.sharedLit,pixels.rows[0].opaque)
      assert.deepEqual(pixels.sharedUnlit,[255,255,255,255])
      await page.evaluate(()=>window.__litProof.update())
      await page.waitForFunction(()=>window.__litProof.read().sharedUnlit[0]===80)
      const updated=await page.evaluate(()=>window.__litProof.read())
      assert.equal(updated.error,0)
      assert.deepEqual(updated.sharedUnlit,[80,190,120,255])
      assert.deepEqual(updated.sharedLit,updated.rows[0].opaque)
      assert.notDeepEqual(updated.sharedLit,pixels.sharedLit)
      results.push({updated});console.log(JSON.stringify({updated}))
      await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
    }
  } finally {await page.close()}
} finally {await browser.close();await server.close()}
