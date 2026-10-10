// Headline shader — thin-film colour follows a rippled surface and the page lamp.
// Glyph coverage stays independent of the animated material, preserving sharp type.
import * as THREE from 'three'
import {MeshBasicNodeMaterial,type Node,type UniformNode} from 'three/webgpu'
import {Discard,Fn,abs,cos,dot,exp,length,max,mix,normalize,positionWorld,pow,sRGBTransferOETF,sin,texture,uniform,uv,vec2,vec3,vec4} from 'three/tsl'
import {encodedOutput} from '@petepetrash/munari'

/** The word's live values, written by the headline's draw. */
export interface HeadlineValues {
  readonly light:UniformNode<'vec3',THREE.Vector3>
  readonly time:UniformNode<'float',number>
  readonly aspect:UniformNode<'float',number>
  readonly pointer:UniformNode<'vec2',THREE.Vector2>
  readonly rippleAge:UniformNode<'float',number>
}

export function createHeadlineValues():HeadlineValues{
  return {light:uniform(new THREE.Vector3()),time:uniform(0),aspect:uniform(1),pointer:uniform(new THREE.Vector2(.5,.5)),rippleAge:uniform(1000)}
}

export function createHeadlineMaterial(ink:THREE.Texture,v:HeadlineValues):MeshBasicNodeMaterial{
  const material=new MeshBasicNodeMaterial({transparent:true,premultipliedAlpha:true,depthWrite:false})
  material.outputNode=Fn(()=>{
    const at=uv()
    // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
    const alpha=(texture(ink,at) as Node<'vec4'>).a.toVar()
    Discard(alpha.lessThan(.002))
    const p=at.sub(.5).mul(vec2(v.aspect,1)).toVar()
    const a=p.x.mul(3.2).add(p.y.mul(4)).add(v.time).toVar()
    const b=p.y.mul(7).sub(p.x.mul(1.7)).sub(v.time.mul(.65)).toVar()
    const offset=at.sub(v.pointer).mul(vec2(v.aspect,1)).toVar()
    const radius=length(offset).toVar()
    const ring=exp(v.rippleAge.mul(-.9).sub(abs(radius.sub(v.rippleAge.mul(.65))).mul(4)))
    const ripple=offset.div(max(radius,.001)).mul(cos(radius.mul(20).sub(v.rippleAge.mul(9)))).mul(ring)
    const normal=normalize(vec3(vec2(cos(a).mul(-.32).add(cos(b).mul(.11)),cos(a).mul(-.40).sub(cos(b).mul(.42))).add(ripple),1)).toVar()
    const light=normalize(v.light.sub(positionWorld)).toVar()
    const film=sin(a).mul(1.4).add(sin(b).mul(.7)).add(dot(normal,light).mul(5))
    const colour=vec3(.5).add(cos(vec3(film).add(vec3(0,2.1,4.2))).mul(.5)).toVar()
    colour.assign(mix(vec3(.035,.009,.065),colour.mul(.48),.76))
    const specular=pow(max(dot(normal,normalize(light.add(vec3(0,0,1)))),0),36)
    colour.addAssign(vec3(.65,.72,.85).mul(specular).mul(.7))
    // The straight colour is encoded first and then multiplied by alpha, so
    // the result is premultiplied in the canvas's encoding (decisions.md #72).
    // SAFETY: Three declares this TSL function's layout as vec3 to vec3; its
    // published types leave the result untyped.
    const encoded=sRGBTransferOETF(colour) as Node<'vec3'>
    return encodedOutput(vec4(encoded.mul(alpha),alpha))
  })()
  return material
}
