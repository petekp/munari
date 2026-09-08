// Measure the complete lighting redraw, including shadow depth and paper shading.
// The separate bulb/card renderers and CPU work are outside this GPU query.
import assert from 'node:assert/strict'
import {replaceSource} from './replaceSource.mjs'

export function observeLightingDraw(code,id) {
  if(!id.endsWith('/HomeMasthead.tsx'))return code
  const begin='      pass.paper?.update(readHomeFlyer())',end='      display.render(pass.scene, pass.camera, pass.paper)'
  assert.ok(code.includes(begin)&&code.includes(end),'Lighting draw observation points changed')
  return replaceSource(replaceSource(code,begin,'      window.__homeGpuStart?.()\n'+begin),end,end+'\n      window.__homeGpuEnd?.()')
}

export async function measureLightingDraw(page) {
  return page.evaluate(()=>new Promise(resolve=>{
    const gl=document.querySelector('.home-light-host canvas').getContext('webgl2')
    const extension=gl.getExtension('EXT_disjoint_timer_query_webgl2'),queries=[],times=[]
    let current=null,count=0,previous=0
    if(extension){
      window.__homeGpuStart=()=>{if(queries.length<90){current=gl.createQuery();gl.beginQuery(extension.TIME_ELAPSED_EXT,current)}}
      window.__homeGpuEnd=()=>{if(current){gl.endQuery(extension.TIME_ELAPSED_EXT);queries.push(current);current=null}}
    }
    const finish=()=>{
      delete window.__homeGpuStart;delete window.__homeGpuEnd
      const disjoint=extension&&gl.getParameter(extension.GPU_DISJOINT_EXT)
      const gpu=extension&&!disjoint?queries.filter(query=>gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)).map(query=>gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6):[]
      queries.forEach(query=>gl.deleteQuery(query))
      const stats=values=>{const sorted=values.slice(8).sort((a,b)=>a-b);return {samples:sorted.length,p95:sorted[Math.floor(sorted.length*.95)]??null,max:sorted.at(-1)??null}}
      resolve({frameMs:stats(times),gpuMs:stats(gpu),gpuTimer:Boolean(extension),disjoint:Boolean(disjoint)})
    }
    const tick=time=>{if(previous)times.push(time-previous);previous=time;if(++count<150)requestAnimationFrame(tick);else finish()}
    requestAnimationFrame(tick)
  }))
}
