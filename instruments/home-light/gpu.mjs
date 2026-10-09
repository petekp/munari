// Measure the complete lighting redraw, including shadow depth and paper shading.
// The separate bulb/card renderers and CPU work are outside these GPU timestamps.
// Three's trackTimestamp times each render pass: WebGPU's timestamp-query, or
// EXT_disjoint_timer_query_webgl2 on the fallback. A sample is the sum of the
// redraw's passes, so GPU idle time between passes is not included.
import {replaceSource} from './replaceSource.mjs'

export function observeLightingDraw(code,id) {
  if(!id.endsWith('/HomeMasthead.tsx'))return code
  const create='      renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false, depth: true })'
  const begin='      pass.paper?.update(flyer.read())',end='      display.render(pass.scene, pass.camera, pass.paper)'
  code=replaceSource(code,create,'      renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false, depth: true, trackTimestamp: true })\n      window.__homeLightRenderer = renderer')
  return replaceSource(replaceSource(code,begin,'      window.__readPaper = flyer.read\n'+begin),end,end+'\n      window.__homeGpuEnd?.()')
}

export async function measureLightingDraw(page) {
  return page.evaluate(()=>new Promise(resolve=>{
    const renderer=window.__homeLightRenderer,backend=renderer.backend
    const gpuTimer=backend.trackTimestamp===true&&(backend.isWebGPUBackend===true||Boolean(backend.disjoint))
    const gpu=[],times=[]
    let count=0,previous=0,resolving=false,redraws=0
    if(gpuTimer){
      // A resolve maps a buffer; a redraw that arrives while it is pending joins
      // the next resolve, which reports only the latest frame's passes.
      window.__homeGpuEnd=()=>{
        redraws++
        if(resolving||gpu.length>=90)return
        resolving=true
        renderer.resolveTimestampsAsync('render').then(ms=>{if(Number.isFinite(ms)&&ms>0)gpu.push(ms)}).finally(()=>{resolving=false})
      }
    }
    const finish=()=>{
      delete window.__homeGpuEnd
      const disjoint=Boolean(backend.disjoint&&backend.gl.getParameter(backend.disjoint.GPU_DISJOINT_EXT))
      const stats=values=>{const sorted=values.slice(8).sort((a,b)=>a-b);return {samples:sorted.length,p95:sorted[Math.floor(sorted.length*.95)]??null,max:sorted.at(-1)??null}}
      const gpuMs=disjoint?stats([]):stats(gpu)
      resolve({frameMs:stats(times),gpuMs,gpuTimer,disjoint,redraws,backend:backend.isWebGPUBackend===true?'webgpu':'webgl2',gpuStatus:!gpuTimer?'unsupported':disjoint?'disjoint':gpuMs.samples?'measured':'unobserved'})
    }
    const tick=time=>{if(previous)times.push(time-previous);previous=time;if(++count<150)requestAnimationFrame(tick);else finish()}
    requestAnimationFrame(tick)
  }))
}
