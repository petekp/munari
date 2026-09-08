// Light display — soft page shadows and crisp paper edges in one multiplier.
// The broad field stays at CSS-pixel density. Paper draws over it at native
// density with multisample coverage, fixing the coarse overlay edge (#53).
import * as THREE from 'three'
import type {HomeLightMaterial} from './homeLight'
import type {createPaperLighting} from './homePaperLighting'

export function createHomeLightDisplay(renderer:THREE.WebGLRenderer,light:HomeLightMaterial){
  const page=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter})
  const material=new THREE.ShaderMaterial({
    uniforms:{uPage:new THREE.Uniform(page.texture)},depthTest:false,depthWrite:false,toneMapped:false,
    vertexShader:/* glsl */`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
    fragmentShader:/* glsl */`uniform sampler2D uPage;varying vec2 vUv;void main(){gl_FragColor=texture2D(uPage,vUv);}`,
  })
  const geometry=new THREE.PlaneGeometry(2,2),mesh=new THREE.Mesh(geometry,material)
  mesh.frustumCulled=false
  const scene=new THREE.Scene();scene.add(mesh)
  const camera=new THREE.Camera()
  return {
    render(source:THREE.Scene,sourceCamera:THREE.Camera,paper:ReturnType<typeof createPaperLighting>){
      const size=light.uniforms.uResolution.value,target=renderer.getRenderTarget()
      page.setSize(Math.max(1,Math.ceil(size.x)),Math.max(1,Math.ceil(size.y)))
      try{
        renderer.setRenderTarget(page);renderer.render(source,sourceCamera)
        renderer.setRenderTarget(target);renderer.render(scene,camera)
        paper?.render()
      }finally{renderer.setRenderTarget(target)}
    },
    dispose(){page.dispose();material.dispose();geometry.dispose()},
  }
}
