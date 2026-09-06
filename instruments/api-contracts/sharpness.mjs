// Native-display comparison of original HTML and the same default Surface mesh.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
const output=process.env.API_PROOF_OUTPUT??path.join(tmpdir(),'munari-api/sharpness')
await mkdir(output,{recursive:true})
const disableAlignment={name:'negative-raster-alignment',enforce:'pre',transform(source,id){if(process.env.QUALITY_NEGATIVE==='1'&&id.endsWith('/surfaceRasterAlignment.ts'))return source.replace('prepare(input:SurfaceRasterInput):(()=>void)|null {','prepare(input:SurfaceRasterInput):(()=>void)|null { return null;')}}
const server=await createServer({configFile:false,plugins:[disableAlignment],root:path.resolve(import.meta.dirname,'../api-instance'),cacheDir:path.join(output,'.vite'),server:{host:'127.0.0.1',port:0},esbuild:{jsx:'automatic'},logLevel:'warn'})
await server.listen()
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:!!process.env.TEST_DPR,defaultViewport:null,args:['--enable-features=CanvasDrawElement','--window-size=1280,980','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']})
try {
 const page=await browser.newPage();await page.bringToFront()
 if(process.env.TEST_DPR)await page.setViewport({width:1280,height:900,deviceScaleFactor:Number(process.env.TEST_DPR)})
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/surface.html?layout=${process.env.QUALITY_LAYOUT??'fullscreen'}&camera=${process.env.QUALITY_CAMERA??'perspective'}`,{waitUntil:'load'})
 await page.waitForFunction(()=>window.__stateful?.state.presentation==='page'&&window.__stateful.state.supported)
 await page.evaluate(()=>document.fonts.ready)
 const box=await page.$eval('[data-api-live] [data-form]',element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})
 const before=await page.screenshot({clip:box,encoding:'base64'})
 await writeFile(path.join(output,'native.png'),Buffer.from(before,'base64'))
 await page.click('#toggle')
 await page.waitForFunction(()=>window.__stateful.state.presentation==='scene'&&!window.__stateful.state.isTransitioning)
 const after=await page.screenshot({clip:box,encoding:'base64'})
 const capture=await page.evaluate(()=>document.querySelector('[data-api-live]').closest('canvas').toDataURL().split(',')[1])
 await writeFile(path.join(output,'capture.png'),Buffer.from(capture,'base64'))
 await writeFile(path.join(output,'mesh.png'),Buffer.from(after,'base64'))
 const record=await page.evaluate(async({before,after,box})=>{
  const pixels=async(data)=>{const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(data),ch=>ch.charCodeAt(0))],{type:'image/png'}));const c=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();return {width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height).data}}
  const a=await pixels(before),b=await pixels(after)
  let difference=0,energyA=0,energyB=0
  for(let y=1;y<a.height;y++)for(let x=1;x<a.width;x++){
   const i=(y*a.width+x)*4,left=i-4,up=i-a.width*4
   for(let channel=0;channel<3;channel++){
    difference+=Math.abs(a.data[i+channel]-b.data[i+channel])
    energyA+=(a.data[i+channel]-a.data[left+channel])**2+(a.data[i+channel]-a.data[up+channel])**2
    energyB+=(b.data[i+channel]-b.data[left+channel])**2+(b.data[i+channel]-b.data[up+channel])**2
   }
  }
  const gl=window.__statefulRenderer.gl,canvas=gl.domElement,rect=canvas.getBoundingClientRect(),source=document.querySelector('[data-api-live]').closest('canvas')
  let mesh;window.__statefulRenderer.scene.traverse(object=>{if(object.isMesh)mesh=object})
  const texture=mesh.material.map
  return {canvasRect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},canvasStyle:canvas.style.cssText,canvasClient:[canvas.clientWidth,canvas.clientHeight],buffer:[canvas.width,canvas.height],box,phase:[box.x*devicePixelRatio%1,box.y*devicePixelRatio%1],dpr:devicePixelRatio,canvasDpr:gl.getPixelRatio(),canvasDensity:[canvas.width/rect.width,canvas.height/rect.height],captureDensity:[source.width/parseFloat(source.style.width),source.height/parseFloat(source.style.height)],texture:{min: texture.minFilter,mag:texture.magFilter,mipmaps:texture.generateMipmaps,anisotropy:texture.anisotropy},meanError:difference/(a.width*a.height*3),edgeEnergyRatio:energyB/energyA,dimensions:[a.width,a.height]}
 },{before,after,box})
 await writeFile(path.join(output,'results.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record))
 if(process.env.QUALITY_NEGATIVE==='1')assert.ok(record.edgeEnergyRatio<.9,JSON.stringify(record))
 else assert.ok(record.edgeEnergyRatio>=.95&&record.edgeEnergyRatio<=1.05,JSON.stringify(record))
}finally{await browser.close();await server.close()}
