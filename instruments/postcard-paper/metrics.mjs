// Geometry and framebuffer evidence for the actual drawn postcard.
export async function installPaperReader(page) {
  await page.evaluate(async()=>{
    const flyer=await import('/src/scenes/home/homeFlyer.ts')
    const frame=await import('/src/scenes/home/homePaperFrame.ts')
    window.__readPaper=()=>flyer.readHomeFlyer()
    window.__paperPoint=frame.paperFramePoint
  })
}

export async function paperMetrics(page) {
  return page.evaluate(()=>{
    const flyer=window.__readPaper()
    if(flyer?.kind!=='scene')throw new Error('The scene must own the postcard')
    const frame=flyer.paper,vertices=frame.vertices,canvas=document.querySelector('.home-canvas canvas'),box=canvas.getBoundingClientRect()
    const distance=vertices[3]+vertices[2]-frame.height
    const world=index=>{const i=index*4,w=vertices[i+3];return [(vertices[i]-box.x-box.width/2)*w/distance,(box.y+box.height/2-vertices[i+1])*w/distance,vertices[i+2]-frame.height]}
    const a=world(16*49+24),b=world(16*49+32),c=world(24*49+24)
    const ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i])
    const n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],length=Math.hypot(...n)
    let maxBend=0,backArea=0
    for(let i=0;i<vertices.length/4;i++){const p=world(i);maxBend=Math.max(maxBend,Math.abs(p.reduce((sum,v,j)=>sum+(v-a[j])*n[j],0)/length))}
    const area=(a,b,c)=>((vertices[b*4]-vertices[a*4])*(vertices[c*4+1]-vertices[a*4+1])-(vertices[b*4+1]-vertices[a*4+1])*(vertices[c*4]-vertices[a*4]))/2
    for(let row=0;row<32;row++)for(let col=0;col<48;col++){const a=row*49+col,b=a+49;backArea+=Math.max(0,area(a,b,a+1))+Math.max(0,area(b,b+1,a+1))}
    return {maxBend,backArea,height:frame.height,mapsReady:window.__paperLight.uniforms.uPaperReady.value,vertices:vertices.length/4}
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
  return page.evaluate(async()=>{
    const flyer=window.__readPaper(),canvas=document.querySelector('.home-canvas canvas'),rect=canvas.getBoundingClientRect()
    const corners=Array.from({length:4},(_,i)=>({x:flyer.corners[i*3]-rect.x,y:flyer.corners[i*3+1]-rect.y}))
    const png=await fetch(canvas.toDataURL()).then(response=>response.blob()),bitmap=await createImageBitmap(png)
    const scratch=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=scratch.getContext('2d')
    ctx.drawImage(bitmap,0,0);bitmap.close()
    const data=ctx.getImageData(0,0,scratch.width,scratch.height).data,sx=scratch.width/rect.width,sy=scratch.height/rect.height
    const u=window.__paperLight.uniforms,ink=u.uInk.value.image,inkRect=u.uInkRect.value,origin=u.uFrameOrigin.value
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
}
