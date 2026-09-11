// Texture resize and alpha proof — read actual WebGL pixels after source updates.
import * as THREE from 'three'
import {createSurfaceSourceRuntime} from '../../packages/react/src/primitives/surface/surfaceSourceRuntime'

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
const content = document.createElement('div')
content.style.cssText = 'width:128px;height:64px;background:linear-gradient(to right,rgb(255,0,0) 50%,rgb(0,255,0) 50%)'
const runtime = createSurfaceSourceRuntime({content,size:[128,64],resolution:new URLSearchParams(location.search).has('pinned')?1:'auto',mirrorU:false,pixelRatio:1,onError:error=>{throw error}})
const renderer = new THREE.WebGLRenderer({alpha:true,antialias:false})
renderer.setPixelRatio(devicePixelRatio)
renderer.setSize(512,256)
document.body.append(renderer.domElement)
const scene = new THREE.Scene()
const camera = new THREE.OrthographicCamera(-1,1,.5,-.5,.1,10)
camera.position.z = 2
const texture = runtime.texture()!
const material = new THREE.MeshBasicMaterial({map:texture,toneMapped:false,premultipliedAlpha:true})
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,1),material))
const gl = renderer.getContext()
const rows:unknown[] = []
let disposals = 0
texture.addEventListener('dispose',()=>{disposals++})
const sample = (name:string) => {
  renderer.render(scene,camera)
  const left = new Uint8Array(4),right = new Uint8Array(4)
  gl.readPixels(Math.round(gl.drawingBufferWidth*.25),Math.round(gl.drawingBufferHeight*.5),1,1,gl.RGBA,gl.UNSIGNED_BYTE,left)
  gl.readPixels(Math.round(gl.drawingBufferWidth*.75),Math.round(gl.drawingBufferHeight*.5),1,1,gl.RGBA,gl.UNSIGNED_BYTE,right)
  const row = {name,left:[...left],right:[...right],error:gl.getError(),disposals,store:[runtime.source.canvas.width,runtime.source.canvas.height],generation:runtime.uploadedGeneration()}
  rows.push(row)
  return row
}
async function run() {
  const deadline = performance.now()+5000
  while(!runtime.source.painted()) {
    if(performance.now()>deadline)throw new Error('Capture did not paint')
    await frame()
  }
  runtime.frame();sample('initial')
  for(const [index,tier] of [2,.5,3,1].entries()) {
    const count=runtime.source.paintCount()
    content.style.background=index%2===0?'linear-gradient(to right,rgb(0,0,255) 50%,rgb(255,255,0) 50%)':'linear-gradient(to right,rgb(255,0,0) 50%,rgb(0,255,0) 50%)'
    runtime.source.repaint()
    const paintDeadline=performance.now()+5000
    while(runtime.source.paintCount()===count){
      if(performance.now()>paintDeadline)throw new Error('Updated capture did not paint')
      await frame()
    }
    await frame()
    runtime.frame()
    runtime.proposeTier(1,tier)
    sample(`late-${tier}`)
    await frame()
    runtime.frame();sample(`following-${tier}`)
  }
  return rows
}
declare global {interface Window {__textureProof:ReturnType<typeof run>}}
window.__textureProof = run()
