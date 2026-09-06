import { setChromeViewport } from '../chromeViewport.mjs'
import { tmpdir } from 'node:os'
// Compare a captured marker with a native marker through compositor scrolling.
// Reduced motion isolates page anchoring from the postcard's own flight path.
import puppeteer from 'puppeteer-core'
import { scrollPixels } from './pixels.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'
const output=process.env.API_PROOF_OUTPUT ?? path.join(tmpdir(),'munari-api/evidence/postcard-scroll')
await mkdir(output,{recursive:true})
let url=process.env.API_LAB_URL
let server
if(!url){server=await createServer({root:path.resolve(import.meta.dirname,'../../apps/lab'),logLevel:'warn',server:{host:'127.0.0.1',port:0}});await server.listen();url=`http://127.0.0.1:${server.httpServer.address().port}`}
const browser=await puppeteer.launch({defaultViewport:null,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',args:['--enable-features=CanvasDrawElement']})
try {
 const page=await browser.newPage()
 await setChromeViewport(page,{width:1200,height:900})
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
 const errors=[];page.on('pageerror',error=>errors.push(String(error)))
 await page.goto(url+'/?scene=home&framed',{waitUntil:'load'})
 await page.waitForFunction(()=>document.querySelector('.home-hero-holder [data-api-live]'))
  if (process.env.POSTCARD_CANVAS === 'fixed') await page.$eval('.home-canvas', element => Object.assign(element.style,{position:'fixed',inset:'0',width:'100%',height:'100%',transform:'none'}))
 await page.evaluate(()=>document.fonts.ready)
 await page.evaluate(()=>{
  const scroller=document.querySelector('.home-page')
  scroller.scrollTop+=document.querySelector('.home-hero').getBoundingClientRect().top-80
  const holder=document.querySelector('.home-hero-holder'),r=holder.getBoundingClientRect()
  const marker=document.createElement('div');marker.dataset.scrollMarker='native'
  marker.style.cssText=`position:absolute;left:${r.left-12}px;top:${scroller.scrollTop+r.top+12}px;width:6px;height:6px;background:rgb(255,0,255);z-index:100;pointer-events:none`
  scroller.append(marker)
  const ink=document.createElement('div');ink.dataset.scrollMarker='captured'
  ink.style.cssText='position:absolute;left:12px;top:12px;width:6px;height:6px;background:rgb(0,0,255);pointer-events:none'
  document.querySelector('.home-hero-holder [data-api-live] .home-postcard').append(ink)
 })
 await page.click('.home-hero-row button')
 await page.waitForFunction(()=>document.querySelector('.home-hero-row .home-lamp').dataset.gl==='true')
 if(!await page.evaluate(()=>'drawElementImage' in document.createElement('canvas').getContext('2d')))throw new Error('HTML capture is required')
 const client=await page.createCDPSession(),frames=[]
 client.on('Page.screencastFrame',event=>{frames.push(event.data);void client.send('Page.screencastFrameAck',{sessionId:event.sessionId})})
 await client.send('Page.startScreencast',{format:'png',everyNthFrame:1})
 const before=await page.screenshot({path:path.join(output,'before.png'),encoding:'base64'})
 await page.mouse.move(350,600)
 for(let i=0;i<15;i++){await page.mouse.wheel({deltaY:12});await new Promise(resolve=>setTimeout(resolve,8))}
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 await client.send('Page.stopScreencast')
 await client.detach()
 for(let i=0;i<frames.length;i++)await writeFile(path.join(output,`frame-${i}.png`),Buffer.from(frames[i],'base64'))
 await writeFile(path.join(output,'record.json'),JSON.stringify({frames:frames.length,errors},null,2))
 console.log(JSON.stringify({frames:frames.length,errors}))
 const pixels=await scrollPixels(page,before,frames,await page.evaluate(()=>innerWidth))
 await writeFile(path.join(output,'pixels.json'),JSON.stringify(pixels,null,2))
 console.log(JSON.stringify({framesMeasured:pixels.framesMeasured,maxRelativeDrift:pixels.maxRelativeDrift}))
 if(errors.length || pixels.maxRelativeDrift>1.5)process.exitCode=1
}finally{await browser.close();await server?.close()}
