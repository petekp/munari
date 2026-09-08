// Test the shared shadow renderer without capture or recorder timing costs.
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {setChromeViewport} from '../chromeViewport.mjs'
const output=process.env.PAPER_OUTPUT??path.join(tmpdir(),'munari-paper-shadow')
await mkdir(output,{recursive:true})
const server=await createServer({configFile:false,root:import.meta.dirname,cacheDir:path.join(output,'.vite'),logLevel:'warn',server:{host:'127.0.0.1',port:0,fs:{allow:[path.resolve(import.meta.dirname,'../..')]}}})
await server.listen()
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',defaultViewport:null})
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)))
  await setChromeViewport(page,{width:1000,height:760})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/shadow.html`,{waitUntil:'load'})
  await page.waitForFunction(()=>window.__paperShadowProof)
  const result=await page.evaluate(()=>window.__paperShadowProof)
  await writeFile(path.join(output,'results.json'),JSON.stringify({result,errors},null,2))
  await page.screenshot({path:path.join(output,'curved-shadow.png')})
  console.log(JSON.stringify({result,errors}))
  assert.deepEqual(errors,[]);assert.equal(result.error,0)
  assert.ok(result.changedCast>500,'The bent mesh must change the shadow beyond a flat card')
  assert.ok(result.selfShadow>5,'A rolled edge must shade visible parts of its own paper')
  assert.equal(result.flatSelfShadow,0,'A flat sheet must not acquire self-shadow acne')
  assert.equal(result.maxHeadingDifference,0,'Native heading shadows must not alter the foreground curved paper')
}finally{await browser.close();await server.close()}
