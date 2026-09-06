import { setChromeViewport } from '../chromeViewport.mjs'
// A state label is not proof of pixels: project four corners and click the visible button.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import {createServer} from 'vite'

const output=process.env.API_PROOF_OUTPUT ?? path.join(tmpdir(),'munari-api','instance')
const chrome=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(file=>file&&existsSync(file))
if(!chrome)throw new Error('Chrome is required; set CHROME_PATH')
await mkdir(output,{recursive:true})
const server=await createServer({configFile:false,root:import.meta.dirname,server:{host:'127.0.0.1',port:0,fs:{allow:[path.resolve(import.meta.dirname,'../..')]}},esbuild:{jsx:'automatic'},logLevel:'warn'})
await server.listen()
const browser=await puppeteer.launch({defaultViewport:null,executablePath:chrome,headless:process.env.HEADED!=='1',args:['--enable-features=CanvasDrawElement','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']})
const rows=[]
try {
  for(const layout of ['fullscreen','inset','scaled'])for(const camera of ['perspective','orthographic']){
    const page=await browser.newPage(),errors=[]
    page.on('pageerror',error=>errors.push(String(error)))
    await setChromeViewport(page,{width:1100,height:900})
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/surface.html?layout=${layout}&camera=${camera}`,{waitUntil:'load'})
    await page.waitForFunction(()=>window.__stateful?.state?.presentation==='page'&&document.querySelector('[data-api-live] #counter'))
    assert.equal(await page.evaluate(()=>'drawElementImage' in CanvasRenderingContext2D.prototype),true)
    await page.evaluate(()=>{window.originalCounter=document.querySelector('[data-api-live] #counter');window.originalField=document.querySelector('[data-api-live] #uncontrolled')})
    await page.click('[data-api-live] #counter')
    await page.$eval('[data-api-live] #uncontrolled',input=>{input.value='retained value';input.dispatchEvent(new Event('input',{bubbles:true}))})
    await page.screenshot({path:path.join(output,`${layout}-${camera}-page.png`)})
    await page.click('#toggle')
    await page.waitForFunction(()=>window.__stateful.state.presentation==='scene'&&!window.__stateful.state.isTransitioning)
    const checkCorners=async()=>{
      await page.waitForFunction(()=>{
        const state=window.__statefulRenderer,slot=document.querySelector('#slot').getBoundingClientRect(),canvas=state.gl.domElement.getBoundingClientRect()
        let mesh;state.scene.traverse(object=>{if(object.isMesh)mesh=object})
        if(!mesh)return false
        const points=[[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]].map(([x,y])=>{
          const point=mesh.position.clone().set(x,y,0);mesh.localToWorld(point).project(state.camera)
          return {x:canvas.left+(point.x+1)*canvas.width/2,y:canvas.top+(1-point.y)*canvas.height/2}
        })
        const expected=document.querySelector('#slot [data-munari-snapshot] [data-form]')?.getBoundingClientRect()??slot
        const tolerance=1/devicePixelRatio
        return Math.abs(Math.min(...points.map(p=>p.x))-expected.left)<=tolerance&&Math.abs(Math.max(...points.map(p=>p.x))-expected.right)<=tolerance&&Math.abs(Math.min(...points.map(p=>p.y))-expected.top)<=tolerance&&Math.abs(Math.max(...points.map(p=>p.y))-expected.bottom)<=tolerance
      },{timeout:4000})
    }
    await checkCorners()
    const point=await page.$eval('#slot [data-munari-snapshot] [data-counter]',button=>{const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})
    await page.mouse.click(point.x,point.y)
    await page.waitForFunction(()=>window.originalCounter.textContent==='Count 2')
    await page.screenshot({path:path.join(output,`${layout}-${camera}-scene.png`)})
    await page.click('#resize');await checkCorners()
    await page.$eval('#scroller',element=>{element.scrollTop=35});await checkCorners()
    if(process.env.LAYOUT_MOVE==='1'){
      await page.waitForFunction(()=>{
        const frame=window.__statefulRenderer.gl.info.render.frame, now=performance.now()
        if(window.quietFrame?.frame!==frame)window.quietFrame={frame,since:now}
        return now-window.quietFrame.since>300
      },{timeout:4000})
      await page.evaluate(()=>{document.querySelector('#slot').previousElementSibling.style.height='83px'})
      await checkCorners()
    }
    await page.click('#toggle')
    await page.waitForFunction(()=>window.__stateful.state.presentation==='page'&&!window.__stateful.state.isTransitioning)
    const result=await page.evaluate(()=>({sameCounter:window.originalCounter===document.querySelector('[data-api-live] #counter'),sameField:window.originalField===document.querySelector('[data-api-live] #uncontrolled'),count:window.originalCounter.textContent,value:window.originalField.value,mounts:window.__stateful.mounts,unmounts:window.__stateful.unmounts}))
    assert.deepEqual(result,{sameCounter:true,sameField:true,count:'Count 2',value:'retained value',mounts:1,unmounts:0})
    assert.deepEqual(errors,[])
    rows.push({layout,camera,...result,errors});console.log(JSON.stringify(rows.at(-1)))
    await page.close()
  }
  await writeFile(path.join(output,'results.json'),JSON.stringify({browser:await browser.version(),rows},null,2))
}finally{await browser.close();await server.close()}
