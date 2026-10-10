// Light display — soft page shadows and crisp paper edges in one multiplier.
// The broad field stays at CSS-pixel density. Paper draws over it at native
// density with multisample coverage, fixing the coarse overlay edge (#53).
import * as THREE from 'three'
import {MeshBasicNodeMaterial,type DirectRenderPipeline,type Node,type WebGPURenderer} from 'three/webgpu'
import {positionGeometry,texture,vec4} from 'three/tsl'
import {encodedOutput} from '@petepetrash/munari'
import type {HomeLightMaterial} from './homeLight'
import type {createPaperLighting} from './homePaperLighting'

export function createHomeLightDisplay(renderer:WebGPURenderer,pipeline:DirectRenderPipeline,light:HomeLightMaterial){
  const page=new THREE.RenderTarget(1,1,{depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter})
  const material=new MeshBasicNodeMaterial({depthTest:false,depthWrite:false})
  // Depth 0.5 sits inside both backends' clip range; the copy ignores the camera.
  material.vertexNode=vec4(positionGeometry.xy,.5,1)
  // The light pass drew with clip y negated, so uv() reads it upright. Alpha
  // is 1, so decoding the raw multiplier lands it on the canvas unchanged.
  // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
  material.outputNode=encodedOutput(texture(page.texture) as Node<'vec4'>)
  const geometry=new THREE.PlaneGeometry(2,2),mesh=new THREE.Mesh(geometry,material)
  mesh.frustumCulled=false
  const scene=new THREE.Scene();scene.add(mesh)
  // The copy ignores the camera, but Three updates its projection before drawing.
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1)
  return {
    render(source:THREE.Scene,sourceCamera:THREE.Camera,paper:ReturnType<typeof createPaperLighting>){
      const size=light.values.resolution.value,target=renderer.getRenderTarget()
      page.setSize(Math.max(1,Math.ceil(size.x)),Math.max(1,Math.ceil(size.y)))
      try{
        renderer.setRenderTarget(page);renderer.render(source,sourceCamera)
        renderer.setRenderTarget(target);pipeline.render(scene,camera)
        paper?.render()
      }finally{renderer.setRenderTarget(target)}
    },
    dispose(){page.dispose();material.dispose();geometry.dispose()},
  }
}
