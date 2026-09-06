// Check the actual postcard at rest, with the browser's natural display density.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import puppeteer from 'puppeteer-core'
import {textureClarity} from '../textureClarity.mjs'
const output=process.env.API_PROOF_OUTPUT??path.join(tmpdir(),'munari-api/postcard-sharpness')
await mkdir(output,{recursive:true})
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,defaultViewport:null,args:['--enable-features=CanvasDrawElement','--window-size=1280,980','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']})
try{
 const page=await browser.newPage();await page.bringToFront()
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])
 await page.goto(`${process.env.API_PROOF_URL??'http://127.0.0.1:5173'}/?scene=home&framed`,{waitUntil:'load'})
 await page.waitForSelector('.home-hero-holder [data-api-live]');await page.evaluate(()=>document.fonts.ready)
 await page.evaluate(()=>{const holder=document.querySelector('.home-hero-holder');document.querySelector('.home-page').scrollTop+=holder.getBoundingClientRect().top-180})
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
 const clip=await page.$eval('.home-hero-holder',element=>{const r=element.getBoundingClientRect();return{x:r.x+20,y:r.y+20,width:r.width-40,height:r.height-40}})
 const before=await page.screenshot({clip,encoding:'base64'});await writeFile(path.join(output,'native.png'),Buffer.from(before,'base64'))
 await page.click('.home-hero-row button')
 await page.waitForFunction(()=>document.querySelector('.home-hero-row .home-lamp').dataset.gl==='true')
 const after=await page.screenshot({clip,encoding:'base64'});await writeFile(path.join(output,'mesh.png'),Buffer.from(after,'base64'))
 const pixels=await textureClarity(page,before,after)
 const source=await page.evaluate(()=>{const source=document.querySelector('.home-hero-holder [data-api-live]').closest('canvas'),canvas=document.querySelector('.home-canvas canvas'),r=canvas.getBoundingClientRect();return {dpr:devicePixelRatio,captureDensity:[source.width/parseFloat(source.style.width),source.height/parseFloat(source.style.height)],canvasDensity:[canvas.width/r.width,canvas.height/r.height],captureVisible:source.style.visibility}})
 assert.equal(source.captureVisible,'hidden')
 await page.$eval('.home-canvas canvas',canvas=>{canvas.style.visibility='hidden'})
 const hidden=await page.screenshot({clip,encoding:'base64'}),negative=await textureClarity(page,before,hidden)
 await page.$eval('.home-canvas canvas',canvas=>{canvas.style.visibility=''})
 const result={...source,...pixels,hiddenMeshEnergy:negative.edgeEnergyRatio,browser:await browser.version()}
 await writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
 assert.ok(pixels.edgeEnergyRatio>=.95&&pixels.edgeEnergyRatio<=1.05)
 assert.ok(negative.edgeEnergyRatio<.2,'The native page must not conceal a missing mesh')
}finally{await browser.close()}
