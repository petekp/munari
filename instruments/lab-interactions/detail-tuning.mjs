// Live tuning regressions — mounted fields, debug controls and held keys.
// The observer is injected only into the served test copy; production has no
// new globals. It reads the actual render targets and CPU routing callback.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
import {setChromeViewport} from '../chromeViewport.mjs'

const root=path.resolve(import.meta.dirname,'../..')
const output=process.env.API_PROOF_OUTPUT??path.join(tmpdir(),'munari-api/detail-tuning')
await mkdir(output,{recursive:true})
const observer={name:'observe-ink-field',enforce:'pre',transform(code,id){
  if(!id.endsWith('/refractionField.tsx'))return
  assert.ok(code.includes('  return rig\n'))
  return code.replace('  return rig\n',`  window.__inkFieldProof = {rig,config:cfg,stage:()=>[stageW,stageH]}
  return rig
`)
}}
const server=await createServer({root:path.join(root,'apps/lab'),configFile:path.join(root,'apps/lab/vite.config.ts'),plugins:[observer],cacheDir:path.join(output,'.vite'),server:{host:'127.0.0.1',port:0},logLevel:'warn'})
await server.listen()
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1',defaultViewport:null,args:['--enable-features=CanvasDrawElement','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']})
const results=[]
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
const read=page=>page.evaluate(()=>{
  const {rig,config,stage}=window.__inkFieldProof
  return {identity:rig.target.texture.uuid,size:[rig.target.width,rig.target.height],spread:[rig.spreadPair[0].width,rig.spreadPair[0].height],stage:stage(),config:{...config.current},detail:rig.material.uniforms.uDetail.value,decay:rig.spreadMaterial.uniforms.uDecay.value,samples:[[.13,.37],[.32,.47],[.67,.21],[.73,.67]].map(([u,v])=>rig.apertureAt(u,v))}
})
async function setRange(page,selector,value) {
  await page.$eval(selector,(node,value)=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,String(value))
    node.dispatchEvent(new Event('input',{bubbles:true}))
  },value)
  await frames(page)
}
try {
  for(const scene of ['refraction','gallery','glass','crystal']) {
    const page=await browser.newPage(),errors=[]
    page.on('pageerror',error=>errors.push(String(error)))
    await setChromeViewport(page,{width:1200,height:900})
    try {
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scene=${scene}&framed&glass=sdf`,{waitUntil:'load'})
      assert.equal(await page.evaluate(()=>'drawElementImage' in CanvasRenderingContext2D.prototype),true)
      let result
      if(scene==='glass') {
        await page.waitForFunction(()=>window.__glass?.mode()==='sdf'&&window.__glass.blobs().length>0)
        const before=await page.evaluate(()=>window.__glass.blobs().length)
        const set=await page.evaluate(()=>window.__glass.setBlobs(0))
        await frames(page);await frames(page)
        assert.equal(await page.evaluate(()=>window.__glass.blobs().length),0)
        await page.evaluate(n=>window.__glass.setBlobs(n),before);await frames(page)
        assert.equal(await page.evaluate(()=>window.__glass.blobs().length),before)
        await page.evaluate(()=>window.__glass.setBlobs(NaN));await frames(page)
        assert.equal(await page.evaluate(()=>window.__glass.blobs().length),before)
        result={before,set,restored:before}
      } else if(scene==='crystal') {
        await page.waitForSelector('.crystal-page')
        const parked=()=>page.$eval('.crystal-page',el=>el.getAttribute('data-parked'))
        const states=[await parked()]
        for(let i=0;i<3;i++){await page.keyboard.down('p');await frames(page);states.push(await parked())}
        await page.keyboard.up('p');await page.keyboard.press('p');await frames(page);states.push(await parked())
        assert.deepEqual(states,[null,'true','true','true',null])
        result={states}
      } else {
        await page.waitForSelector('input[aria-label="crossing position"]')
        await setRange(page,'input[aria-label="crossing position"]',.5)
        await page.waitForFunction(()=>window.__inkFieldProof?.rig.material.uniforms.tSource.value)
        await page.evaluate(()=>document.fonts.ready)
        await frames(page)
        const before=await read(page)
        // Open the actual native tweak controls; each input must reach the
        // existing mounted field, without changing source or target identity.
        await page.evaluate(()=>{
          const opener=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='tweaks')
          if(!opener)throw new Error('The scene has no tweak-panel opener')
          opener.click()
        })
        await page.evaluate(()=>document.querySelectorAll('button[aria-expanded="false"]').forEach(el=>el.click()))
        const definitions=await page.evaluate(async scene=>{
          const module=await import(`/src/scenes/${scene}/${scene}Tuning.ts`)
          return module[`${scene.toUpperCase()}_GROUPS`].flatMap(group=>group.knobs)
        },scene)
        const rows=[]
        for(const key of ['fieldPx','spreadPx','spreadReachPx','apertureDetail','apertureFloor','apertureCeil','apertureGamma','frontRounding']) {
          const knob=definitions.find(knob=>knob.key===key)
          assert.ok(knob,key)
          const old=(await read(page)).config[key]
          const proposed=old===knob.max?old-knob.step*3:old+knob.step*3
          const next=Math.min(knob.max,Math.max(knob.min,knob.min+Math.round((proposed-knob.min)/knob.step)*knob.step))
          await page.evaluate(label=>{
            const row=[...document.querySelectorAll('label')].find(el=>el.firstElementChild?.textContent===label)
            if(!row)throw new Error(`Missing tuning control: ${label}`)
            row.querySelector('input').id='detail-tuning-input'
          },knob.label)
          await setRange(page,'#detail-tuning-input',next)
          await page.waitForFunction(({key,next})=>Math.abs(window.__inkFieldProof.config.current[key]-next)<1e-8,{timeout:5000}, {key,next})
          const after=await read(page)
          assert.equal(after.identity,before.identity)
          assert.deepEqual(after.size,after.stage.map(n=>Math.max(4,Math.round(n/after.config.fieldPx))))
          assert.deepEqual(after.spread,after.stage.map(n=>Math.max(4,Math.round(n/after.config.spreadPx))))
          assert.equal(after.detail,after.config.apertureDetail)
          rows.push({key,old,next,size:after.size,spread:after.spread,detail:after.detail})
          await page.$eval('#detail-tuning-input',el=>el.removeAttribute('id'))
        }
        // Gamma must change the CPU pointer field by the same power law as
        // the fragment shader while the underlying targets stay mounted.
        const gammaBefore=await read(page)
        await page.evaluate(()=>{window.__inkFieldProof.config.current.apertureGamma*=1.5})
        await frames(page)
        const gammaAfter=await read(page)
        assert.ok(gammaBefore.samples.some(value=>value>.05&&value<.95))
        for(let i=0;i<gammaBefore.samples.length;i++)assert.ok(Math.abs(gammaAfter.samples[i]-gammaBefore.samples[i]**1.5)<1e-4)
        await page.evaluate(gamma=>{window.__inkFieldProof.config.current.apertureGamma=gamma},gammaBefore.config.apertureGamma)
        result={before,rows,gammaBefore:gammaBefore.samples,gammaAfter:gammaAfter.samples}
      }
      assert.deepEqual(errors,[])
      await page.screenshot({path:path.join(output,`${scene}.png`)})
      results.push({scene,...result});console.log(JSON.stringify(results.at(-1)))
      await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2))
    } catch(error) {
      await page.screenshot({path:path.join(output,`${scene}-failure.png`)})
      await writeFile(path.join(output,'failure.json'),JSON.stringify({scene,error:String(error),errors},null,2))
      throw error
    } finally {await page.close()}
  }
} finally {await browser.close();await server.close()}
