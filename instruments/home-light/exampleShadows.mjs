// Measure the gallery's actual shadow field while moving its real light control.
// The instrument copies the completed lighting draw; HTML remains unmodified.
import assert from 'node:assert/strict'
import {replaceSource} from './replaceSource.mjs'
import {writeFile} from 'node:fs/promises'
import path from 'node:path'

export function observeShadowCapture(code,id) {
  if(!id.endsWith('/HomeMasthead.tsx'))return code
  const marker='      display.render(pass.scene, pass.camera, pass.paper)'
  assert.ok(code.includes(marker),'Lighting capture observation point changed')
  return replaceSource(code,marker,marker+`\n      if(window.__captureHomeLight){window.__homeLightPng=canvas.toDataURL();window.__captureHomeLight=false;}`)
}

export async function measureExampleShadows(page,output) {
  const selector='.home-example[href="/?scene=knobs"] .home-example-image'
  const saved=await page.evaluate(()=>({scroll:document.querySelector('.home-page').scrollTop,light:document.querySelector('.home-light').getBoundingClientRect().toJSON()}))
  await page.$eval(selector,element=>{document.querySelector('.home-page').scrollTop+=element.getBoundingClientRect().top-260})
  await page.waitForFunction(selector=>Math.abs(document.querySelector(selector).getBoundingClientRect().top-260)<1,{},selector)
  const box=await page.$eval(selector,element=>element.getBoundingClientRect().toJSON())
  const defaults=await page.evaluate(async()=>({elevation:(await import('/src/scenes/home/homeLightLaw.ts')).RAISED_STANDOFF,height:window.__homeLightMaterial.uniforms.uLightHeight.value}))
  const center=box.x+box.width/2
  async function moveLight(x,y,capture=false){
    const light=await page.$eval('.home-light',element=>element.getBoundingClientRect().toJSON())
    await page.mouse.move(light.x+light.width/2,light.y+light.height/2);await page.mouse.down()
    await page.mouse.move(x,y-1,{steps:12})
    if(capture)await page.evaluate(()=>{window.__homeLightPng=null;window.__captureHomeLight=true})
    await page.mouse.move(x,y);await page.mouse.up()
  }
  const results={}
  for(const [name,y] of [['near',box.y+140],['distant',840]]){
    await moveLight(center,y,true)
    await page.waitForFunction(()=>window.__homeLightPng)
    const capture=await page.evaluate(()=>({png:window.__homeLightPng,rect:document.querySelector('.home-light-host').getBoundingClientRect().toJSON()}))
    await page.screenshot({path:path.join(output,`gallery-${name}.png`)})
    await writeFile(path.join(output,`gallery-${name}-light.png`),Buffer.from(capture.png.split(',')[1],'base64'))
    results[name]=await page.evaluate(async({capture,box,center,y,defaults})=>{
      const bitmap=await createImageBitmap(await (await fetch(capture.png)).blob())
      const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close()
      const data=ctx.getImageData(0,0,canvas.width,canvas.height).data,ratio=canvas.width/capture.rect.width
      const pixel=(x,y)=>data[(Math.floor((y-capture.rect.y)*ratio)*canvas.width+Math.floor((x-capture.rect.x)*ratio))*4]
      const magnification=defaults.height/(defaults.height-defaults.elevation)
      const edge=y+(box.y-y)*magnification,start=Math.floor(edge-50),end=Math.min(Math.floor(box.y-3),Math.ceil(edge+60))
      const profile=Array.from({length:end-start},(_,i)=>Array.from({length:9},(_,j)=>pixel(center+j-4,start+i)).reduce((a,b)=>a+b)/9)
      const mean=a=>a.reduce((sum,value)=>sum+value,0)/a.length
      const lit=mean(profile.slice(0,6)),dark=mean(profile.slice(-6)),contrast=lit-dark
      const crossing=(values,threshold)=>{
        const i=values.findIndex(value=>value<=threshold)
        if(i<1)return i
        return i-1+(values[i-1]-threshold)/(values[i-1]-values[i])
      }
      const width=crossing(profile,lit-contrast*.9)-crossing(profile,lit-contrast*.1)
      const shadowY=start+crossing(profile,lit-contrast*.5)
      return {width,offset:box.y-shadowY,contrast,profile,expectedOffset:box.y-edge,magnification}
    },{capture,box,center,y,defaults})
    assert.ok(results[name].contrast>12,'The real shadow must have enough visible contrast to measure')
    assert.ok(Math.abs(results[name].offset-results[name].expectedOffset)<8,'The shadow must land at its projected position')
  }
  await page.evaluate(scroll=>{document.querySelector('.home-page').scrollTop=scroll},saved.scroll)
  await moveLight(saved.light.x+saved.light.width/2,saved.light.y+saved.light.height/2)
  assert.ok(results.distant.offset>results.near.offset*3,'Moving the bulb must visibly lengthen the real gallery shadow')
  assert.ok(results.distant.width>results.near.width*1.5&&results.distant.width>10,'The distant gallery shadow must visibly soften at actual page settings')
  return results
}
