import { setChromeViewport } from '../chromeViewport.mjs'
import { tmpdir } from 'node:os'
// The real postcard's input and button work through a section-positioned canvas.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const output = process.env.API_PROOF_OUTPUT ?? path.join(tmpdir(),'munari-api/evidence')
const server = await createServer({root:path.resolve(import.meta.dirname,'../../apps/lab'),logLevel:'warn',server:{host:'127.0.0.1',port:0}})
await server.listen()
const browser = await puppeteer.launch({defaultViewport:null,executablePath:process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',args:['--enable-features=CanvasDrawElement']})
try {
  const results = []
  await mkdir(output,{recursive:true})
  for (const width of [1200,390]) {
    const page = await browser.newPage()
    await setChromeViewport(page,{width,height:900})
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
    const errors = []
    page.on('pageerror',error => errors.push(String(error)))
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=home&framed`,{waitUntil:'load'})
    await page.waitForSelector('.home-hero-holder [data-api-live] input')
    await page.evaluate(() => document.fonts.ready)
    const points = await page.evaluate(() => {
      const holder=document.querySelector('.home-hero-holder')
      const scroller=document.querySelector('.home-page')
      scroller.scrollTop += holder.getBoundingClientRect().top-180
      window.originalPostcardInput=holder.querySelector('[data-api-live] input')
      const center=element=>{const r=element.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}
      return {input:center(window.originalPostcardInput),stamp:center(holder.querySelector('[data-api-live] button'))}
    })
    await page.click('.home-hero-row button')
    await page.waitForFunction(() => document.querySelector('.home-hero-row .home-lamp').dataset.gl==='true')
    await page.mouse.click(points.input.x,points.input.y)
    await page.waitForFunction(() => document.activeElement===window.originalPostcardInput)
    await page.keyboard.type('Still the same field')
    await page.mouse.click(points.stamp.x,points.stamp.y)
    await page.waitForFunction(() => document.querySelectorAll('[data-api-live] .home-postmark').length===1)
    await page.screenshot({path:path.join(output,`home-form-${width}-scene.png`)})
    await page.click('.home-hero-row button')
    await page.waitForFunction(() => document.querySelector('.home-hero-row .home-lamp').dataset.gl==='false')
    const result = await page.evaluate(() => ({
      sameInput:document.querySelector('.home-hero-holder [data-api-live] input')===window.originalPostcardInput,
      value:window.originalPostcardInput.value,
      stamps:document.querySelectorAll('[data-api-live] .home-postmark').length,
      horizontalOverflow:document.querySelector('.home-page').scrollWidth-document.querySelector('.home-page').clientWidth,
    }))
    assert.deepEqual(result,{sameInput:true,value:'Still the same field',stamps:1,horizontalOverflow:0})
    assert.deepEqual(errors,[])
    results.push({width,...result,errors})
    await page.close()
  }
  await writeFile(path.join(output,'home-form.json'),JSON.stringify(results,null,2))
  console.log(JSON.stringify(results))
} finally { await browser.close(); await server.close() }
