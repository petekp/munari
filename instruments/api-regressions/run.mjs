// Verified PR #83 failures, exercised through the public API in serial Chrome profiles.
import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
import {setChromeViewport} from '../chromeViewport.mjs'

const output=process.env.API_PROOF_OUTPUT??path.join(tmpdir(),'munari-api/regressions')
await mkdir(output,{recursive:true})
const chrome=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(value=>value&&existsSync(value))
assert.ok(chrome,'Chrome is required')
const sourceRoot=process.env.API_SOURCE_ROOT&&path.resolve(process.env.API_SOURCE_ROOT)
const alias=sourceRoot?[
  {find:/^@petepetrash\/munari$/,replacement:path.join(sourceRoot,'packages/react/src/index.ts')},
  {find:'@petepetrash/munari/advanced',replacement:path.join(sourceRoot,'packages/react/src/advanced.ts')},
  {find:'@petepetrash/munari/style.css',replacement:path.join(sourceRoot,'packages/react/src/style.css')},
  {find:'@munari/core',replacement:path.join(sourceRoot,'packages/core/src/index.ts')},
]:[]
const server=await createServer({configFile:false,root:import.meta.dirname,cacheDir:path.join(output,'.vite'),resolve:{alias,dedupe:['react','react-dom','three','@react-three/fiber']},server:{host:'127.0.0.1',port:0,fs:{allow:[path.resolve(import.meta.dirname,'../..'),...(sourceRoot?[sourceRoot]:[])]}},esbuild:{jsx:'automatic'},logLevel:'warn'})
await server.listen()
const url=`http://127.0.0.1:${server.httpServer.address().port}`
const results=[]
const frameWait=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
const pause=(page,ms)=>page.evaluate(ms=>new Promise(resolve=>setTimeout(resolve,ms)),ms)
const read=page=>page.evaluate(()=>{
  const p=window.__apiRegression
  return {frames:p.frames,revisions:p.revisions,pixels:p.pixels,capture:p.capture(),status:p.status,errors:p.errors,mounts:p.mounts}
})
async function pixels(page,native,preparing){
  return page.evaluate(async({native,preparing})=>{
    const decode=async data=>{const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();return ctx.getImageData(0,0,canvas.width,canvas.height).data}
    const a=await decode(native),b=await decode(preparing)
    if(a.length!==b.length)throw new Error('The comparison viewport changed')
    let error=0;for(let i=0;i<a.length;i++)error+=Math.abs(a[i]-b[i])
    return error/a.length
  },{native,preparing})
}
async function check(page,kind,enhanced){
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(String(error)))
  await page.goto(`${url}/?case=${kind}`,{waitUntil:'load'})
  await page.waitForFunction(()=>window.__apiRegression)
  assert.equal(await page.evaluate(()=>'drawElementImage' in CanvasRenderingContext2D.prototype),enhanced)
  await page.evaluate(()=>document.fonts.ready)
  let result
  if(kind==='targets'||kind==='reorder'){
    await page.waitForSelector('#target-a [data-api-live] [data-item="a"]')
    const original=await page.$('#target-a [data-api-live] [data-item="a"]')
    await original.click()
    if(kind==='targets')await page.evaluate(()=>window.__apiRegression.prepend())
    else await page.evaluate(()=>window.__apiRegression.reorder())
    await frameWait(page)
    assert.deepEqual((await read(page)).errors,[])
    assert.ok(await page.evaluate(node=>document.querySelector('#target-a [data-api-live] [data-item="a"]')===node,original))
    assert.equal(await original.evaluate(node=>node.textContent),'Count 1')
    assert.equal(await page.$$eval('#target-homes [data-item]',nodes=>nodes.length),0)
    if(kind==='targets'){await page.evaluate(()=>window.__apiRegression.reorder());await frameWait(page)}
    assert.ok(await page.evaluate(node=>document.querySelector('#target-a [data-api-live] [data-item="a"]')===node,original))
    await page.evaluate(()=>window.__apiRegression.remove());await frameWait(page)
    assert.equal(await page.$$eval('#target-a [data-item]',nodes=>nodes.length),0)
    assert.equal(await page.$$eval('#target-b [data-api-live] [data-item="b"]',nodes=>nodes.length),1)
    result={retained:true,mounts:(await read(page)).mounts};assert.deepEqual(result.mounts,{a:1,b:1})
  }else if(kind==='capture'){
    await page.waitForFunction(()=>window.__apiRegression.pixels.b[0]===230)
    await page.evaluate(()=>window.__apiRegression.remove());await pause(page,200)
    const before=await read(page)
    assert.equal(before.capture.consumers,1)
    await page.evaluate(()=>window.__apiRegression.paint())
    await page.waitForFunction(revision=>window.__apiRegression.capture().revision>revision,{},before.capture.revision)
    await page.waitForFunction(()=>window.__apiRegression.pixels.b[0]===20&&window.__apiRegression.pixels.b[2]===230,{timeout:2000})
    await page.waitForFunction(()=>window.__apiRegression.revisions.b===window.__apiRegression.capture().revision,{timeout:2000})
    const after=await read(page)
    assert.equal(after.revisions.b,after.capture.revision)
    assert.ok(after.frames.b>before.frames.b)
    await pause(page,150);const idle=await read(page);await pause(page,200)
    assert.equal((await read(page)).frames.b,idle.frames.b)
    result={before,after,idleFrames:idle.frames.b}
  }else if(kind==='resize'){
    await page.waitForFunction(()=>window.__apiRegression.status?.presentation==='scene'&&window.__apiRegression.anchor)
    await pause(page,150)
    result=await page.evaluate(async()=>{
      const p=window.__apiRegression
      const sample=()=>{const [paintedWidth]=p.painted();return {width:p.width,paintedWidth,anchor:p.anchor,storeWidth:document.getElementById('resize-source').closest('canvas').width,error:Math.abs(p.anchor.uMin-(paintedWidth-30)/paintedWidth)*paintedWidth}}
      const before=sample(),rows=[]
      for(let width=201;width<=240;width+=3){p.setWidth(width);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));rows.push(sample())}
      await new Promise(resolve=>setTimeout(resolve,250));return {before,rows,settled:sample()}
    })
    assert.ok(result.rows.some(row=>row.width>230&&row.storeWidth===result.before.storeWidth),'The sweep must exercise in-band drift')
    assert.ok(result.rows.every(row=>row.error<=1),JSON.stringify(result.rows))
    assert.ok(result.settled.error<1e-5)
  }else if(kind==='focus'){
    await page.waitForFunction(()=>window.__apiRegression.status?.presentation==='page')
    const original=await page.$('#focus-input')
    await original.focus();await original.evaluate(node=>node.setSelectionRange(2,7))
    await page.evaluate(()=>window.__apiRegression.request(true))
    await page.waitForFunction(enhanced=>window.__apiRegression.status?.presentation===(enhanced?'scene':'page')&&!window.__apiRegression.status.isTransitioning,{},enhanced)
    await page.evaluate(()=>window.__apiRegression.swap())
    await page.waitForFunction(()=>window.__apiRegression.activeHandle==='b')
    await page.waitForFunction(enhanced=>window.__apiRegression.status?.presentation===(enhanced?'scene':'page')&&!window.__apiRegression.status.isTransitioning,{},enhanced)
    assert.ok(await page.evaluate(node=>document.activeElement===node,original))
    await page.evaluate(()=>window.__apiRegression.request(false))
    await page.waitForFunction(()=>window.__apiRegression.status?.presentation==='page'&&!window.__apiRegression.status.isTransitioning)
    result=await page.evaluate(node=>({same:document.getElementById('focus-input')===node,focused:document.activeElement===node,selection:[node.selectionStart,node.selectionEnd]}),original)
    assert.deepEqual(result,{same:true,focused:true,selection:[2,7]})
  }else if(kind.startsWith('clip')){
    await page.waitForFunction(()=>window.__apiRegression.status?.supported)
    await pause(page,150)
    if(kind==='clip-dynamic'){await page.evaluate(()=>window.__apiRegression.setClipHeight(150));await frameWait(page)}
    const clip=await page.$eval('#clipped-source',node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})
    const native=await page.screenshot({clip,encoding:'base64'})
    if(kind==='clip-dynamic'){await page.evaluate(()=>window.__apiRegression.setClipHeight(180));await frameWait(page)}
    await page.evaluate(()=>window.__apiRegression.request(true))
    await page.waitForFunction(()=>window.__apiRegression.status?.isTransitioning&&document.getElementById('clipped-source').closest('canvas'))
    if(kind==='clip-dynamic'){await page.evaluate(()=>window.__apiRegression.setClipHeight(150));await frameWait(page)}
    const preparing=await page.screenshot({clip,encoding:'base64'})
    assert.equal((await read(page)).status.presentation,'page')
    const error=await pixels(page,native,preparing)
    await writeFile(path.join(output,`${kind}-native.png`),Buffer.from(native,'base64'))
    await writeFile(path.join(output,`${kind}-preparing.png`),Buffer.from(preparing,'base64'))
    assert.ok(error<=0.5,`${kind}: preparation image error ${error}`)
    const inside=await page.$eval('#clip-inside',node=>{const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})
    const outside=await page.$eval('#clip-outside',node=>{const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})
    await page.mouse.click(inside.x,inside.y);await page.mouse.click(outside.x,outside.y)
    assert.equal(await page.evaluate(()=>window.__apiRegression.insideClicks),1)
    assert.equal(await page.evaluate(()=>window.__apiRegression.outsideClicks),0)
    await page.waitForFunction(()=>window.__apiRegression.status?.presentation==='scene')
    const after=await page.$eval('#clipped-source',node=>node.closest('canvas').style.clipPath)
    assert.equal(after,'','Preparation must release its clip before native scene input')
    result={imageError:error,insideClicks:1,outsideClicks:0,clipAfterHandoff:after}
  }else if(kind==='attribute'){
    await page.waitForFunction(enhanced=>window.__apiRegression.status?.presentation===(enhanced?'scene':'page'),{},enhanced)
    assert.equal((await read(page)).status.reason,null)
    await page.evaluate(()=>window.__apiRegression.setAttribute('one'));await frameWait(page)
    assert.equal((await read(page)).status.reason,null)
    await page.evaluate(()=>window.__apiRegression.setAttribute('onclick'))
    await page.waitForFunction(()=>window.__apiRegression.status?.reason?.includes('inline DOM handlers'))
    await page.waitForFunction(()=>window.__apiRegression.status?.presentation==='page')
    result={ordinaryAttributesAccepted:true,inlineHandlerRejected:true}
  }
  assert.deepEqual((await read(page)).errors,[])
  assert.deepEqual(pageErrors,[])
  return {case:kind,enhanced,dpr:await page.evaluate(()=>devicePixelRatio),...result}
}
try{
  for(const enhanced of [true,false]){
    const browser=await puppeteer.launch({executablePath:chrome,headless:process.env.HEADED!=='1',defaultViewport:null,args:[...(enhanced?['--enable-features=CanvasDrawElement']:[]),'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']})
    try{
      const defaults=enhanced?['targets','reorder','capture','resize','focus','clip','clip-nested','clip-rounded','clip-scaled','clip-dynamic','clip-border','clip-margin','clip-longhand','clip-preserve','attribute']:['targets','reorder','focus','attribute']
      const cases=process.env.API_CASES?defaults.filter(name=>process.env.API_CASES.split(',').includes(name)):defaults
      for(const kind of cases){
        const page=await browser.newPage();await setChromeViewport(page,{width:960,height:700});await page.bringToFront()
        try{const result=await check(page,kind,enhanced);results.push(result);console.log(JSON.stringify(result));await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))}
        catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({case:kind,enhanced,error:String(error),observed:await read(page).catch(()=>null)},null,2));throw error}
        finally{await page.close()}
      }
    }finally{await browser.close()}
  }
}finally{await server.close()}
