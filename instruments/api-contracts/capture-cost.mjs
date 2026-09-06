import { setChromeViewport } from '../chromeViewport.mjs'
// Measure real copy functions in the served module without adding profiling hooks to the package.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
const root=path.resolve(import.meta.dirname,'../..')
const output=process.env.API_PROOF_OUTPUT??path.join(tmpdir(),'munari-api/capture-cost')
await mkdir(output,{recursive:true})
const instrumentation={name:'capture-cost-observer',enforce:'pre',transform(source,id){
 if(id.endsWith('/capture.tsx'))return source.replace('export function useCaptureFrame(handle:CaptureHandle) {','export function useCaptureFrame(handle:CaptureHandle) { window.__captureConsumerRenders=(window.__captureConsumerRenders??0)+1;')
 const name=id.endsWith('/elementCapture.tsx')?'copyElementForCapture':id.endsWith('/Surface.tsx')?'snapshot':null
 if(!name)return null
 const exported=name==='copyElementForCapture',declaration=`${exported?'export ':''}function ${name}(`
 if(!source.includes(declaration))return null
 const renamed=`${name}Measured`
 return source.replace(declaration,`function ${renamed}(`)+`
 ${exported?'export ':''}function ${name}(...args: Parameters<typeof ${renamed}>) {
   const started=performance.now();
   try{return ${renamed}(...args)} finally {
     const record=(window.__captureCost ??= []);
     record.push({kind:${JSON.stringify(name)},ms:performance.now()-started,nodes:args[0].querySelectorAll('*').length+1});
   }
 }
 `
}}
const lab=await createServer({root:path.join(root,'apps/lab'),cacheDir:path.join(output,'.vite-lab'),server:{host:'127.0.0.1',port:0},plugins:[instrumentation],logLevel:'warn'})
const whole=await createServer({configFile:false,root:path.join(root,'instruments/api-composition'),cacheDir:path.join(output,'.vite-whole'),server:{host:'127.0.0.1',port:0},esbuild:{jsx:'automatic'},plugins:[instrumentation],logLevel:'warn'})
await lab.listen();await whole.listen()
const browser=await puppeteer.launch({defaultViewport:null,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',args:['--enable-features=CanvasDrawElement','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']})
const rows=[]
try {
 for(const scenario of ['controls','selection','html','body']){
  const page=await browser.newPage();await setChromeViewport(page,{width:1280,height:900})
  const base=`http://127.0.0.1:${(scenario==='controls'||scenario==='selection'?lab:whole).httpServer.address().port}`
  await page.goto(base+(scenario==='controls'?'/?scene=controls&framed&delayScene':scenario==='selection'?'/?scene=selection&framed':'/whole-page.html'),{waitUntil:'load'})
  await page.waitForFunction(()=>window.__captureCost?.length>0)
  if(scenario==='body'){await page.click('#target-kind');await page.waitForFunction(()=>window.__wholeCapture.record.kind==='body')}
  await page.evaluate(()=>document.fonts.ready)
  if(scenario==='html'||scenario==='body')await page.waitForFunction(()=>window.__wholeCapture.record.sample)
  if(scenario==='selection'){await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('.sel-prose p'));getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'))});await page.waitForFunction(()=>window.__captureConsumerRenders>0)}
  await page.evaluate(()=>{window.__captureCost=[];window.consumerRendersBefore=window.__captureConsumerRenders??0;window.costGaps=[];let last=0;const sample=t=>{if(last)window.costGaps.push(t-last);last=t;window.costFrame=requestAnimationFrame(sample)};window.costFrame=requestAnimationFrame(sample)})
  if(scenario==='controls'){
   await page.focus('[data-api-live] input')
   await page.evaluate(()=>window.__apiControls.request(true))
   await page.keyboard.type(' preparation input',{delay:8})
  }else{
   await page.evaluate(async()=>{
    const root=document.querySelector('.sel-prose')??document.querySelector('#native-note')?.parentElement??document.querySelector('article')
    if(!root)throw new Error('No representative native source')
    for(let burst=0;burst<24;burst++){
     for(let event=0;event<12;event++){
      root.dataset.cost=String(burst*12+event)
      root.dispatchEvent(new PointerEvent(event%2?'pointerout':'pointerover',{bubbles:true}))
     }
     await new Promise(requestAnimationFrame)
    }
   })
  }
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  const row=await page.evaluate(scenario=>{
   cancelAnimationFrame(window.costFrame)
   const copies=window.__captureCost,sorted=copies.map(copy=>copy.ms).sort((a,b)=>a-b),gaps=window.costGaps
   return {scenario,consumerRenders:(window.__captureConsumerRenders??0)-window.consumerRendersBefore,copies:copies.length,nodes:Math.max(...copies.map(copy=>copy.nodes)),p50:sorted[Math.floor(sorted.length*.5)]??0,p95:sorted[Math.floor(sorted.length*.95)]??0,max:sorted.at(-1)??0,maxFrameGap:Math.max(...gaps)}
  },scenario)
  assert.ok(row.copies>0,JSON.stringify(row))
  const idleBefore=await page.evaluate(()=>window.__captureCost.length)
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,250)))
  row.idleCopies=await page.evaluate(before=>window.__captureCost.length-before,idleBefore)
  // Decision #42: bounded copies on these measured fixtures, no consumer render per paint.
  assert.ok(row.p95<=5&&row.max<=8,JSON.stringify(row))
  assert.equal(row.idleCopies,0)
  assert.equal(row.consumerRenders,0)
  if(scenario!=='controls')assert.ok(row.copies<=26)
  rows.push(row);console.log(JSON.stringify(row));await page.close()
 }
 await writeFile(path.join(output,'results.json'),JSON.stringify({rows,browser:await browser.version()},null,2))
}finally{await browser.close();await lab.close();await whole.close()}
