import { setChromeViewport } from '../chromeViewport.mjs'
// Native and relayed clicks must agree on the target of one retained source.
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import puppeteer from 'puppeteer-core'
import {createServer} from 'vite'
const repo=process.env.API_SOURCE_ROOT??path.resolve(import.meta.dirname,'../..')
const output=process.env.API_PROOF_OUTPUT??path.join(tmpdir(),'munari-api/native-pointer')
await mkdir(output,{recursive:true})
const baseline=(await readFile(path.join(repo,'packages/react/src/index.ts'),'utf8')).includes('SurfaceProof')
const aliases={'@petepetrash/munari/style.css':path.join(repo,'packages/react/src/style.css'),'@munari/core':path.join(repo,'packages/core/src/index.ts')}
aliases['@petepetrash/munari']=baseline?'virtual:baseline-munari':path.join(repo,'packages/react/src/index.ts')
const baselineAdapter={name:'baseline-api-adapter',resolveId(id){if(id==='virtual:baseline-munari')return '\0baseline-munari'},load(id){if(id==='\0baseline-munari')return `export { SurfaceProof as Surface, SceneSurfaceProof as SceneSurface, useSurfaceStatusProof as useSurfaceStatus, SurfaceCanvas, useSurfaceHandle } from ${JSON.stringify(path.join(repo,'packages/react/src/index.ts'))}`}}
const server=await createServer({configFile:false,cacheDir:path.join(output,'.vite'),plugins:[baselineAdapter],root:import.meta.dirname,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0,fs:{allow:[repo,path.resolve(import.meta.dirname,'../..')]}},resolve:{alias:aliases},logLevel:'warn'})
await server.listen()
const browser=await puppeteer.launch({defaultViewport:null,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',args:['--enable-features=CanvasDrawElement','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']})
const errors=[],rows=[]
let page
try {
 page=await browser.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(String(error)))
 await setChromeViewport(page,{width:1100,height:760})
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`,{waitUntil:'load'})
 await page.waitForFunction(()=>window.__pointerProof?.status?.supported)
 assert.equal(await page.evaluate(()=>Object.hasOwn(window.__pointerProof.status,'prepared')),baseline,'The served API must match the requested source revision')
 assert.equal(await page.evaluate(()=>'drawElementImage' in CanvasRenderingContext2D.prototype),true)
 await page.evaluate(()=>{window.original=document.querySelector('[data-api-live] [data-click="left"]');window.__pointerProof.setInScene(true)})
 // Candidate vocabulary before/after hardening; baseline comparison intentionally accepts both.
 await page.waitForFunction(()=>['scene','canvas'].includes(window.__pointerProof.status.presentation))
 const point=async(which,localX=85,localY=44)=>page.evaluate(({which,localX,localY})=>{
   const {renderer,...refs}=window.__pointerMeshes,mesh=refs[which].current,canvas=renderer.gl.domElement.getBoundingClientRect()
   mesh.updateWorldMatrix(true,false)
   const p=mesh.position.clone().set(localX/320-0.5,0.5-localY/200,0)
   mesh.localToWorld(p).project(renderer.camera)
   return {x:canvas.left+(p.x+1)*canvas.width/2,y:canvas.top+(1-p.y)*canvas.height/2}
 },{which,localX,localY})
 const click=async(which,expectedTrusted)=>{
   const before=await page.evaluate(()=>window.__pointerProof.events.length),p=await point(which)
   if(expectedTrusted)await page.waitForFunction(({x,y})=>document.elementFromPoint(x,y)?.closest('[data-api-live]'),{},p)
   await page.mouse.click(p.x,p.y)
   await page.waitForFunction(count=>window.__pointerProof.events.length>count,{},before)
   const event=await page.evaluate(()=>window.__pointerProof.events.at(-1))
   rows.push({which,event,point:p})
   assert.equal(event.target,'left');assert.equal(event.trusted,expectedTrusted)
   if(!expectedTrusted){assert.ok(Math.abs(event.x-85)<2);assert.ok(Math.abs(event.y-44)<2)}
 }
 await click('first',true)
 const aspect=await page.evaluate(()=>{
   const group=window.__pointerMeshes.renderer.scene.getObjectByName('scene-label-aspect')
   let mesh;group.traverse(object=>{if(object.isMesh)mesh=object})
   const scale=mesh.scale
   return scale.x/scale.y
 })
 if(!baseline)assert.equal(aspect,3)
 await page.evaluate(()=>window.__pointerProof.setSecond(true))
 await page.waitForFunction(()=>window.__pointerMeshes.other.current)
 await click('other',false)
 await click('first',false)
 await page.screenshot({path:path.join(output,'shared-source.png')})
 await page.evaluate(()=>window.__pointerProof.setSecond(false))
 await page.waitForFunction(()=>!window.__pointerMeshes.other.current)
 await click('first',true)
 await page.evaluate(()=>window.__pointerProof.setSwapped(true))
 await page.waitForFunction(()=>document.querySelector('[data-api-live] [data-swapped="true"]'))
 await click('first',true)
 // Input policy must remove the transformed native hit target as well as relay input.
 await page.evaluate(()=>window.__pointerProof.setDisabled(true))
 await page.waitForFunction(()=>{
   const canvas=document.querySelector('[data-api-live]')?.closest('canvas')
   return canvas&&!canvas.style.transform
 })
 const beforeDisabled=await page.evaluate(()=>window.__pointerProof.events.length),p=await point('first')
 await page.mouse.click(p.x,p.y)
 assert.equal(await page.evaluate(()=>window.__pointerProof.events.length),beforeDisabled)
 await page.evaluate(()=>window.__pointerProof.setDisabled(false))
 await click('first',true)
 await page.evaluate(()=>{document.querySelector('[data-api-live]').parentElement.inert=true;window.__pointerMeshes.renderer.invalidate()})
 await page.waitForFunction(()=>!document.querySelector('[data-api-live]').closest('canvas').style.transform)
 await page.evaluate(()=>{document.querySelector('[data-api-live]').parentElement.inert=false;window.__pointerMeshes.renderer.invalidate()})
 await click('first',true)
 await page.evaluate(()=>window.__pointerProof.replaceGeometry())
 await page.waitForFunction(()=>!document.querySelector('[data-api-live]').closest('canvas').style.transform)
 await page.evaluate(()=>window.__pointerProof.setInScene(false))
 await page.waitForFunction(()=>window.__pointerProof.status.presentation==='page')
 assert.deepEqual(errors,[])
 await writeFile(path.join(output,'results.json'),JSON.stringify({rows,errors,browser:await browser.version()},null,2))
 console.log(JSON.stringify({checks:rows.length,rows,errors}))
}catch(error){
 const state=await page?.evaluate(()=>({status:window.__pointerProof?.status,live:[...document.querySelectorAll('[data-api-live]')].map(el=>({tag:el.outerHTML,parent:el.parentElement?.outerHTML.slice(0,800)})),canvases:[...document.querySelectorAll('canvas')].map(el=>({style:el.style.cssText,width:el.width,height:el.height,html:el.innerHTML.slice(0,500)}))}));
 await page?.screenshot({path:path.join(output,'failure.png')});
 await writeFile(path.join(output,'failure.json'),JSON.stringify({message:String(error),rows,errors,state},null,2));throw error}
finally{await browser.close();await server.close()}
