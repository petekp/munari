// The actual home shader with known heights, foreground paper receivers.
import * as THREE from 'three'
import {WebGPURenderer} from 'three/webgpu'
import {uniform} from 'three/tsl'
import {createHomeLightMaterial,maskTexture,setHomeFlyerUniform,setHomeInkMask,setHomeLightFrame,setHomeReliefMask} from '../../apps/lab/src/scenes/home/homeLight'
import {packShadowDistances,shadowDistances} from '../../apps/lab/src/scenes/home/homeShadowField'
import {GLYPH_STANDOFF,RAISED_STANDOFF} from '../../apps/lab/src/scenes/home/homeLightLaw'
import {readTargetRows} from '../../apps/lab/src/lib/passTargets'
import {gpuErrors} from '../canvasPixels'

const width=512,height=320
// run.mjs edits the served homeLight.ts and homePaperNodes.ts to read these
// switches. Each selects an observation output; 0 leaves the shader's own result.
const observe={visibility:uniform(0),parallel:uniform(0)}
window.__homeLightObserve=observe
const renderer=new WebGPURenderer({antialias:false})
await renderer.init()
const errors=gpuErrors(renderer)
// The masthead draws this pass into a render target too (homeLightDisplay.ts).
const target=new THREE.RenderTarget(width,height,{depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter})
const material=createHomeLightMaterial()
const defaults={height:material.values.lightHeight.value,radius:material.values.lightRadius.value,elevation:RAISED_STANDOFF}
const scene=new THREE.Scene()
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material))
const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10)
camera.position.z=1
const rect={x:0,y:0,width,height}
function field(x:number,y:number,w:number,h:number) {
  const pixels=new Uint8ClampedArray(width*height*4)
  for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)pixels[(row*width+col)*4+3]=255
  return maskTexture({data:packShadowDistances(shadowDistances(pixels,width,height,1)),width,height,rect})
}
const bar=field(260,100,8,120)
const block=field(220,100,60,120)
const receiver=field(430,110,80,130)
setHomeLightFrame(material,width,height,100,160,100)
material.values.lightRadius.value=.1
type Image=(x:number,y:number)=>number[]
// The pass maps uv.y = 1 - y/height, and readTargetRows lists rows by v, so
// page row y is row height-1-y, as it was from the bottom of the WebGL canvas.
async function draw():Promise<Image> {
  renderer.setRenderTarget(target)
  renderer.render(scene,camera)
  renderer.setRenderTarget(null)
  const rows=await readTargetRows(renderer,target)
  return (x,y)=>{const i=((height-1-y)*width+x)*4;return [rows[i]!,rows[i+1]!,rows[i+2]!,rows[i+3]!]}
}
function render(caster:THREE.Texture,raised:THREE.Texture|null=null,elevation=22) {
  setHomeInkMask(material,caster,rect,elevation/GLYPH_STANDOFF)
  setHomeReliefMask(material,raised,raised?rect:null)
  return draw()
}
function readRow(image:Image,start=290) {
  const result=[]
  for(let x=start;x<start+60;x++)result.push(image(x,160)[0]!)
  return result
}
function card(z:number,x=290) {
  setHomeFlyerUniform(material,new Float32Array([x,110,z,x+110,110,z,x+110,240,z,x,240,z]),0,0)
}
let image=await render(bar)
const gap=image(274,160)
const projected=image(309,160)
// Coincident sheets at the same elevation must not double-darken one ray.
setHomeInkMask(material,bar,rect,RAISED_STANDOFF/GLYPH_STANDOFF)
image=await draw()
const overlapStart=Math.floor(100+(260-100)*100/(100-RAISED_STANDOFF))-5
const single=readRow(image,overlapStart)
const duplicate=readRow(await render(bar,bar,RAISED_STANDOFF),overlapStart)
const page=readRow(await render(block,null,64),430)
const raised=readRow(await render(block,receiver,64),430)
const hard=readRow(await render(bar))
material.values.lightRadius.value=30
const soft=readRow(await render(bar))
material.values.lightRadius.value=.1
card(36)
image=await render(block)
// Even raised heading ink stays behind the foreground card's lighting (#50).
const highCard=image(350,160)
const highCardGap=image(320,160)
material.values.selectionCount.value=1
material.values.selection[0]!.set(220,100,60,120)
material.values.selectionLift.value=44
image=await render(block)
const selectedOnCard=image(350,160)
const selectedGap=image(320,160)
setHomeFlyerUniform(material,null,0,0)
const selectedOnPage=(await render(block))(480,160)
material.values.selectionCount.value=0
material.values.selectionLift.value=0
const ordinaryOnPage=(await render(block))(480,160)
// Display order chooses the foreground paper even where heading ink overlaps.
// A point light below the ink isolates this choice from the ink's cast shadow.
material.values.selectionCount.value=0
material.values.selectionLift.value=0
setHomeLightFrame(material,width,height,100,160,18)
card(12,240)
const coveredPaper=(await render(bar))(264,160)
const plainPaper=(await render(field(0,0,0,0)))(264,160)
// Read the shader's visibility before tint/exposure. This separates the
// geometric penumbra from the light pool's brightness and native page colours.
observe.visibility.value=1
setHomeFlyerUniform(material,null,0,0)
material.values.selectionCount.value=0
material.values.selectionLift.value=0
setHomeReliefMask(material,null,null)
const edge=field(40,80,160,160)
async function penumbra(elevation:number,radius:number,lightX=100,lightHeight=100){
  setHomeLightFrame(material,width,height,lightX,160,lightHeight)
  material.values.lightRadius.value=radius
  setHomeInkMask(material,edge,rect,elevation/GLYPH_STANDOFF)
  const image=await draw()
  const boundary=lightX+(200-lightX)*lightHeight/(lightHeight-elevation)
  const start=Math.max(201,Math.floor(boundary)-80),end=Math.min(width-1,Math.ceil(boundary)+80)
  return Array.from({length:end-start},(_,i)=>image(start+i,160)[0]!)
}
const closeSoft=await penumbra(6,30),farSoft=await penumbra(22,30),farHard=await penumbra(22,.1)
const nearLamp=await penumbra(defaults.elevation,defaults.radius,100,defaults.height),distantLamp=await penumbra(defaults.elevation,defaults.radius,-700,defaults.height)
// Flatten only the emitter as a control; keep the real masks and light height.
observe.parallel.value=1
const parallelNear=await penumbra(defaults.elevation,defaults.radius,100,defaults.height),parallelDistant=await penumbra(defaults.elevation,defaults.radius,-700,defaults.height)
const result={defaults,gap,projected,single,duplicate,page,raised,hard,soft,highCard,highCardGap,selectedOnCard,selectedGap,selectedOnPage,ordinaryOnPage,coveredPaper,plainPaper,closeSoft,farSoft,farHard,nearLamp,distantLamp,parallelNear,parallelDistant,backend:renderer.coordinateSystem===THREE.WebGPUCoordinateSystem?'webgpu':'webgl2',error:errors()}
declare global {interface Window {__homeShadowProof:typeof result;__homeLightObserve:typeof observe}}
window.__homeShadowProof=result
