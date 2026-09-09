// Paper lighting — shade and cast shadows from the live card's bent grid.
// The receiver draws at display density with real triangle coverage. A sampled
// normal map followed by a 1x overlay made the curl visibly jagged (#53).
// The masthead owns this renderer; the Surface publishes geometry before drawing.

import * as THREE from 'three'
import type { HomeFlyer } from './homeFlyer'
import { createHomePaperMaterial,type HomeLightMaterial } from './homeLight'
import { PAPER_COLUMNS, PAPER_ROWS } from './homePaperLaw'
import { POSTCARD_STANDOFF } from './homeLightLaw'

const NEAR=1, FAR=4096
const VERTEX=/* glsl */`
varying vec3 vPosition;
void main(){
  vPosition=position;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`
const DEPTH=/* glsl */`
uniform float uLightZ;
varying vec3 vPosition;
void main(){gl_FragColor=vec4(uLightZ-vPosition.z,1.0,0.0,1.0);}
`

export function createPaperLighting(renderer: THREE.WebGLRenderer, material: HomeLightMaterial) {
  if(!renderer.extensions.has('EXT_color_buffer_float')) return null
  // Only cast shadows use a sampled map; the visible receiver stays geometry.
  // The fitted 1024px shadow map is filtered in light space (decision #51).
  const shadow=new THREE.WebGLRenderTarget(1024,1024,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter})
  shadow.texture.colorSpace=THREE.NoColorSpace
  const geometry=new THREE.PlaneGeometry(1,1,PAPER_COLUMNS,PAPER_ROWS)
  const position=geometry.getAttribute('position')
  if(!(position instanceof THREE.BufferAttribute))throw new Error('Paper map requires a position buffer')
  position.setUsage(THREE.DynamicDrawUsage)
  const projectionW=new THREE.BufferAttribute(new Float32Array(position.count),1)
  projectionW.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute('projectionW',projectionW)
  const surfaceMaterial=createHomePaperMaterial(material)
  const depthMaterial=new THREE.ShaderMaterial({vertexShader:VERTEX,fragmentShader:DEPTH,uniforms:{uLightZ:material.uniforms.uLightHeight},side:THREE.DoubleSide,toneMapped:false})
  const mesh=new THREE.Mesh(geometry,surfaceMaterial)
  mesh.frustumCulled=false
  const scene=new THREE.Scene();scene.add(mesh)
  const view=new THREE.OrthographicCamera(0,1,0,1,NEAR,FAR)
  view.position.z=1000;view.updateMatrixWorld(true)
  const lightCamera=new THREE.PerspectiveCamera(90,1,NEAR,FAR)
  const savedColor=new THREE.Color(), previousLight=new THREE.Vector3(Infinity,Infinity,Infinity)
  let lastFlat='', dirty=true
  const u=material.uniforms
  u.uPaperShadow.value=shadow.texture

  return {
    update(flyer: HomeFlyer | null) {
      if(!flyer){u.uPaperReady.value=0;lastFlat='';return}
      const anchor=flyer.kind==='page' ? flyer.element.getBoundingClientRect() : flyer.paper.anchor
      const flat=flyer.kind==='page'||flyer.paper.height===POSTCARD_STANDOFF
      const key=flat ? `${anchor.x},${anchor.y},${anchor.width},${anchor.height}` : ''
      dirty=!flat||key!==lastFlat
      lastFlat=key
      if(dirty){
        for(let row=0;row<=PAPER_ROWS;row++)for(let col=0;col<=PAPER_COLUMNS;col++){
          const i=row*(PAPER_COLUMNS+1)+col
          if(flat)position.setXYZ(i,anchor.x+col/PAPER_COLUMNS*anchor.width,anchor.y+row/PAPER_ROWS*anchor.height,POSTCARD_STANDOFF)
          else if(flyer.kind==='scene')position.setXYZ(i,flyer.paper.vertices[i*4]!,flyer.paper.vertices[i*4+1]!,flyer.paper.vertices[i*4+2]!)
          const w=!flat&&flyer.kind==='scene' ? flyer.paper.vertices[i*4+3]! : 1
          projectionW.setX(i,w>1?w:1000-position.getZ(i))
        }
        position.needsUpdate=true;projectionW.needsUpdate=true
        geometry.computeVertexNormals()
      }
      const lx=u.uLight.value.x+u.uFrameOrigin.value.x,ly=u.uLight.value.y+u.uFrameOrigin.value.y,lz=u.uLightHeight.value
      const lightChanged=lx!==previousLight.x||ly!==previousLight.y||lz!==previousLight.z
      if(!dirty&&!lightChanged&&u.uPaperReady.value)return
      const target=renderer.getRenderTarget(),alpha=renderer.getClearAlpha()
      renderer.getClearColor(savedColor)
      renderer.setClearColor(0,0)
      try{
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,minDepth=Infinity
        for(let i=0;i<position.count;i++){
          const depth=Math.max(2,lz-position.getZ(i)),x=(position.getX(i)-lx)/depth,y=(position.getY(i)-ly)/depth
          minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minDepth=Math.min(minDepth,depth)
        }
        // Grazing rays spread the bulb's footprint along the shadow. Leave
        // that ellipse room outside the caster bounds instead of clipping it.
        const radius=u.uLightRadius.value/minDepth
        const padX=radius*Math.hypot(1,Math.max(Math.abs(minX),Math.abs(maxX)))+.02
        const padY=radius*Math.hypot(1,Math.max(Math.abs(minY),Math.abs(maxY)))+.02
        minX-=padX;maxX+=padX;minY-=padY;maxY+=padY
        lightCamera.position.set(lx,ly,lz);lightCamera.updateMatrixWorld(true)
        lightCamera.projectionMatrix.makePerspective(minX*NEAR,maxX*NEAR,maxY*NEAR,minY*NEAR,NEAR,FAR)
        lightCamera.projectionMatrixInverse.copy(lightCamera.projectionMatrix).invert()
        u.uPaperShadowMatrix.value.multiplyMatrices(lightCamera.projectionMatrix,lightCamera.matrixWorldInverse)
        u.uPaperShadowRange.value.set(maxX-minX,maxY-minY)
        mesh.material=depthMaterial;renderer.setRenderTarget(shadow);renderer.render(scene,lightCamera)
        previousLight.set(lx,ly,lz)
        u.uPaperReady.value=1
      }finally{renderer.setRenderTarget(target);renderer.setClearColor(savedColor,alpha)}
    },
    render(){
      if(!u.uPaperReady.value)return
      const origin=u.uFrameOrigin.value,size=u.uResolution.value
      view.left=origin.x;view.right=origin.x+size.x;view.top=origin.y;view.bottom=origin.y+size.y;view.updateProjectionMatrix()
      const clear=renderer.autoClear
      renderer.autoClear=false
      try{renderer.clearDepth();mesh.material=surfaceMaterial;renderer.render(scene,view)}
      finally{renderer.autoClear=clear}
    },
    invalidate(){lastFlat='';previousLight.set(Infinity,Infinity,Infinity);u.uPaperReady.value=0},
    dispose(){
      u.uPaperReady.value=0;u.uPaperShadow.value=null
      geometry.dispose();surfaceMaterial.dispose();depthMaterial.dispose();shadow.dispose()
    },
  }
}
