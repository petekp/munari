// Compare the native heading with its lit cutout while keeping cast shadows.
// Receiver controls affect only the served measurement copy.
import assert from 'node:assert/strict'
import {replaceSource} from './replaceSource.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
import {setChromeViewport} from '../chromeViewport.mjs'

const output=process.env.LIGHT_PROOF_OUTPUT??path.join(tmpdir(),'munari-text-edges')
await mkdir(output,{recursive:true})
const observer={name:'text-edge-observer',enforce:'pre',transform(code,id){
  // Isolate the native fallback's receiver edge; shader coverage has its own probe.
  if(id.endsWith('/homeHeadlineTreatments.ts'))code=replaceSource(code,'  if(!solid||!shaded)return null','  return null')
  if(id.endsWith('/homeLight.ts'))code=replaceSource(code,'  material.uniforms.uLightHeight.value = lightHeight','  window.__typeLight=material;window.__typeFragment??=material.fragmentShader;\n  material.uniforms.uLightHeight.value = lightHeight')
  if(id.endsWith('/HomeMasthead.tsx'))code=replaceSource(code,'    build()\n    void document.fonts.ready.then(build)\n    const observer = new ResizeObserver(build)','    window.__buildTypeMask=build;\n    build()\n    void document.fonts.ready.then(build)\n    const observer = new ResizeObserver(build)')
  return code
}}
const shell={name:'text-zoom-shell',configureServer(server){server.middlewares.use((req,res,next)=>{
  if(req.url!=='/__text_zoom'){next();return}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>body{margin:0;overflow:hidden}iframe{position:absolute;left:-180px;top:-100px;width:700px;height:650px;border:0}</style><iframe src="/?scene=home&framed"></iframe>')
})}}
const server=await createServer({root:path.resolve(import.meta.dirname,'../../apps/lab'),plugins:[observer,shell],cacheDir:path.join(output,'.vite'),logLevel:'warn',server:{host:'127.0.0.1',port:0}})
await server.listen()
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',defaultViewport:null})
const frames=(page,count=4)=>page.evaluate(count=>new Promise(resolve=>{const next=()=>--count?requestAnimationFrame(next):resolve();requestAnimationFrame(next)}),count)
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
  await setChromeViewport(page,{width:700,height:650})
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__text_zoom`,{waitUntil:'load'})
  const frame=await page.waitForFrame(f=>f.url().includes('scene=home'))
  await frame.evaluate(()=>document.fonts.ready)
  await frame.waitForFunction(()=>window.__typeLight?.uniforms.uInkReady.value===1&&window.__buildTypeMask)
  await frame.evaluate(()=>{document.querySelector('.home-light-scene').style.display='none';document.querySelector('.home-light').style.opacity='0'})
  // The handle can start outside the cropped frame. Its existing keyboard
  // action sets a stable side light without changing page typography.
  await frame.$eval('.home-light',e=>e.focus())
  for(let i=0;i<12;i++)await page.keyboard.press('ArrowRight')
  const client=await page.createCDPSession();await client.send('Emulation.setPageScaleFactor',{pageScaleFactor:3})
  await frames(page,8)
  const metadata=await frame.evaluate(()=>{
    const line=document.querySelector('.home-headline-shaders'),style=getComputedStyle(line),text=line.firstChild,start=text.textContent.indexOf('aders'),range=document.createRange()
    range.setStart(text,start);range.setEnd(text,start+1);const r=range.getBoundingClientRect(),row=line.getBoundingClientRect()
    return {fontSize:style.fontSize,variation:style.fontVariationSettings,target:{x:r.x+r.width*.75,y:row.y+row.height*.6},clip:{x:r.x-10,y:row.y-4,width:r.width+28,height:row.height+8},background:getComputedStyle(document.querySelector('.home-page')).backgroundColor,ink:style.color,selectedInk:getComputedStyle(line,'::selection').color}
  })
  const parent=await page.evaluate(()=>({left:visualViewport.offsetLeft,top:visualViewport.offsetTop,width:visualViewport.width,frame:document.querySelector('iframe').getBoundingClientRect().toJSON()}))
  const capture=async(name)=>{
    const png=await page.screenshot({encoding:'base64'})
    const crop=await page.evaluate(async({png,metadata,parent})=>{
      const image=await createImageBitmap(new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'})),scale=image.width/parent.width
      const x=Math.max(0,Math.floor((metadata.clip.x+parent.frame.x-parent.left)*scale)),y=Math.max(0,Math.floor((metadata.clip.y+parent.frame.y-parent.top)*scale))
      const canvas=new OffscreenCanvas(Math.min(image.width-x,Math.ceil(metadata.clip.width*scale)),Math.min(image.height-y,Math.ceil(metadata.clip.height*scale))),ctx=canvas.getContext('2d')
      ctx.drawImage(image,x,y,canvas.width,canvas.height,0,0,canvas.width,canvas.height);image.close()
      const data=ctx.getImageData(0,0,canvas.width,canvas.height).data,blob=await canvas.convertToBlob(),bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b)
      return {png:btoa(binary),pixels:[...data],width:canvas.width,height:canvas.height,scale}
    },{png,metadata,parent})
    await writeFile(path.join(output,`${name}.png`),Buffer.from(crop.png,'base64'));delete crop.png;return crop
  }
  const receiver=async inset=>{await frame.evaluate(inset=>{
    const marker='const float GLYPH_RECEIVER_INSET = 1.5;'
    if(!window.__typeFragment.includes(marker))throw new Error('Glyph receiver observation point changed')
    window.__typeLight.fragmentShader=inset===null?window.__typeFragment:window.__typeFragment.replace(marker,`const float GLYPH_RECEIVER_INSET = ${inset.toFixed(1)};`)
    window.__typeLight.needsUpdate=true;window.__buildTypeMask()
  },inset);await frames(page)}
  const variants=[]
  for(const selected of [false,true]){
    const name=selected?'selected':'normal'
    if(selected){
      // Raised selected type casts beyond itself with the side light. Put the
      // light above its ink so its page shadow exercises the same edge seam.
      const point=await frame.$eval('.home-light',e=>{e.focus();const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})
      const dx=Math.round((metadata.target.x-point.x)/16),dy=Math.round((metadata.target.y-point.y)/16)
      for(let i=0;i<Math.abs(dx);i++)await page.keyboard.press(dx<0?'ArrowLeft':'ArrowRight')
      for(let i=0;i<Math.abs(dy);i++)await page.keyboard.press(dy<0?'ArrowUp':'ArrowDown')
    }
    await frame.evaluate(selected=>{
      const selection=getSelection();selection.removeAllRanges()
      if(selected){const node=document.querySelector('.home-headline-shaders').firstChild,range=document.createRange();range.selectNodeContents(node);selection.addRange(range)}
    },selected)
    await frame.waitForFunction(selected=>window.__typeLight.uniforms.uSelectionLift.value===(selected?64:0),{},selected)
    await frame.evaluate(()=>document.querySelector('.home-light-host').style.visibility='hidden')
    const bare=await capture(`${name}-native-type`)
    await frame.evaluate(()=>document.querySelector('.home-light-host').style.visibility='visible')
    await receiver(1000);const reference=await capture(`${name}-page-receiver`)
    await receiver(0);const original=await capture(`${name}-original`)
    await receiver(null);const fixed=await capture(`${name}-fixed`)
    const values=await page.evaluate(({bare,reference,original,fixed,metadata,selected})=>{
        const bg=metadata.background.match(/[\d.]+/g).slice(0,3).map(Number),ink=(selected?metadata.selectedInk:metadata.ink).match(/[\d.]+/g).slice(0,3).map(Number)
        const coverage=Array.from({length:bare.width*bare.height},(_,i)=>Math.max(0,Math.min(1,(bg[0]-bare.pixels[i*4])/(bg[0]-ink[0]))))
        const ring=new Uint8Array(coverage.length),radius=Math.ceil(bare.scale*1.5)
        for(let y=radius;y<bare.height-radius;y++)for(let x=radius;x<bare.width-radius;x++)if(coverage[y*bare.width+x]>.95){
          for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)if(dx*dx+dy*dy<=radius*radius){const j=(y+dy)*bare.width+x+dx;if(coverage[j]<.02)ring[j]=1}
        }
        const measure=result=>{
          let count=0,excess=0,peak=0,bright=0
          for(let i=0;i<ring.length;i++)if(ring[i]){count++;const delta=(result.pixels[i*4]-reference.pixels[i*4]+result.pixels[i*4+1]-reference.pixels[i*4+1]+result.pixels[i*4+2]-reference.pixels[i*4+2])/3;excess+=Math.max(0,delta);peak=Math.max(peak,delta);if(delta>8)bright++}
          return {count,meanExcess:excess/count,peak,bright}
        }
        const coreRadius=Math.ceil(bare.scale*3)
        let coreCount=0,coreDifference=0
        for(let y=coreRadius;y<bare.height-coreRadius;y++)for(let x=coreRadius;x<bare.width-coreRadius;x++){
          let solid=true
          for(let dy=-coreRadius;dy<=coreRadius&&solid;dy++)for(let dx=-coreRadius;dx<=coreRadius;dx++)if(dx*dx+dy*dy<=coreRadius*coreRadius&&coverage[(y+dy)*bare.width+x+dx]<.995){solid=false;break}
          if(solid){coreCount++;const i=(y*bare.width+x)*4;for(let c=0;c<3;c++)coreDifference+=Math.abs(original.pixels[i+c]-fixed.pixels[i+c])}
        }
        return {before:measure(original),after:measure(fixed),coreCount,coreDifference:coreCount?coreDifference/(coreCount*3):0}
      },{bare,reference,original,fixed,metadata,selected})
    variants.push({selected,...values})
    console.log(JSON.stringify({selected,...values}))
    await writeFile(path.join(output,'results.json'),JSON.stringify({metadata,variants,errors},null,2))
    assert.ok(values.before.bright>100,'The control must reproduce the bright outline')
    assert.ok(values.after.meanExcess<.2,'The corrected cutout must not brighten the page around the type')
    assert.ok(values.after.bright<=Math.max(1,values.before.bright*.01),'At least 99% of conspicuous fringe pixels must disappear')
    assert.ok(values.coreCount>100&&values.coreDifference<.5,'The opaque ink core must keep its lighting')
  }
  const result={metadata,variants,errors};console.log(JSON.stringify(result,null,2));await writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2));assert.deepEqual(errors,[])
}finally{await browser.close();await server.close()}
