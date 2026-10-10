// Lamp frame — one lamp draw, read in the task that drew it, with its GPU errors.
// Loaded into the page. A WebGPU canvas is readable only until the browser
// presents it, and WebGPU reports validation errors after `render()` returns,
// so error scopes span the draw and are popped after the read.
import {readCanvasRect} from '../canvasPixels.ts'

/**
 * The canvas's backing store. The WebGL 2 fallback reports Chrome's clamped
 * drawing buffer. WebGPU never shrinks the canvas texture; a canvas beyond the
 * device limit cannot be configured, so the limit is the readable size.
 */
export function canvasBuffer(renderer){
  const {gl,device}=renderer.backend,canvas=renderer.domElement
  if(gl)return [gl.drawingBufferWidth,gl.drawingBufferHeight]
  const limit=device.limits.maxTextureDimension2D
  return [Math.min(canvas.width,limit),Math.min(canvas.height,limit)]
}

/** Redraw the lamp and resolve with `read(canvas, readCanvasRect)` from that frame. */
export function drawLamp(read){
  const renderer=window.__lampRenderer,{gl,device}=renderer.backend
  if(gl?.isContextLost())return Promise.reject(new Error('Lamp context is lost'))
  if(device){device.pushErrorScope('out-of-memory');device.pushErrorScope('validation')}
  const errors=()=>device
    ? Promise.all([device.popErrorScope(),device.popErrorScope()]).then(found=>found.filter(Boolean).map(error=>error.message))
    : Promise.resolve(gl.getError()===gl.NO_ERROR?[]:['WebGL error'])
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{delete window.__lampRendered;void errors();reject(new Error('Lamp did not draw'))},5000)
    window.__lampRendered=canvas=>{
      clearTimeout(timeout);delete window.__lampRendered
      let value,failure=null
      try{value=read(canvas,readCanvasRect)}catch(error){failure=error}
      void errors().then(found=>{
        if(failure)reject(failure)
        else if(found.length)reject(new Error(`Lamp draw raised GPU errors: ${found.join('; ')}`))
        else resolve(value)
      },reject)
    }
    window.__lampRedraw()
  })
}
