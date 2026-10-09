// Geometry and framebuffer evidence for the actual drawn postcard.
import path from 'node:path'
import {replaceSource} from '../home-light/replaceSource.mjs'

// Exposes the postcard's Fiber state in the served copy, for postcardPng below.
export function observePostcardRenderer(code,id) {
  if(!id.endsWith('/HomePostcard.tsx'))return code
  return replaceSource(code,'onCreated={(state) => state.gl.setClearAlpha(0)}','onCreated={(state) => { state.gl.setClearAlpha(0); window.__postcardState = state }}')
}

// A WebGPU canvas is readable only in the task that drew it (canvasPixels.ts).
// window.__postcardPng(read) requests a frame and, as that draw returns, copies
// the canvas and calls `read`, so both describe the same frame.
export async function installPostcardCapture(page) {
  await page.waitForFunction(()=>Boolean(window.__postcardState))
  await page.evaluate(async url=>{
    const {afterEachRender}=await import(url)
    const state=window.__postcardState
    window.__postcardPng=(read=()=>null)=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{undo();reject(new Error('The postcard canvas did not draw'))},5000)
      const undo=afterEachRender(state.gl,()=>{
        if(state.gl.getRenderTarget()!==null)return
        clearTimeout(timer);undo();resolve({png:state.gl.domElement.toDataURL(),read:read()})
      })
      state.invalidate()
    })
  },'/@fs'+path.resolve(import.meta.dirname,'../canvasPixels.ts'))
}

export async function installPaperReader(page) {
  await page.waitForFunction(() => Boolean(window.__readPaper?.()))
  await page.evaluate(async()=>{
    const frame=await import('/src/scenes/home/homePaperFrame.ts')
    const grid=await import('/src/scenes/home/homePaperLaw.ts')
    window.__paperPoint=frame.paperFramePoint
    window.__paperGrid={columns:grid.PAPER_COLUMNS,rows:grid.PAPER_ROWS}
  })
}

export async function paperMetrics(page) {
  return page.evaluate(()=>{
    const flyer=window.__readPaper()
    if(flyer?.kind!=='scene')throw new Error('The scene must own the postcard')
    const frame=flyer.paper,vertices=frame.vertices,canvas=document.querySelector('.home-canvas canvas'),box=canvas.getBoundingClientRect()
    const {columns,rows}=window.__paperGrid,stride=columns+1
    if(vertices.length!==stride*(rows+1)*4||!vertices.every(Number.isFinite)||box.width<=0||box.height<=0)throw new Error('Paper geometry observation is incomplete')
    for(let i=3;i<vertices.length;i+=4)if(vertices[i]<=0)throw new Error('Paper vertices must be in front of the measurement camera')
    const distance=vertices[3]+vertices[2]-frame.height
    const world=index=>{const i=index*4,w=vertices[i+3];return [(vertices[i]-box.x-box.width/2)*w/distance,(box.y+box.height/2-vertices[i+1])*w/distance,vertices[i+2]-frame.height]}
    const row=Math.floor(rows/2),col=Math.floor(columns/2)
    const a=world(row*stride+col),b=world(row*stride+Math.min(columns,col+Math.max(1,Math.floor(columns/6)))),c=world(Math.min(rows,row+Math.max(1,Math.floor(rows/4)))*stride+col)
    const ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i])
    const n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],length=Math.hypot(...n)
    if(!Number.isFinite(length)||length===0)throw new Error('Paper reference plane is degenerate')
    let maxBend=0,backArea=0
    for(let i=0;i<vertices.length/4;i++){const p=world(i);maxBend=Math.max(maxBend,Math.abs(p.reduce((sum,v,j)=>sum+(v-a[j])*n[j],0)/length))}
    const area=(a,b,c)=>((vertices[b*4]-vertices[a*4])*(vertices[c*4+1]-vertices[a*4+1])-(vertices[b*4+1]-vertices[a*4+1])*(vertices[c*4]-vertices[a*4]))/2
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){const a=row*stride+col,b=a+stride;backArea+=Math.max(0,area(a,b,a+1))+Math.max(0,area(b,b+1,a+1))}
    return {maxBend,backArea,height:frame.height,mapsReady:window.__paperLight.values.paperReady.value,vertices:vertices.length/4}
  })
}

export async function controlPoint(page,selector) {
  return page.evaluate(selector=>{
    const source=document.querySelector('.home-hero-holder [data-api-live] .home-postcard'),control=source.querySelector(selector)
    const a=source.getBoundingClientRect(),b=control.getBoundingClientRect(),flyer=window.__readPaper()
    if(flyer?.kind!=='scene')throw new Error('Control must be in the scene')
    return window.__paperPoint(flyer.paper,(b.x+b.width/2-a.x)/a.width,(b.y+b.height/2-a.y)/a.height)
  },selector)
}

export async function silhouetteMetrics(page) {
  const result=await page.evaluate(async()=>{
    const canvas=document.querySelector('.home-canvas canvas'),rect=canvas.getBoundingClientRect()
    // The corners are copied in the task that drew the captured frame.
    const capture=await window.__postcardPng(()=>{const flyer=window.__readPaper();return flyer?.kind==='scene'?Array.from(flyer.corners):null})
    const drawn=capture.read
    const requireFrame=()=>{if(drawn?.length!==12||!drawn.every(Number.isFinite)||rect.width<=0||rect.height<=0)throw new Error('The silhouette needs a complete displayed paper frame')}
    requireFrame()
    const corners=Array.from({length:4},(_,i)=>({x:drawn[i*3]-rect.x,y:drawn[i*3+1]-rect.y}))
    const png=await fetch(capture.png).then(response=>response.blob()),bitmap=await createImageBitmap(png)
    const scratch=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=scratch.getContext('2d')
    ctx.drawImage(bitmap,0,0);bitmap.close()
    const data=ctx.getImageData(0,0,scratch.width,scratch.height).data,sx=scratch.width/rect.width,sy=scratch.height/rect.height
    const u=window.__paperLight.values,ink=u.ink.value.image,inkRect=u.inkRect.value,origin=u.frameOrigin.value
    let opaque=0,difference=0,backStock=0,headingOverlap=0,headingHoles=0
    for(let y=0;y<scratch.height;y++)for(let x=0;x<scratch.width;x++){
      const px=(x+.5)/sx,py=(y+.5)/sy,i=(y*scratch.width+x)*4
      const alpha=data[i+3]
      if(alpha>200)opaque++
      let inside=Infinity
      for(let edge=0;edge<4;edge++){
        const a=corners[edge],b=corners[(edge+1)%4]
        inside=Math.min(inside,((b.x-a.x)*(py-a.y)-(b.y-a.y)*(px-a.x))/Math.hypot(b.x-a.x,b.y-a.y))
      }
      if((inside>2&&alpha<20)||(inside< -2&&alpha>200))difference++
      const ix=Math.floor((px+rect.x-origin.x-inkRect.x)/inkRect.z*ink.width),iy=Math.floor((py+rect.y-origin.y-inkRect.y)/inkRect.w*ink.height)
      if(inside>2&&ix>=0&&ix<ink.width&&iy>=0&&iy<ink.height){
        const offset=(iy*ink.width+ix)*4,distance=((ink.data[offset]*256+ink.data[offset+1])/65535-.5)*512
        if(distance< -1){headingOverlap++;if(alpha<250)headingHoles++}
      }
      if(alpha>250&&Math.abs(data[i]-236)<3&&Math.abs(data[i+1]-232)<3&&Math.abs(data[i+2]-223)<3)backStock++
    }
    return {opaqueArea:opaque/(sx*sy),nonQuadArea:difference/(sx*sy),backStockArea:backStock/(sx*sy),headingOverlapArea:headingOverlap/(sx*sy),headingHoleArea:headingHoles/(sx*sy)}
  })
  if(result.opaqueArea===0)throw new Error('The completed postcard buffer contains no opaque paper')
  return result
}
