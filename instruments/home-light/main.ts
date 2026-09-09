// The actual home shader with known heights, foreground paper receivers.
import * as THREE from 'three'
import {createHomeLightMaterial,maskTexture,setHomeFlyerUniform,setHomeInkMask,setHomeLightFrame,setHomeReliefMask} from '../../apps/lab/src/scenes/home/homeLight'
import {packShadowDistances,shadowDistances} from '../../apps/lab/src/scenes/home/homeShadowField'
import {GLYPH_STANDOFF,RAISED_STANDOFF} from '../../apps/lab/src/scenes/home/homeLightLaw'

const width=512,height=320
const renderer=new THREE.WebGLRenderer({antialias:false})
renderer.setSize(width,height)
document.body.append(renderer.domElement)
const material=createHomeLightMaterial()
const defaults={height:material.uniforms.uLightHeight.value,radius:material.uniforms.uLightRadius.value,elevation:RAISED_STANDOFF}
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
material.uniforms.uLightRadius.value=.1
function render(caster:THREE.Texture,raised:THREE.Texture|null=null,elevation=22) {
  setHomeInkMask(material,caster,rect,elevation/GLYPH_STANDOFF)
  setHomeReliefMask(material,raised,raised?rect:null)
  renderer.render(scene,camera)
}
const gl=renderer.getContext()
function pixel(x:number,y:number) {
  const out=new Uint8Array(4)
  gl.readPixels(x,height-1-y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,out)
  return [...out]
}
function readRow(start=290) {
  const result=[]
  for(let x=start;x<start+60;x++)result.push(pixel(x,160)[0])
  return result
}
function card(z:number,x=290) {
  setHomeFlyerUniform(material,new Float32Array([x,110,z,x+110,110,z,x+110,240,z,x,240,z]),0,0)
}
render(bar)
const gap=pixel(274,160)
const projected=pixel(309,160)
// Coincident sheets at the same elevation must not double-darken one ray.
setHomeInkMask(material,bar,rect,RAISED_STANDOFF/GLYPH_STANDOFF)
renderer.render(scene,camera)
const overlapStart=Math.floor(100+(260-100)*100/(100-RAISED_STANDOFF))-5
const single=readRow(overlapStart)
render(bar,bar,RAISED_STANDOFF)
const duplicate=readRow(overlapStart)
render(block,null,64)
const page=readRow(430)
render(block,receiver,64)
const raised=readRow(430)
render(bar)
const hard=readRow()
material.uniforms.uLightRadius.value=30
render(bar)
const soft=readRow()
material.uniforms.uLightRadius.value=.1
card(36)
render(block)
// Even raised heading ink stays behind the foreground card's lighting (#50).
const highCard=pixel(350,160)
const highCardGap=pixel(320,160)
material.uniforms.uSelectionCount.value=1
material.uniforms.uSelection.value[0]!.set(220,100,60,120)
material.uniforms.uSelectionLift.value=44
render(block)
const selectedOnCard=pixel(350,160)
const selectedGap=pixel(320,160)
setHomeFlyerUniform(material,null,0,0)
render(block)
const selectedOnPage=pixel(480,160)
material.uniforms.uSelectionCount.value=0
material.uniforms.uSelectionLift.value=0
render(block)
const ordinaryOnPage=pixel(480,160)
// Display order chooses the foreground paper even where heading ink overlaps.
// A point light below the ink isolates this choice from the ink's cast shadow.
material.uniforms.uSelectionCount.value=0
material.uniforms.uSelectionLift.value=0
setHomeLightFrame(material,width,height,100,160,18)
card(12,240)
render(bar)
const coveredPaper=pixel(264,160)
render(field(0,0,0,0))
const plainPaper=pixel(264,160)
// Read the shader's visibility before tint/exposure. This separates the
// geometric penumbra from the light pool's brightness and native page colours.
const shadedOutput='gl_FragColor = vec4(clamp(vec3(shade*(1.0-contact)*pool)*tint,0.0,1.0),1.0);'
if(!material.fragmentShader.includes(shadedOutput))throw new Error('Shadow visibility observation point changed')
material.fragmentShader=material.fragmentShader.replace(shadedOutput,'gl_FragColor = vec4(vec3(visibility),1.0);')
material.needsUpdate=true
setHomeFlyerUniform(material,null,0,0)
material.uniforms.uSelectionCount.value=0
material.uniforms.uSelectionLift.value=0
setHomeReliefMask(material,null,null)
const edge=field(40,80,160,160)
function penumbra(elevation:number,radius:number,lightX=100,lightHeight=100){
  setHomeLightFrame(material,width,height,lightX,160,lightHeight)
  material.uniforms.uLightRadius.value=radius
  setHomeInkMask(material,edge,rect,elevation/GLYPH_STANDOFF)
  renderer.render(scene,camera)
  const boundary=lightX+(200-lightX)*lightHeight/(lightHeight-elevation)
  const start=Math.max(201,Math.floor(boundary)-80),end=Math.min(width-1,Math.ceil(boundary)+80)
  return Array.from({length:end-start},(_,i)=>pixel(start+i,160)[0]!)
}
const closeSoft=penumbra(6,30),farSoft=penumbra(22,30),farHard=penumbra(22,.1)
const nearLamp=penumbra(defaults.elevation,defaults.radius,100,defaults.height),distantLamp=penumbra(defaults.elevation,defaults.radius,-700,defaults.height)
// Flatten only the emitter as a control; keep the real masks and light height.
const sphericalRay='return basis*vec3(samplePoint*scale,cosine);'
if(!material.fragmentShader.includes(sphericalRay))throw new Error('Bulb sampling observation point changed')
material.fragmentShader=material.fragmentShader.replace(sphericalRay,'return normalize(basis[2]+vec3(samplePoint*sqrt(1.0-cosineLimit*cosineLimit),0.0));')
material.needsUpdate=true
const parallelNear=penumbra(defaults.elevation,defaults.radius,100,defaults.height),parallelDistant=penumbra(defaults.elevation,defaults.radius,-700,defaults.height)
const result={defaults,gap,projected,single,duplicate,page,raised,hard,soft,highCard,highCardGap,selectedOnCard,selectedGap,selectedOnPage,ordinaryOnPage,coveredPaper,plainPaper,closeSoft,farSoft,farHard,nearLamp,distantLamp,parallelNear,parallelDistant,error:gl.getError()}
declare global {interface Window {__homeShadowProof:typeof result}}
window.__homeShadowProof=result
