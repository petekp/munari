// Scene-only HTML must retain the contrast of the same native label at the same size.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import puppeteer from 'puppeteer-core'
import {createServer} from 'vite'
import {setChromeViewport} from '../chromeViewport.mjs'
import {textureClarity} from '../textureClarity.mjs'
const output=process.env.API_PROOF_OUTPUT??path.join(tmpdir(),'munari-api/scene-sharpness')
await mkdir(output,{recursive:true})
const server=await createServer({configFile:false,root:path.resolve(import.meta.dirname,'../api-native-pointer'),cacheDir:path.join(output,'.vite'),esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'warn'})
await server.listen()
const browser=await puppeteer.launch({defaultViewport:null,executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',args:['--enable-features=CanvasDrawElement']})
try{
 const page=await browser.newPage();await setChromeViewport(page,{width:1200,height:900});await page.bringToFront()
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
 await page.waitForFunction(()=>window.__pointerProof?.status.supported)
 await page.evaluate(()=>window.__pointerProof.setInScene(true))
 await page.waitForFunction(()=>window.__pointerProof.status.presentation==='scene')
 const box=await page.evaluate(()=>{
  const {renderer}=window.__pointerMeshes,group=renderer.scene.getObjectByName('scene-label-aspect')
  let mesh;group.traverse(object=>{if(object.isMesh)mesh=object})
  const view=renderer.gl.domElement.getBoundingClientRect()
  const project=(x,y)=>{const p=mesh.position.clone().set(x,y,0).applyMatrix4(mesh.matrixWorld).project(renderer.camera);return {x:view.left+(p.x+1)*view.width/2,y:view.top+(1-p.y)*view.height/2}}
  const a=project(-.5,.5),b=project(.5,-.5)
  return {x:Math.round(a.x),y:Math.round(a.y),width:Math.round(b.x-a.x),height:Math.round(b.y-a.y)}
 })
 assert.deepEqual([box.width,box.height],[240,80])
 const mesh=await page.screenshot({clip:box,encoding:'base64'})
 await page.evaluate(box=>{
  const source=document.querySelector('[data-scene-label]'),reference=source.cloneNode(true),style=getComputedStyle(source)
  reference.removeAttribute('data-scene-label')
  Object.assign(reference.style,{position:'fixed',left:`${box.x}px`,top:`${box.y}px`,font:style.font,color:style.color,zIndex:'99999',visibility:'visible'})
  document.body.append(reference)
  window.__pointerMeshes.renderer.gl.domElement.style.visibility='hidden'
 },box)
 const native=await page.screenshot({clip:box,encoding:'base64'})
 const result={...await textureClarity(page,native,mesh),box,dpr:await page.evaluate(()=>devicePixelRatio),browser:await browser.version()}
 await writeFile(path.join(output,'native.png'),Buffer.from(native,'base64'));await writeFile(path.join(output,'mesh.png'),Buffer.from(mesh,'base64'))
 await writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
 assert.ok(result.edgeEnergyRatio>=.95&&result.edgeEnergyRatio<=1.05)
}finally{await browser.close();await server.close()}
