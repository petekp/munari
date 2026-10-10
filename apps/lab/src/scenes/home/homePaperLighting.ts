// Paper lighting — shade and cast shadows from the live card's bent grid.
// The receiver draws at display density with real triangle coverage. A sampled
// normal map followed by a 1x overlay made the curl visibly jagged (#53).
// The masthead owns this renderer; the Surface publishes geometry before drawing.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type DirectRenderPipeline, type WebGPURenderer } from 'three/webgpu'
import { cameraProjectionMatrix, modelViewMatrix, positionGeometry, vec4 } from 'three/tsl'
import type { HomeFlyer } from './homeFlyer'
import { createHomePaperMaterial,setHomePaperShadow,type HomeLightMaterial } from './homeLight'
import { PAPER_COLUMNS, PAPER_ROWS } from './homePaperLaw'
import { POSTCARD_STANDOFF } from './homeLightLaw'

const NEAR=1, FAR=4096

// The light's view of the sheet, sampled later at uv = ndc * .5 + .5. Clip y
// is negated so that sample reads what this pass drew there (passMaterial).
function createDepthMaterial(material: HomeLightMaterial){
  const depth=new MeshBasicNodeMaterial({side:THREE.DoubleSide})
  const clip=cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionGeometry,1))
  depth.vertexNode=vec4(clip.x,clip.y.negate(),clip.z,clip.w)
  // A render-target pass: no canvas conversion follows, so these raw values land.
  depth.outputNode=vec4(material.values.lightHeight.sub(positionGeometry.z),1,0,1)
  return depth
}

export function createPaperLighting(renderer: WebGPURenderer, pipeline: DirectRenderPipeline, material: HomeLightMaterial) {
  const context=renderer.getContext()
  // WebGPU always renders half floats; the WebGL 2 fallback needs the extension.
  if(context instanceof WebGL2RenderingContext&&!context.getExtension('EXT_color_buffer_float')) return null
  // Only cast shadows use a sampled map; the visible receiver stays geometry.
  // The fitted 1024px shadow map is filtered in light space (decision #51).
  const shadow=new THREE.RenderTarget(1024,1024,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter})
  shadow.texture.colorSpace=THREE.NoColorSpace
  const geometry=new THREE.PlaneGeometry(1,1,PAPER_COLUMNS,PAPER_ROWS)
  const position=geometry.getAttribute('position')
  if(!(position instanceof THREE.BufferAttribute))throw new Error('Paper map requires a position buffer')
  position.setUsage(THREE.DynamicDrawUsage)
  const projectionW=new THREE.BufferAttribute(new Float32Array(position.count),1)
  projectionW.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute('projectionW',projectionW)
  const surfaceMaterial=createHomePaperMaterial(material)
  const depthMaterial=createDepthMaterial(material)
  const mesh=new THREE.Mesh(geometry,surfaceMaterial)
  mesh.frustumCulled=false
  const scene=new THREE.Scene();scene.add(mesh)
  const view=new THREE.OrthographicCamera(0,1,0,1,NEAR,FAR)
  view.position.z=1000;view.updateMatrixWorld(true)
  const lightCamera=new THREE.PerspectiveCamera(90,1,NEAR,FAR)
  // Three re-derives a camera's projection from its fov on the first render in
  // another coordinate system, which would replace the fitted frustum below.
  lightCamera.coordinateSystem=renderer.coordinateSystem
  const savedColor=new THREE.Color(), previousLight=new THREE.Vector3(Infinity,Infinity,Infinity)
  let lastFlat='', dirty=true
  const u=material.values
  setHomePaperShadow(material,shadow.texture)

  return {
    update(flyer: HomeFlyer | null) {
      if(!flyer){u.paperReady.value=0;lastFlat='';return}
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
      const lx=u.light.value.x+u.frameOrigin.value.x,ly=u.light.value.y+u.frameOrigin.value.y,lz=u.lightHeight.value
      const lightChanged=lx!==previousLight.x||ly!==previousLight.y||lz!==previousLight.z
      if(!dirty&&!lightChanged&&u.paperReady.value)return
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
        const radius=u.lightRadius.value/minDepth
        const padX=radius*Math.hypot(1,Math.max(Math.abs(minX),Math.abs(maxX)))+.02
        const padY=radius*Math.hypot(1,Math.max(Math.abs(minY),Math.abs(maxY)))+.02
        minX-=padX;maxX+=padX;minY-=padY;maxY+=padY
        lightCamera.position.set(lx,ly,lz);lightCamera.updateMatrixWorld(true)
        lightCamera.projectionMatrix.makePerspective(minX*NEAR,maxX*NEAR,maxY*NEAR,minY*NEAR,NEAR,FAR,renderer.coordinateSystem)
        lightCamera.projectionMatrixInverse.copy(lightCamera.projectionMatrix).invert()
        u.paperShadowMatrix.value.multiplyMatrices(lightCamera.projectionMatrix,lightCamera.matrixWorldInverse)
        u.paperShadowRange.value.set(maxX-minX,maxY-minY)
        mesh.material=depthMaterial;renderer.setRenderTarget(shadow);renderer.render(scene,lightCamera)
        previousLight.set(lx,ly,lz)
        u.paperReady.value=1
      }finally{renderer.setRenderTarget(target);renderer.setClearColor(savedColor,alpha)}
    },
    render(){
      if(!u.paperReady.value)return
      const origin=u.frameOrigin.value,size=u.resolution.value
      view.left=origin.x;view.right=origin.x+size.x;view.top=origin.y;view.bottom=origin.y+size.y;view.updateProjectionMatrix()
      // Keep the composite and clear only depth. A bare clearDepth() would run
      // outside the pipeline, through Three's frame target and output pass.
      const clearColor=renderer.autoClearColor,clearDepth=renderer.autoClearDepth,clearStencil=renderer.autoClearStencil
      renderer.autoClearColor=false;renderer.autoClearDepth=true;renderer.autoClearStencil=false
      try{mesh.material=surfaceMaterial;pipeline.render(scene,view)}
      finally{renderer.autoClearColor=clearColor;renderer.autoClearDepth=clearDepth;renderer.autoClearStencil=clearStencil}
    },
    invalidate(){lastFlat='';previousLight.set(Infinity,Infinity,Infinity);u.paperReady.value=0},
    dispose(){
      u.paperReady.value=0;setHomePaperShadow(material,null)
      geometry.dispose();surfaceMaterial.dispose();depthMaterial.dispose();shadow.dispose()
    },
  }
}
