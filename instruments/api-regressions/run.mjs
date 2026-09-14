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
// Chrome's native and captured raster edges differ under nonuniform scale.
// Pixels check clipping; a separate box comparison checks placement.
const POSITION_BUDGET_PX=0.25
// Summed |ΔRGB| above which a pixel counts as different, and the fewest
// counted pixels a row or column needs before its fraction is read.
const STRONG_DIFFERENCE=64
const MIN_LINE_PIXELS=8
const frameWait=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
const pause=(page,ms)=>page.evaluate(ms=>new Promise(resolve=>setTimeout(resolve,ms)),ms)
const read=page=>page.evaluate(()=>{
  const p=window.__apiRegression
  return {frames:p.frames,revisions:p.revisions,pixels:p.pixels,capture:p.capture(),status:p.status,errors:p.errors,mounts:p.mounts}
})
// Two readings of a native shot against a preparation shot of the same box.
// `mean` is the mean absolute channel difference, 0-255, over every pixel.
// `worstLine` is the largest fraction of any row or column whose pixels differ
// strongly, with `exclude` (CSS-px rects relative to the shot) left out.
//
// Background outside a clip dilutes a line's score, so this metric alone
// cannot establish placement. The native and riding boxes are compared too.
async function pixels(page,native,preparing,exclude=[],cssWidth=0){
  return page.evaluate(async({native,preparing,exclude,cssWidth,strong,minLine})=>{
    const decode=async data=>{const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const size=[bitmap.width,bitmap.height];bitmap.close();return {data:ctx.getImageData(0,0,canvas.width,canvas.height).data,size}}
    const a=await decode(native),b=await decode(preparing)
    if(a.data.length!==b.data.length)throw new Error('The comparison viewport changed')
    const [width,height]=a.size,k=cssWidth?width/cssWidth:1
    const skip=exclude.map(r=>[Math.floor(r.x*k),Math.floor(r.y*k),Math.ceil((r.x+r.width)*k),Math.ceil((r.y+r.height)*k)])
    const rows=Array.from({length:height},()=>[0,0]),cols=Array.from({length:width},()=>[0,0])
    const edge=new Uint8Array(width*height)
    const contrast=(i,j)=>Math.abs(a.data[i]-a.data[j])+Math.abs(a.data[i+1]-a.data[j+1])+Math.abs(a.data[i+2]-a.data[j+2])
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const at=y*width+x,i=at*4
      if(x>0&&contrast(i,i-4)>strong){edge[at]=1;edge[at-1]=1}
      if(y>0&&contrast(i,i-width*4)>strong){edge[at]=1;edge[at-width]=1}
    }
    const nearEdge=(x,y)=>{
      if(x<1||y<1||x>=width-1||y>=height-1)return true
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(edge[(y+dy)*width+x+dx])return true
      return false
    }
    let error=0,unexpectedPixels=0,referenceFillPixels=0
    for(let i=0;i<a.data.length;i+=4){
      let d=0;for(let c=0;c<4;c++)error+=Math.abs(a.data[i+c]-b.data[i+c])
      const x=(i/4)%width,y=Math.floor(i/4/width)
      if(skip.some(([x0,y0,x1,y1])=>x>=x0&&x<x1&&y>=y0&&y<y1))continue
      for(let c=0;c<3;c++)d+=Math.abs(a.data[i+c]-b.data[i+c])
      const hit=d>strong?1:0
      if(Math.abs(a.data[i]-230)+Math.abs(a.data[i+1]-20)+Math.abs(a.data[i+2]-20)<strong)referenceFillPixels++
      if(hit&&!nearEdge(x,y))unexpectedPixels++
      rows[y][0]+=hit;rows[y][1]++;cols[x][0]+=hit;cols[x][1]++
    }
    const worst=lines=>lines.reduce((m,[hits,n])=>n>=minLine?Math.max(m,hits/n):m,0)
    return {mean:error/a.data.length,worstLine:Math.max(worst(rows),worst(cols)),unexpectedPixels,referenceFillPixels}
  },{native,preparing,exclude,cssWidth,strong:STRONG_DIFFERENCE,minLine:MIN_LINE_PIXELS})
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
  }else if(kind==='prepare-unfocused'){
    // While the page is still the one showing, the live node is taken into the
    // capture host only for what a page-side copy cannot carry: a caret or a
    // selection (decisions.md #42, as narrowed). A declared part with no presenter holds preparation open
    // until the runner has checked both states.
    await page.waitForFunction(()=>window.__apiRegression.status?.supported)
    await pause(page,150)
    await page.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur())
    await page.evaluate(()=>window.__apiRegression.request(true))
    await page.waitForFunction(()=>window.__apiRegression.status?.isTransitioning)
    await frameWait(page);await frameWait(page)
    const unfocused=await page.evaluate(()=>({presentation:window.__apiRegression.status.presentation,inHost:Boolean(document.getElementById('clipped-source').closest('canvas')),parked:Boolean(document.getElementById('clipped-source').closest('[data-munari-parked]'))}))
    assert.equal(unfocused.presentation,'page','the page must still present while the required presenter is missing')
    assert.equal(unfocused.parked,false,'an unfocused source keeps its live node on the page during preparation')
    // Give it a caret and the same preparation takes the node, because now a
    // copy would lose something.
    await page.$eval('#clip-inside',node=>node.focus())
    await frameWait(page);await frameWait(page)
    const focused=await page.evaluate(()=>({presentation:window.__apiRegression.status.presentation,parked:Boolean(document.getElementById('clipped-source').closest('[data-munari-parked]')),focused:document.activeElement?.id}))
    assert.equal(focused.presentation,'page','preparation must remain open when the caret arrives')
    assert.equal(focused.focused,'clip-inside')
    assert.equal(focused.parked,true,'a caret inside the source takes the live node into the capture host')
    result={unfocused,focused}
  }else if(kind.startsWith('clip')){
    await page.waitForFunction(()=>window.__apiRegression.status?.supported)
    await pause(page,150)
    if(kind==='clip-dynamic'){await page.evaluate(()=>window.__apiRegression.setClipHeight(150));await frameWait(page)}
    // The clip belongs to the RIDING host, and preparation rides only for a
    // caret or a selection (decisions.md #42, as narrowed): a source nobody is
    // in keeps its live node on the page, where the page's own overflow already
    // clips it and there is no second box to get wrong. Focus is therefore this
    // case's precondition, and it is taken before the native shot so both
    // images carry the same focus ring.
    await page.$eval('#clip-inside',node=>node.focus())
    await frameWait(page)
    const clip=await page.$eval('#clipped-source',node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})
    // The case proves the RIDE: where the capture is placed and where it is
    // clipped. A form control's interior is the one thing it cannot compare,
    // because the compositor and drawElementImage raster a control's border
    // and glyphs differently under a non-uniform scale — measured on
    // clip-scaled, scale(1.2, 0.85): the button's outer box and the clip edges
    // matched row for row while its top border drew as 1 row plus a blend
    // natively and 2 full rows in the capture. Controls are left out,
    // with their focus ring; the source's fill, edges and clip still count.
    const controls=await page.$eval('#clipped-source',(node,clip)=>[...node.querySelectorAll('button,input,select,textarea')].map(el=>{const r=el.getBoundingClientRect(),ring=4;return {x:r.x-clip.x-ring,y:r.y-clip.y-ring,width:r.width+ring*2,height:r.height+ring*2}}),clip)
    const native=await page.screenshot({clip,encoding:'base64'})
    if(kind==='clip-dynamic'){await page.evaluate(()=>window.__apiRegression.setClipHeight(180));await frameWait(page)}
    await page.evaluate(()=>window.__apiRegression.request(true))
    await page.waitForFunction(()=>window.__apiRegression.status?.isTransitioning&&document.getElementById('clipped-source').closest('canvas'))
    if(kind==='clip-dynamic'){await page.evaluate(()=>window.__apiRegression.setClipHeight(150));await frameWait(page)}
    const preparing=await page.screenshot({clip,encoding:'base64'})
    // Preparation aligns its texel footprint to the device grid (decision #44).
    // The native box supplies the independent center and requested size.
    const expectedBox=await page.evaluate(native=>{
      const dpr=devicePixelRatio,width=Math.round(native.width*dpr)/dpr,height=Math.round(native.height*dpr)/dpr
      return {x:Math.round((native.x+(native.width-width)/2)*dpr)/dpr,y:Math.round((native.y+(native.height-height)/2)*dpr)/dpr,width,height}
    },clip)
    const displacement=()=>page.$eval('#clipped-source',(node,expected)=>{
      const r=node.getBoundingClientRect()
      return Math.max(Math.abs(r.x-expected.x),Math.abs(r.y-expected.y),Math.abs(r.width-expected.width),Math.abs(r.height-expected.height))
    },expectedBox)
    const placementError=await displacement()
    assert.ok(placementError<=POSITION_BUDGET_PX,`${kind}: preparation moved ${placementError}px`)
    assert.equal((await read(page)).status.presentation,'page')
    const {mean:imageError,worstLine:error,unexpectedPixels,referenceFillPixels}=await pixels(page,native,preparing,controls,clip.width)
    await writeFile(path.join(output,`${kind}-native.png`),Buffer.from(native,'base64'))
    await writeFile(path.join(output,`${kind}-preparing.png`),Buffer.from(preparing,'base64'))
    assert.ok(referenceFillPixels>=1000,`${kind}: reference contains too little of the visible source`)
    assert.equal(unexpectedPixels,0,`${kind}: ${unexpectedPixels} pixels differ away from native raster edges`)
    let squareClipControl=null
    if(kind==='clip-rounded'){
      const previous=await page.$eval('#clipped-source',node=>{
        const host=node.closest('canvas'),outer=document.querySelector('#clip-outer'),r=node.getBoundingClientRect(),c=outer.getBoundingClientRect()
        const previous={clip:host.style.clipPath,radius:outer.style.borderRadius}
        host.style.clipPath=`inset(${Math.max(0,c.top-r.top)}px ${Math.max(0,r.right-c.right)}px ${Math.max(0,r.bottom-c.bottom)}px ${Math.max(0,c.left-r.left)}px)`
        outer.style.borderRadius='0'
        return previous
      })
      try{
        const faulty=await page.screenshot({clip,encoding:'base64'})
        squareClipControl=await pixels(page,native,faulty,controls,clip.width)
        assert.ok(squareClipControl.unexpectedPixels>0,'Rounded clipping check accepted a rectangular clip')
        await writeFile(path.join(output,`${kind}-square-control.png`),Buffer.from(faulty,'base64'))
      }finally{
        await page.$eval('#clipped-source',(node,previous)=>{node.closest('canvas').style.clipPath=previous.clip;document.querySelector('#clip-outer').style.borderRadius=previous.radius},previous)
      }
    }
    const negativeControls=[]
    for(const [x,y] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const previous=await page.$eval('#clipped-source',(node,[x,y])=>{const host=node.closest('canvas'),previous=host.style.translate;host.style.translate=`${x}px ${y}px`;return previous},[x,y])
      try{
        const error=await displacement()
        negativeControls.push({x,y,error})
        assert.ok(error>POSITION_BUDGET_PX,`${kind}: the placement check accepted a ${x},${y}px displacement`)
      }finally{await page.$eval('#clipped-source',(node,value)=>{node.closest('canvas').style.translate=value},previous)}
    }
    const inside=await page.$eval('#clip-inside',node=>{const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})
    const outside=await page.$eval('#clip-outside',node=>{const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})
    await page.mouse.click(inside.x,inside.y);await page.mouse.click(outside.x,outside.y)
    assert.equal(await page.evaluate(()=>window.__apiRegression.insideClicks),1)
    assert.equal(await page.evaluate(()=>window.__apiRegression.outsideClicks),0)
    await page.evaluate(()=>window.__apiRegression.releaseHold())
    await page.waitForFunction(()=>window.__apiRegression.status?.presentation==='scene')
    const after=await page.$eval('#clipped-source',node=>node.closest('canvas').style.clipPath)
    assert.equal(after,'','Preparation must release its clip before native scene input')
    result={placementError,pixelDifference:error,imageError,unexpectedPixels,referenceFillPixels,squareClipControl,negativeControls,insideClicks:1,outsideClicks:0,clipAfterHandoff:after}
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
const enhancedCases=['targets','reorder','capture','resize','focus','prepare-unfocused','clip','clip-nested','clip-rounded','clip-scaled','clip-dynamic','clip-border','clip-margin','clip-longhand','clip-preserve','attribute']
const nativeCases=['targets','reorder','focus','attribute']
const requestedCases=process.env.API_CASES?.split(',').map(name=>name.trim()).filter(Boolean)
if(requestedCases&&(!requestedCases.length||requestedCases.some(name=>!enhancedCases.includes(name))))throw new Error('API_CASES contains no cases or an unknown case')
try{
  for(const enhanced of [true,false]){
    const defaults=enhanced?enhancedCases:nativeCases
    const cases=requestedCases?defaults.filter(name=>requestedCases.includes(name)):defaults
    if(!cases.length)continue
    const browser=await puppeteer.launch({executablePath:chrome,headless:process.env.HEADED!=='1',defaultViewport:null,args:[...(enhanced?['--enable-features=CanvasDrawElement']:[]),'--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']})
    try{
      for(const kind of cases){
        const page=await browser.newPage();await setChromeViewport(page,{width:960,height:700});await page.bringToFront()
        try{const result=await check(page,kind,enhanced);results.push(result);console.log(JSON.stringify(result));await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))}
        catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({case:kind,enhanced,error:String(error),observed:await read(page).catch(()=>null)},null,2));throw error}
        finally{await page.close()}
      }
    }finally{await browser.close()}
  }
}finally{await server.close()}
