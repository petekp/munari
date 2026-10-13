// Image comparison — decoded PNG pixels preserve the evidence behind a byte mismatch.
// Differences are measurements; this command supplies no visual acceptance tolerance.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

assert.equal(process.argv.length,4,'Usage: node instruments/performance/compare-images.mjs <first.png> <second.png>')
const files=process.argv.slice(2).map(file=>path.resolve(file))
const encoded=await Promise.all(files.map(async file=>{
  const buffer=await readFile(file)
  assert.ok(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),`Expected a PNG: ${file}`)
  return buffer.toString('base64')
}))
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
try {
  const page=await browser.newPage()
  const comparison=await page.evaluate(async encoded=>{
    const decode=async base64=>{
      const bytes=Uint8Array.from(atob(base64),character=>character.charCodeAt(0))
      const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}))
      try {
        const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d')
        if(!context)throw new Error('PNG comparison could not create a 2D context')
        context.drawImage(bitmap,0,0)
        return {width:canvas.width,height:canvas.height,pixels:context.getImageData(0,0,canvas.width,canvas.height).data}
      } finally { bitmap.close() }
    }
    const first=await decode(encoded[0]),second=await decode(encoded[1])
    if(first.width!==second.width||first.height!==second.height)throw new Error(`PNG dimensions differ: ${first.width}×${first.height} versus ${second.width}×${second.height}`)
    const pixelCount=first.width*first.height
    let rgbSum=0,rgbMax=0,alphaSum=0,alphaMax=0,changedPixelCount=0,changedRgbPixelCount=0,changedAlphaPixelCount=0
    for(let offset=0;offset<first.pixels.length;offset+=4) {
      let rgbChanged=false
      for(let channel=0;channel<3;channel++) {
        const difference=Math.abs(first.pixels[offset+channel]-second.pixels[offset+channel])
        rgbSum+=difference;rgbMax=Math.max(rgbMax,difference);rgbChanged||=difference>0
      }
      const alpha=Math.abs(first.pixels[offset+3]-second.pixels[offset+3])
      alphaSum+=alpha;alphaMax=Math.max(alphaMax,alpha)
      if(rgbChanged)changedRgbPixelCount++
      if(alpha>0)changedAlphaPixelCount++
      if(rgbChanged||alpha>0)changedPixelCount++
    }
    return {dimensions:{width:first.width,height:first.height},pixelCount,meanAbsoluteRgbChannelDifference:rgbSum/(pixelCount*3),maxAbsoluteRgbChannelDifference:rgbMax,changedPixelCount,changedRgbPixelCount,alphaDifferences:{changedPixelCount:changedAlphaPixelCount,meanAbsoluteDifference:alphaSum/pixelCount,maxAbsoluteDifference:alphaMax}}
  },encoded)
  console.log(JSON.stringify({files,browser:await browser.version(),channelScale:'0–255',...comparison},null,2))
} finally { await browser.close() }
