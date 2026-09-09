// Lamp — a refracting SDF glass shell, luminous coil, metal socket and live cord.
// The positioned bulb remains the shadow source. Cord simulation and optics
// share its frame; HomeMasthead owns rendering and the captured backdrop (#52).
import * as THREE from 'three'
import {CORD_POINTS,createLampCord,stepLampCord} from './homeLampCordLaw'
import {LAMP_GLASS_VERTEX,LAMP_GLASS_FRAGMENT} from './homeLampGlassShaders'
import type {LampBackdrop} from './homeLampBackdrop'
import {LIGHT_HEIGHT} from './homeLightLaw'

export const BULB_RADIUS=30
const SOCKET_RADIUS=10
const SOCKET_HEIGHT=15
const CORD_RADIUS=1.1
const CORD_ATTACHMENT=55
const TUBE_SEGMENTS=120
const TUBE_SIDES=8

export interface LightBulb {
  readonly group:THREE.Group
  update(x:number,y:number,dt:number,still:boolean,viewportHeight:number,lightDistance:number):void
  dispose():void
}

function glowTexture(){
  const size=128,data=new Uint8Array(size*size*4)
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const radius=Math.hypot((x+.5-size/2)/(size/2),(y+.5-size/2)/(size/2)),i=(y*size+x)*4
    const glow=Math.exp(-radius*radius*10)*Math.max(0,1-radius)
    data[i]=255;data[i+1]=255;data[i+2]=255;data[i+3]=Math.round(glow*255)
  }
  const texture=new THREE.DataTexture(data,size,size);texture.colorSpace=THREE.SRGBColorSpace
  texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true
  return texture
}

export function createLightBulb(backdrop:LampBackdrop):LightBulb{
  const group=new THREE.Group(),body=new THREE.Group();group.add(body);group.visible=false
  const uniforms={...backdrop.uniforms,uEye:new THREE.Uniform(new THREE.Vector3()),uMvp:new THREE.Uniform(new THREE.Matrix4()),uLampViewport:new THREE.Uniform(new THREE.Vector4()),uPixelWidth:new THREE.Uniform(.5),uLightDistance:new THREE.Uniform(LIGHT_HEIGHT),uIor:new THREE.Uniform(1.5),uDispersion:new THREE.Uniform(.006),uDisplacement:new THREE.Uniform(.08),uEmission:new THREE.Uniform(1)}
  const glass=new THREE.ShaderMaterial({vertexShader:LAMP_GLASS_VERTEX,fragmentShader:LAMP_GLASS_FRAGMENT,uniforms,side:THREE.BackSide,transparent:true,premultipliedAlpha:true,depthWrite:true,toneMapped:false})
  const envelope=new THREE.BoxGeometry(70,102,70);envelope.translate(0,8,0)
  const globe=new THREE.Mesh(envelope,glass);globe.renderOrder=2;body.add(globe)
  const inverse=new THREE.Matrix4(),cameraPosition=new THREE.Vector3()
  globe.onBeforeRender=(renderer,_scene,camera)=>{
    inverse.copy(globe.matrixWorld).invert()
    cameraPosition.setFromMatrixPosition(camera.matrixWorld)
    uniforms.uEye.value.copy(cameraPosition).applyMatrix4(inverse)
    uniforms.uMvp.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(globe.matrixWorld)
    uniforms.uPixelWidth.value=1/renderer.getPixelRatio()
    const view=camera instanceof THREE.PerspectiveCamera?camera.view:null,size=backdrop.uniforms.uViewport.value
    if(view?.enabled)uniforms.uLampViewport.value.set(view.offsetX,view.fullHeight-view.offsetY-view.height,view.width,view.height)
    else uniforms.uLampViewport.value.set(0,0,size.x,size.y)
  }
  const metal=new THREE.MeshPhysicalMaterial({color:0x25231e,roughness:.28,metalness:.85,envMapIntensity:1.7})
  const socket=new THREE.Mesh(new THREE.CylinderGeometry(SOCKET_RADIUS*.85,SOCKET_RADIUS,SOCKET_HEIGHT,40),metal)
  socket.position.y=47;body.add(socket)
  const rings=Array.from({length:4},(_,i)=>{
    const ring=new THREE.Mesh(new THREE.TorusGeometry(9.6-i*.15,.65,10,48),metal)
    ring.rotation.x=Math.PI/2;ring.position.y=41+i*3.6;body.add(ring);return ring
  })
  const cordMaterial=new THREE.MeshStandardMaterial({color:0x181711,roughness:.72,metalness:.05})
  const cord=createLampCord(),points=Array.from({length:CORD_POINTS},()=>new THREE.Vector3())
  const curve=new THREE.CatmullRomCurve3(points),tube=new THREE.BufferGeometry()
  const position=new THREE.BufferAttribute(new Float32Array((TUBE_SEGMENTS+1)*TUBE_SIDES*3),3),normal=new THREE.BufferAttribute(new Float32Array((TUBE_SEGMENTS+1)*TUBE_SIDES*3),3)
  position.setUsage(THREE.DynamicDrawUsage);normal.setUsage(THREE.DynamicDrawUsage);tube.setAttribute('position',position);tube.setAttribute('normal',normal)
  const indices=[]
  for(let i=0;i<TUBE_SEGMENTS;i++)for(let j=0;j<TUBE_SIDES;j++){const a=i*TUBE_SIDES+j,b=i*TUBE_SIDES+(j+1)%TUBE_SIDES,c=a+TUBE_SIDES,d=b+TUBE_SIDES;indices.push(a,c,b,b,c,d)}
  tube.setIndex(indices)
  const wire=new THREE.Mesh(tube,cordMaterial);wire.frustumCulled=false;group.add(wire)
  const centre=new THREE.Vector3(),tangent=new THREE.Vector3(),side=new THREE.Vector3()
  const haloTexture=glowTexture()
  const halos=[{size:144,opacity:.4,color:0xfff4d4},{size:320,opacity:.26,color:0xffffff}].map(({size,opacity,color})=>{
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:haloTexture,color,blending:THREE.AdditiveBlending,transparent:true,opacity,depthTest:false,depthWrite:false,toneMapped:false}))
    // Camera glare belongs over the glass and background, rather than behind
    // the opaque refracted image. Emission controls both the coil and its glare.
    sprite.onBeforeRender=()=>{sprite.material.opacity=opacity*uniforms.uEmission.value}
    sprite.position.y=-6;sprite.scale.setScalar(size);sprite.renderOrder=3;body.add(sprite);return sprite
  })
  group.add(new THREE.PointLight(0xffb756,3,240,1.6))
  return {
    group,
    update(x,y,dt,still,viewportHeight,lightDistance){
      group.visible=true;group.position.set(x,y,0);uniforms.uLightDistance.value=lightDistance
      const screenY=viewportHeight-y,last=CORD_POINTS*2-2
      const angle=still&&cord.initialized
        ? Math.atan2(x-cord.anchorX,screenY+100)
        : cord.initialized ? -Math.atan2(cord.points[last-2]!-cord.points[last]!,cord.points[last+1]!-cord.points[last-1]!) : 0
      body.rotation.z=still?angle:THREE.MathUtils.damp(body.rotation.z,angle,14,Math.max(0,dt))
      // Pin the actual socket. Trimming a cord solved to the bulb centre left
      // a hooked join whenever the socket lagged behind a quick drag.
      const socketX=x-Math.sin(body.rotation.z)*CORD_ATTACHMENT,socketY=screenY-Math.cos(body.rotation.z)*CORD_ATTACHMENT
      stepLampCord(cord,socketX,socketY,dt,still)
      for(let i=0;i<CORD_POINTS;i++)points[i]!.set(cord.points[i*2]!-x,screenY-cord.points[i*2+1]!,0)
      for(let i=0;i<=TUBE_SEGMENTS;i++){
        const t=i/TUBE_SEGMENTS
        curve.getPoint(t,centre);curve.getTangent(t,tangent);side.set(-tangent.y,tangent.x,0).normalize()
        for(let j=0;j<TUBE_SIDES;j++){
          const angle=j/TUBE_SIDES*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle),k=i*TUBE_SIDES+j
          normal.setXYZ(k,side.x*c,side.y*c,s)
          position.setXYZ(k,centre.x+CORD_RADIUS*side.x*c,centre.y+CORD_RADIUS*side.y*c,CORD_RADIUS*s)
        }
      }
      position.needsUpdate=true;normal.needsUpdate=true
    },
    dispose(){envelope.dispose();glass.dispose();socket.geometry.dispose();for(const ring of rings)ring.geometry.dispose();metal.dispose();tube.dispose();cordMaterial.dispose();haloTexture.dispose();for(const halo of halos)halo.material.dispose()},
  }
}

const CAMERA_DISTANCE=1600
export function fitBulbCamera(camera:THREE.PerspectiveCamera,width:number,height:number){
  camera.aspect=width/height;camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(height/(2*CAMERA_DISTANCE)))
  camera.near=1;camera.far=CAMERA_DISTANCE*3;camera.position.set(width/2,height/2,CAMERA_DISTANCE)
  camera.up.set(0,1,0);camera.lookAt(width/2,height/2,0);camera.updateProjectionMatrix()
}
