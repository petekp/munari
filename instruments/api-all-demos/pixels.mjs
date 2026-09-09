// Decode recorded compositor frames after measurement, using the browser's PNG decoder.
// Sampling only the companion strips keeps the comparison independent of changing page copy.
export async function companionPixels(page, record, frames) {
  await page.evaluate(({box,exclude}) => {
    window.__companionPixels={box,exclude,samples:[],indices:null}
  },{box:record.box,exclude:record.exclude})
  for (const frame of frames) {
    await page.evaluate(async ({data,deviceWidth}) => {
      const state=window.__companionPixels
      const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(data),letter=>letter.charCodeAt(0))],{type:'image/png'}))
      const canvas=new OffscreenCanvas(bitmap.width,bitmap.height)
      const context=canvas.getContext('2d')
      context.drawImage(bitmap,0,0);bitmap.close()
      const scale=canvas.width/deviceWidth
      const rgba=context.getImageData(0,0,canvas.width,canvas.height).data
      if(!state.indices){
        const b=state.box,indices=[]
        for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
          const px=x/scale,py=y/scale
          const strip=(px>b.right+3&&px<b.right+60&&py>b.top+10&&py<b.bottom+40)||(py>b.bottom+3&&py<b.bottom+45&&px>b.left+20&&px<b.right+60)
          if(strip&&!state.exclude.some(r=>px>=r.left-2&&px<=r.right+2&&py>=r.top-2&&py<=r.bottom+2))indices.push((y*canvas.width+x)*4)
        }
        state.indices=indices
      }
      const sample=new Uint8Array(state.indices.length*3)
      state.indices.forEach((offset,index)=>sample.set(rgba.subarray(offset,offset+3),index*3))
      state.samples.push(sample)
    },{data:frame.data,deviceWidth:frame.metadata.deviceWidth})
  }
  return page.evaluate(({images,holds}) => {
    const {samples,indices}=window.__companionPixels
    const difference=(a,b)=>{let sum=0;for(let i=0;i<samples[a].length;i++)sum+=Math.abs(samples[a][i]-samples[b][i]);return sum/samples[a].length}
    const checks=holds.map(hold=>{
      const after=images.findIndex(image=>image.time>=hold.time)
      if(after<1)throw new Error('No composited frames straddle this handoff')
      let spike=0
      for(let i=Math.max(1,after-2);i<Math.min(samples.length-1,after+3);i++)spike=Math.max(spike,(difference(i-1,i)+difference(i,i+1)-difference(i-1,i+1))/2)
      return {scene:hold.scene,time:hold.time,before:after-1,after,boundaryMae:difference(after-1,after),singleFrameSpike:spike}
    })
    const result={sampledPixels:indices.length,checks,maxBoundaryMae:Math.max(...checks.map(x=>x.boundaryMae)),maxSingleFrameSpike:Math.max(...checks.map(x=>x.singleFrameSpike)),peakMotionMae:Math.max(...samples.map((_,i)=>difference(0,i)))}
    delete window.__companionPixels
    if(result.sampledPixels<1000||result.peakMotionMae<=0.5)throw new Error('The sampled strips did not observe a moving shadow')
    return result
  },{images:record.images,holds:record.holds})
}

export async function scrollPixels(page, before, frames, viewportWidth) {
  const positions=[]
  for(const data of [before,...frames])positions.push(await page.evaluate(async ({png,viewportWidth})=>{
    const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(png),letter=>letter.charCodeAt(0))],{type:'image/png'}))
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d')
    context.drawImage(bitmap,0,0);bitmap.close()
    const rgba=context.getImageData(0,0,canvas.width,canvas.height).data
    let blue=0,blueY=0,pink=0,pinkY=0
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const i=(y*canvas.width+x)*4
      if(rgba[i+2]>220&&rgba[i]<35&&rgba[i+1]<35){blue++;blueY+=y}
      if(rgba[i+2]>220&&rgba[i]>220&&rgba[i+1]<35){pink++;pinkY+=y}
    }
    return blue>=4&&pink>=4?(blueY/blue-pinkY/pink)/(canvas.width/viewportWidth):null
  },{png:data,viewportWidth}))
  const base=positions.shift()
  if(base===null)throw new Error('Both markers must be visible before scrolling')
  const samples=positions.flatMap((offset,frame)=>offset===null?[]:[{frame,offset:offset-base}])
  if(samples.length<=10)throw new Error('Insufficient composited marker frames')
  return {framesMeasured:samples.length,maxRelativeDrift:Math.max(...samples.map(x=>Math.abs(x.offset))),samples}
}
