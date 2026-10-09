// Lamp glass — a displaced hollow SDF shell with four optical interfaces.
// Native page colour is refracted through the shell; a hot coil emits inside it.
// Reflection-only fallback keeps the lamp usable without HTML capture (#52).
import * as THREE from 'three'
import {MeshBasicNodeMaterial,type Node,type TextureNode,type UniformNode} from 'three/webgpu'
import {Break,Discard,Fn,If,Loop,abs,bool,clamp,cos,depth,dot,exp,float,length,max,min,mix,normalize,positionGeometry,pow,reflect,refract,sRGBTransferOETF,sin,smoothstep,sqrt,step,uniform,vec2,vec3,vec4} from 'three/tsl'
import {encodedOutput} from '@petepetrash/munari'

// The capture layers and the shader's unrolled layer loop use the same limit.
export const LAMP_CANVAS_LAYERS=4

type Float=Node<'float'>
type Vec2=Node<'vec2'>
type Vec3=Node<'vec3'>
type Vec4=Node<'vec4'>

/** The captured page and the canvases drawn over it, written by the backdrop. */
export interface LampBackdropValues {
  readonly page:TextureNode
  readonly pageReady:UniformNode<'float',number>
  readonly viewport:UniformNode<'vec2',THREE.Vector2>
  readonly pageLight:TextureNode
  readonly pageLightRect:UniformNode<'vec4',THREE.Vector4>
  readonly layers:readonly TextureNode[]
  readonly layerRects:readonly UniformNode<'vec4',THREE.Vector4>[]
  readonly layerCount:UniformNode<'int',number>
}

/** The shell's view and optics, written by the bulb before each draw. */
export interface LampGlassValues {
  readonly eye:UniformNode<'vec3',THREE.Vector3>
  readonly mvp:UniformNode<'mat4',THREE.Matrix4>
  readonly lampViewport:UniformNode<'vec4',THREE.Vector4>
  readonly pixelWidth:UniformNode<'float',number>
  readonly lightDistance:UniformNode<'float',number>
  readonly ior:UniformNode<'float',number>
  readonly dispersion:UniformNode<'float',number>
  readonly displacement:UniformNode<'float',number>
  readonly emission:UniformNode<'float',number>
}

export function createLampGlassValues(lightDistance:number):LampGlassValues{
  return {eye:uniform(new THREE.Vector3()),mvp:uniform(new THREE.Matrix4()),lampViewport:uniform(new THREE.Vector4()),pixelWidth:uniform(.5),lightDistance:uniform(lightDistance),ior:uniform(1.5),dispersion:uniform(.006),displacement:uniform(.08),emission:uniform(1)}
}

// ── the shell ───────────────────────────────────────────────────────────

function ellipsoid(p:Vec3,r:Vec3):Float{const a=length(p.div(r)),b=length(p.div(r.mul(r)));return a.mul(a.sub(1)).div(max(b,.00001))}
function smoothUnion(a:Float,b:Float,k:number):Float{const h=max(float(k).sub(abs(a.sub(b))),0).div(k);return min(a,b).sub(h.mul(h).mul(k*.25))}
// Real functions, emitted once: the marches and normals call them dozens of times.
const glassDistanceFn=Fn(([p,displacement]:[Vec3,Float])=>{
  const body=ellipsoid(p.sub(vec3(0,-3,0)),vec3(29.5,30.5,29.5))
  const neck=ellipsoid(p.sub(vec3(0,25.5,0)),vec3(9,17,9))
  const wave=sin(p.y.mul(.23).add(sin(p.x.mul(.11)))).mul(sin(p.z.mul(.19))).add(sin(dot(p,vec3(.14,.09,.21))).mul(.35))
  return smoothUnion(body,neck,8).add(wave.mul(displacement))
},{p:'vec3',displacement:'float',return:'float'})
const glassNormalFn=Fn(([p,displacement]:[Vec3,Float])=>{
  const distance=(q:Vec3)=>glassDistanceFn(q,displacement)
  const e=vec2(.045,0)
  return normalize(vec3(distance(p.add(e.xyy)).sub(distance(p.sub(e.xyy))),distance(p.add(e.yxy)).sub(distance(p.sub(e.yxy))),distance(p.add(e.yyx)).sub(distance(p.sub(e.yyx)))))
},{p:'vec3',displacement:'float',return:'vec3'})

function fresnel(ray:Vec3,normal:Vec3,from:Float,into:Float):Float{
  const c=clamp(dot(ray,normal).negate(),0,1).toVar(),eta=from.div(into),s=eta.mul(eta).mul(float(1).sub(c.mul(c))).toVar()
  const t=sqrt(float(1).sub(s)).toVar()
  const rs=from.mul(c).sub(into.mul(t)).div(max(.00001,from.mul(c).add(into.mul(t))))
  const rp=into.mul(c).sub(from.mul(t)).div(max(.00001,into.mul(c).add(from.mul(t))))
  return s.greaterThanEqual(1).select(float(1),rs.mul(rs).add(rp.mul(rp)).mul(.5))
}
function studio(ray:Vec3):Vec3{
  const colour=mix(vec3(.012,.017,.022),vec3(.12,.14,.17),smoothstep(-.7,.8,ray.y))
  const left=vec2(dot(ray,normalize(vec3(.88,0,.47))),ray.y).toVar()
  const strip=exp(pow(abs(left.x.add(.17)).div(.08),6).negate()).mul(smoothstep(-.6,-.35,left.y)).mul(float(1).sub(smoothstep(.6,.85,left.y)))
  const top=pow(max(dot(ray,normalize(vec3(.25,.8,.55))),0),80)
  const side=pow(max(dot(ray,normalize(vec3(.75,.12,.65))),0),150)
  return colour.add(vec3(5,5.8,7).mul(strip)).add(vec3(9,7.5,5.2).mul(top)).add(vec3(2,2.3,2.8).mul(side))
}
function srgbToLinear(c:Vec3):Vec3{return mix(c.div(12.92),pow(c.add(.055).div(1.055),vec3(2.4)),step(vec3(.04045),c))}
function outsideUnit(at:Vec2){return at.x.lessThan(0).or(at.y.lessThan(0)).or(at.x.greaterThan(1)).or(at.y.greaterThan(1))}
function layerPixel(image:TextureNode,rect:Vec4,p:Vec2):Vec4{
  const at=p.sub(rect.xy).div(rect.zw).toVar()
  // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
  return outsideUnit(at).select(vec4(0),image.sample(at) as Vec4)
}

// Walk the wall to the next interface. 1 reaches the cavity; 0 exits outside.
function crossWall(g:LampGlassValues,p:Vec3,ray:Vec3):Float{
  const result=float(-1).toVar()
  Loop(48,()=>{
    const outer=glassDistanceFn(p,g.displacement).toVar(),inner=outer.add(1.15).toVar()
    If(inner.lessThan(.004),()=>{result.assign(1);Break()})
    If(outer.greaterThan(-.004),()=>{result.assign(0);Break()})
    p.addAssign(ray.mul(max(.008,min(outer.negate(),inner).mul(.78))))
  })
  return result
}
function crossCavity(g:LampGlassValues,p:Vec3,ray:Vec3):Node<'bool'>{
  const result=bool(false).toVar()
  Loop(64,()=>{
    const distance=glassDistanceFn(p,g.displacement).add(1.15).negate().toVar()
    If(distance.lessThan(.004),()=>{result.assign(true);Break()})
    p.addAssign(ray.mul(max(.012,distance.mul(.8))))
  })
  return result
}
function raySegment(p:Vec3,ray:Vec3,reach:Float,a:Vec3,b:Vec3):Float{
  const edge=b.sub(a).toVar(),w=p.sub(a).toVar()
  const lengthSquared=dot(edge,edge).toVar(),along=dot(ray,edge).toVar(),denominator=max(.0001,lengthSquared.sub(along.mul(along)))
  const t=clamp(dot(edge,w).sub(along.mul(dot(ray,w))).div(denominator),0,1).toVar()
  const s=clamp(dot(a.add(edge.mul(t)).sub(p),ray),0,reach).toVar()
  t.assign(clamp(dot(p.add(ray.mul(s)).sub(a),edge).div(lengthSquared),0,1))
  return length(p.add(ray.mul(s)).sub(a).sub(edge.mul(t)))
}
function coilPoint(t:Float):Vec3{return vec3(t.mul(22).sub(11),float(-8).add(sin(t.mul(3.14159265)).mul(4)).add(cos(t.mul(62.831853)).mul(.85)),sin(t.mul(62.831853)).mul(.85))}
function filament(g:LampGlassValues,p:Vec3,ray:Vec3,reach:Float,leads:Float):Vec3{
  const distance=float(1000).toVar()
  const a=coilPoint(float(0)).toVar()
  Loop({start:1,end:48,condition:'<=',type:'int'},({i})=>{
    const b=coilPoint(float(i).div(48)).toVar()
    distance.assign(min(distance,raySegment(p,ray,reach,a,b)));a.assign(b)
  })
  const wire=float(1).sub(smoothstep(.16,g.pixelWidth.mul(.8).add(.16),distance))
  const halo=exp(distance.mul(distance).negate().div(3.2)).add(exp(distance.mul(distance).negate().div(40)).mul(.045))
  const lead=min(raySegment(p,ray,reach,vec3(-11,19,0),coilPoint(float(0))),raySegment(p,ray,reach,vec3(11,19,0),coilPoint(float(1))))
  leads.assign(float(1).sub(smoothstep(.17,g.pixelWidth.mul(.7).add(.17),lead)))
  return vec3(22,12,4.5).mul(wire).add(vec3(2.4,.9,.16).mul(halo)).mul(g.emission)
}
function refractedChain(ray:Vec3,n0:Vec3,n1:Vec3,n2:Vec3,n3:Vec3,ior:Float,cavity:Node<'bool'>):Vec3{
  const out=refract(refract(ray,n0,float(1).div(ior)),n1,ior).toVar()
  const blocked=length(out).lessThan(.1).toVar()
  If(blocked.not().and(cavity),()=>{out.assign(refract(refract(out,n2,float(1).div(ior)),n3,ior))})
  return blocked.select(vec3(0),out)
}

// ── the backdrop seen through it ────────────────────────────────────────

function backdrop(b:LampBackdropValues,at:Vec2):Vec3{
  const result=srgbToLinear(vec3(.894,.925,.23)).toVar()
  If(outsideUnit(at).not(),()=>{
    const p=at.mul(b.viewport).toVar()
    // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
    const colour=(b.page.sample(at) as Vec4).rgb.toVar()
    for(let i=0;i<LAMP_CANVAS_LAYERS;i++){
      If(b.layerCount.greaterThan(i),()=>{
        const layer=layerPixel(b.layers[i]!,b.layerRects[i]!,p).toVar()
        colour.assign(layer.rgb.add(colour.mul(float(1).sub(layer.a))))
      })
    }
    If(b.pageLightRect.z.greaterThan(0),()=>{colour.mulAssign(layerPixel(b.pageLight,b.pageLightRect,p).rgb)})
    result.assign(srgbToLinear(colour))
  })
  return result
}
function backgroundAlong(g:LampGlassValues,b:LampBackdropValues,from:Vec3,ray:Vec3):Vec3{
  const result=studio(ray).mul(.1).toVar()
  If(ray.z.lessThan(-.002),()=>{
    const p=from.add(ray.mul(g.lightDistance.negate().sub(from.z).div(ray.z))).toVar()
    const clip=g.mvp.mul(vec4(p,1)).toVar()
    const pixel=clip.xy.div(clip.w).mul(.5).add(.5).mul(g.lampViewport.zw).add(g.lampViewport.xy)
    result.assign(backdrop(b,pixel.div(b.viewport)))
  })
  return result
}

/**
 * The shell's material. `coordinateSystem` is the renderer's: WebGPU's clip
 * depth already spans 0..1, WebGL's spans -1..1.
 */
export function createLampGlassMaterial(g:LampGlassValues,b:LampBackdropValues,coordinateSystem:THREE.CoordinateSystem):MeshBasicNodeMaterial{
  const material=new MeshBasicNodeMaterial({side:THREE.BackSide,transparent:true,premultipliedAlpha:true,depthWrite:true,toneMapped:false})
  material.outputNode=Fn(()=>{
    const glassDistance=(q:Vec3)=>glassDistanceFn(q,g.displacement)
    const glassNormal=(q:Vec3)=>glassNormalFn(q,g.displacement)
    const ior=g.ior
    const ray=normalize(positionGeometry.sub(g.eye)).toVar(),offset=g.eye.sub(vec3(0,6,0)).toVar()
    const b0=dot(offset,ray).toVar(),disc=b0.mul(b0).sub(dot(offset,offset)).add(48*48).toVar()
    Discard(disc.lessThan(0))
    const start=max(0,b0.negate().sub(sqrt(disc))).toVar(),end=b0.negate().add(sqrt(disc)).toVar()
    const travel=start.toVar(),closest=float(1000).toVar()
    const p=g.eye.add(ray.mul(start)).toVar(),nearest=p.toVar()
    const hit=bool(false).toVar()
    Loop(80,()=>{
      p.assign(g.eye.add(ray.mul(travel)));const distance=glassDistance(p).toVar()
      If(distance.lessThan(closest),()=>{closest.assign(distance);nearest.assign(p)})
      If(distance.lessThan(.004),()=>{hit.assign(true);Break()})
      travel.addAssign(max(.008,distance.mul(.74)));If(travel.greaterThan(end),()=>{Break()})
    })
    p.assign(hit.select(p,nearest))
    // A hit says only that the pixel centre is inside. Estimate the ray's signed
    // minimum to retain partial coverage on both sides of the implicit edge.
    const d=glassDistance(p).toVar(),before=glassDistance(p.sub(ray.mul(.5))).toVar(),after=glassDistance(p.add(ray.mul(.5))).toVar()
    const slope=after.sub(before).toVar(),curvature=after.add(before).sub(d.mul(2)).mul(4).toVar()
    const minimum=hit.select(g.pixelWidth.mul(-2),closest).toVar()
    If(curvature.greaterThan(.0001).and(abs(slope).lessThan(.5)),()=>{minimum.assign(max(d.sub(slope.mul(slope).div(curvature.mul(2))),g.pixelWidth.mul(-2)))})
    const pixelWidth=max(minimum.fwidth(),g.pixelWidth.mul(.25))
    const coverage=clamp(float(.5).sub(minimum.div(pixelWidth)),0,1).toVar()
    Discard(coverage.lessThan(.005))
    const front=p.toVar(),n0=glassNormal(front).toVar(),n1=n0.toVar(),n2=n0.toVar(),n3=n0.toVar()
    const emission=vec3(0).toVar(),exitRay=ray.toVar()
    const leads=float(0).toVar(),wallLength=float(0).toVar(),reflection=fresnel(ray,n0,float(1),ior).toVar(),transmission=float(1).sub(reflection).toVar()
    const cavity=bool(false).toVar(),transmitted=bool(false).toVar()
    If(hit,()=>{
      const inGlass=refract(ray,n0,float(1).div(ior)).toVar();p.addAssign(inGlass.mul(.015).sub(n0.mul(.01)))
      const boundary=crossWall(g,p,inGlass).toVar();wallLength.assign(length(p.sub(front)))
      If(boundary.greaterThan(.5),()=>{
        n1.assign(glassNormal(p));const inAir=refract(inGlass,n1,ior).toVar()
        transmission.mulAssign(float(1).sub(fresnel(inGlass,n1,ior,float(1))))
        If(length(inAir).greaterThan(.1),()=>{
          const airStart=p.add(inAir.mul(.015)).sub(n1.mul(.01)).toVar();p.assign(airStart)
          If(crossCavity(g,p,inAir),()=>{
            emission.assign(filament(g,airStart,inAir,length(p.sub(airStart)),leads))
            n2.assign(glassNormal(p).negate());const backGlass=refract(inAir,n2,float(1).div(ior)).toVar(),backStart=p.toVar()
            transmission.mulAssign(float(1).sub(fresnel(inAir,n2,float(1),ior)))
            p.addAssign(backGlass.mul(.015).sub(n2.mul(.01)))
            If(crossWall(g,p,backGlass).equal(0),()=>{
              n3.assign(glassNormal(p).negate());exitRay.assign(refract(backGlass,n3,ior))
              transmission.mulAssign(float(1).sub(fresnel(backGlass,n3,ior,float(1))))
              wallLength.addAssign(length(p.sub(backStart)));cavity.assign(true);transmitted.assign(length(exitRay).greaterThan(.1))
            })
          })
        })
      }).ElseIf(boundary.greaterThan(-.5),()=>{n1.assign(glassNormal(p).negate());exitRay.assign(refract(inGlass,n1,ior));transmission.mulAssign(float(1).sub(fresnel(inGlass,n1,ior,float(1))));transmitted.assign(length(exitRay).greaterThan(.1))})
    })
    reflection.assign(transmitted.select(float(1).sub(transmission),float(1)))
    const colour=vec3(.02,.022,.024).toVar()
    If(transmitted.and(b.pageReady.greaterThan(.5)),()=>{
      const red=refractedChain(ray,n0,n1,n2,n3,ior.sub(g.dispersion),cavity).toVar()
      const blue=refractedChain(ray,n0,n1,n2,n3,ior.add(g.dispersion),cavity).toVar()
      colour.assign(vec3(backgroundAlong(g,b,p,red).r,backgroundAlong(g,b,p,exitRay).g,backgroundAlong(g,b,p,blue).b))
    })
    const absorption=exp(vec3(.0008,.0018,.004).negate().mul(wallLength)).toVar()
    colour.mulAssign(absorption.mul(float(1).sub(reflection)).mul(float(1).sub(leads.mul(.7))))
    const radiance=studio(reflect(ray,n0)).mul(reflection).add(emission.mul(absorption)).toVar()
    // A little filament light scatters through the shell and lights its rim.
    const glowOffset=front.sub(vec3(0,-7,0))
    const internalGlow=g.emission.div(float(1).add(dot(glowOffset,glowOffset).div(400)))
    radiance.addAssign(vec3(.5,.3,.12).mul(internalGlow).mul(float(.2).add(reflection.mul(.8))))
    colour.assign(vec3(1).sub(vec3(1).sub(colour).mul(exp(radiance.negate()))))
    const alpha=coverage.toVar()
    If(b.pageReady.lessThan(.5),()=>{alpha.mulAssign(clamp(reflection.add(dot(emission,vec3(.22,.7,.08)).mul(.6)).add(.025),0,1))})
    const clip=g.mvp.mul(vec4(front,1)).toVar(),ndcDepth=clip.z.div(clip.w)
    // Written here, not as depthNode: Three builds depthNode before this graph.
    depth.assign(coordinateSystem===THREE.WebGPUCoordinateSystem?ndcDepth:ndcDepth.mul(.5).add(.5))
    // The straight colour is encoded first and then multiplied by alpha, so
    // the result is premultiplied in the canvas's encoding (decisions.md #72).
    // SAFETY: Three declares this TSL function's layout as vec3 to vec3; its
    // published types leave the result untyped.
    const encoded=sRGBTransferOETF(max(colour,vec3(0))) as Vec3
    return encodedOutput(vec4(encoded.mul(alpha),alpha))
  })()
  return material
}
