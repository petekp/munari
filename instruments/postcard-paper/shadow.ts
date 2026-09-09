// Curvature must change both the cast shadow and occlusion on the paper itself.
import * as THREE from 'three'
import {createHomeLightMaterial,maskTexture,setHomeInkMask,setHomeLightFrame} from '../../apps/lab/src/scenes/home/homeLight'
import {packShadowDistances} from '../../apps/lab/src/scenes/home/homeShadowField'
import {createPaperLighting} from '../../apps/lab/src/scenes/home/homePaperLighting'
import {createPaperDrawFrame} from '../../apps/lab/src/scenes/home/homePaperFrame'
import {PAPER_COLUMNS,PAPER_ROWS,PAPER_WIDTH,PAPER_HEIGHT,paperPoint,type PaperShape} from '../../apps/lab/src/scenes/home/homePaperLaw'

const width=900,height=600,ratio=devicePixelRatio
const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true})
renderer.setPixelRatio(ratio);renderer.setSize(width,height);document.body.append(renderer.domElement)
const material=createHomeLightMaterial(),maps=createPaperLighting(renderer,material)
if(!maps)throw new Error('Floating-point render targets are required for the paper lighting check')
const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10)
camera.position.z=1;scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material))
setHomeLightFrame(material,width,height,780,40,260)
const frame=createPaperDrawFrame();frame.height=52;Object.assign(frame.anchor,{x:100,y:100,width:PAPER_WIDTH,height:PAPER_HEIGHT})
const empty=new THREE.DataTexture(new Uint8Array(4),1,1);empty.needsUpdate=true
const shape:PaperShape={amount:1,bow:.6,curlA:2.2,curlB:.7,twist:0,ripple:0,time:0}
function fill(amount:number){
  for(let row=0;row<=PAPER_ROWS;row++)for(let col=0;col<=PAPER_COLUMNS;col++){
    const p=paperPoint(col/PAPER_COLUMNS*PAPER_WIDTH,row/PAPER_ROWS*PAPER_HEIGHT,{...shape,amount}),i=(row*(PAPER_COLUMNS+1)+col)*4
    frame.vertices.set([p.x+100,p.y+100,p.z+52,1],i)
  }
  maps!.update({kind:'scene',corners:frame.corners,paper:frame})
}
const gl=renderer.getContext()
function pixels(){renderer.render(scene,camera);maps!.render();const data=new Uint8Array(renderer.domElement.width*renderer.domElement.height*4);gl.readPixels(0,0,renderer.domElement.width,renderer.domElement.height,gl.RGBA,gl.UNSIGNED_BYTE,data);return data}
function channel(data:Uint8Array,x:number,y:number){return data[(Math.floor((height-y)*ratio)*renderer.domElement.width+Math.floor(x*ratio))*4]!}
function withoutShadow(){const shadow=material.uniforms.uPaperShadow.value;material.uniforms.uPaperShadow.value=empty;const data=pixels();material.uniforms.uPaperShadow.value=shadow;return data}
fill(0);const flat=pixels(),flatLit=withoutShadow()
fill(1);const curved=pixels(),curvedLit=withoutShadow()
// A heading plane above every paper sample would shadow the entire card if
// page casters leaked through its foreground layer. Its pixels must not change.
const heading=maskTexture({data:packShadowDistances(new Float32Array([-256])),width:1,height:1,rect:{x:0,y:0,width,height}})
setHomeInkMask(material,heading,{x:0,y:0,width,height},3)
const withHeading=pixels()
setHomeInkMask(material,null,null);heading.dispose()
let changedCast=0,selfShadow=0,flatSelfShadow=0,maxSelfDifference=0,maxHeadingDifference=0
for(let y=0;y<height;y+=2)for(let x=0;x<width;x+=2){
  if(x>=80&&x<=550&&y>=80&&y<=390)continue
  if(Math.abs(channel(flat,x,y)-channel(curved,x,y))>8)changedCast++
}
for(let row=0;row<12;row++)for(let col=0;col<16;col++){
  const x=(.2+col/15*.5)*PAPER_WIDTH,y=(.3+row/11*.5)*PAPER_HEIGHT
  const p=paperPoint(x,y,shape)
  maxHeadingDifference=Math.max(maxHeadingDifference,Math.abs(channel(withHeading,p.x+100,p.y+100)-channel(curved,p.x+100,p.y+100)))
  const difference=channel(curvedLit,p.x+100,p.y+100)-channel(curved,p.x+100,p.y+100)
  if(difference>8)selfShadow++
  if(channel(flatLit,x+100,y+100)-channel(flat,x+100,y+100)>2)flatSelfShadow++
  maxSelfDifference=Math.max(maxSelfDifference,difference)
}
const result={changedCast,selfShadow,flatSelfShadow,maxSelfDifference,maxHeadingDifference,error:gl.getError()}
declare global{interface Window{__paperShadowProof:typeof result}}
window.__paperShadowProof=result
pixels()
