// Curved-paper visibility — a fitted depth map with a finite-source penumbra.
// Receiver-plane correction prevents the sheet shadowing itself merely because
// a filter tap lands farther down its slope. Real curls can still occlude it (#51).

import * as THREE from 'three'
import type { Node, TextureNode, UniformNode } from 'three/webgpu'
import { If, Loop, abs, cross, dot, float, length, max, mix, normalize, sqrt, step, uniformArray, vec2, vec3, vec4 } from 'three/tsl'

type Float = Node<'float'>
type Vec2 = Node<'vec2'>
type Vec3 = Node<'vec3'>

/** The light and paper-shadow values the visibility functions read. */
export interface PaperLightValues {
  readonly lightRadius: UniformNode<'float', number>
  readonly paperShadow: TextureNode
  readonly paperShadowMatrix: UniformNode<'mat4', THREE.Matrix4>
  readonly paperShadowRange: UniformNode<'vec2', THREE.Vector2>
  readonly paperReady: UniformNode<'float', number>
  readonly frameOrigin: UniformNode<'vec2', THREE.Vector2>
}

// Rounded to eight decimals, the precision the taps were tuned at.
const taps = Array.from({ length: 64 }, (_, i) => {
  const angle = i * 2.399963229728653, radius = Math.sqrt((i + .5) / 64)
  return new THREE.Vector2(Number((Math.cos(angle) * radius).toFixed(8)), Number((Math.sin(angle) * radius).toFixed(8)))
})
export const LIGHT_TAPS = uniformArray<'vec2'>(taps, 'vec2')

/** Columns of the bulb's local frame: tangent, bitangent, receiver-to-light direction. */
export interface BulbBasis {
  readonly tangent: Vec3
  readonly bitangent: Vec3
  readonly direction: Vec3
}

// The bulb subtends a cone around each receiver-to-light ray. A disk parallel
// to the page kept long, grazing shadows as sharp as nearby shadows (#50).
export function bulbBasis(delta: Vec3): BulbBasis {
  const direction = normalize(delta).toVar()
  const tangent = length(direction.xy).greaterThan(.001).select(normalize(vec3(direction.y.negate(), direction.x, 0)), vec3(1, 0, 0)).toVar()
  return { tangent, bitangent: cross(direction, tangent).toVar(), direction }
}
export function bulbCosine(delta: Vec3, lightRadius: Float): Float {
  return sqrt(max(.001, float(1).sub(lightRadius.mul(lightRadius).div(dot(delta, delta)))))
}
export function sampleBulbRay(basis: BulbBasis, cosineLimit: Float, samplePoint: Vec2): Vec3 {
  const radiusSquared = dot(samplePoint, samplePoint)
  const cosine = mix(1, cosineLimit, radiusSquared)
  const scale = sqrt(max(0, float(1).sub(cosine.mul(cosine))).div(max(radiusSquared, .00001)))
  const local = vec3(samplePoint.mul(scale), cosine)
  // The basis matrix times `local`, column by column.
  return basis.tangent.mul(local.x).add(basis.bitangent.mul(local.y)).add(basis.direction.mul(local.z))
}

function outsideUnit(uv: Vec2) {
  return uv.x.lessThan(0).or(uv.y.lessThan(0)).or(uv.x.greaterThan(1)).or(uv.y.greaterThan(1))
}

function paperDepth(v: PaperLightValues, uv: Vec2): Vec2 {
  // SAFETY: a texture sample is a vec4; Three's types return a bare Node.
  const sampleValue = (v.paperShadow.sample(uv) as Node<'vec4'>).rg.toVar()
  const depth = sampleValue.y.greaterThan(.001).select(vec2(sampleValue.x.div(sampleValue.y), sampleValue.y), vec2(4096, 0))
  return outsideUnit(uv).select(vec2(4096, 0), depth)
}

export function paperVisibility(v: PaperLightValues, receiver: Vec3, normal: Vec3, light: Vec3): Float {
  const result = float(1).toVar()
  const p = receiver.add(normal.mul(.65)).add(vec3(v.frameOrigin, 0)).toVar()
  const projected = v.paperShadowMatrix.mul(vec4(p, 1)).toVar()
  const uv = projected.xy.div(projected.w).mul(.5).add(.5).toVar()
  If(outsideUnit(uv).not(), () => {
    const depth = max(1, light.z.sub(p.z)).toVar()
    const delta = vec3(light.xy.add(v.frameOrigin), light.z).sub(p).toVar()
    const basis = bulbBasis(delta)
    const cosineLimit = bulbCosine(delta, v.lightRadius).toVar()
    const q = p.xy.sub(light.xy).sub(v.frameOrigin).div(depth)
    const facing = dot(normal, vec3(q, -1)).toVar()
    const slope = facing.lessThan(0).select(float(-1), float(1)).mul(max(abs(facing), .05))
    const gradient = clamp2(depth.negate().mul(normal.xy).div(slope).mul(v.paperShadowRange)).toVar()
    const blocker = float(0).toVar(), count = float(0).toVar()
    const center = paperDepth(v, uv).toVar()
    If(center.x.lessThan(depth.sub(.6)), () => { blocker.assign(center.x.mul(center.y)); count.assign(center.y) })
    Loop(8, ({ i }) => {
      const ray = sampleBulbRay(basis, cosineLimit, LIGHT_TAPS.element(i.mul(9))).toVar()
      const searchPoint = p.add(ray.mul(depth.mul(.5).div(max(ray.z, .0001))))
      const searchClip = v.paperShadowMatrix.mul(vec4(searchPoint, 1)).toVar()
      const offset = searchClip.xy.div(searchClip.w).mul(.5).add(.5).sub(uv).toVar()
      const sampleDepth = paperDepth(v, uv.add(offset)).toVar()
      If(sampleDepth.x.lessThan(depth.add(dot(gradient, offset)).sub(.6)), () => {
        blocker.addAssign(sampleDepth.x.mul(sampleDepth.y))
        count.addAssign(sampleDepth.y)
      })
    })
    If(count.notEqual(0), () => {
      blocker.divAssign(count)
      const visible = float(0).toVar()
      Loop(64, ({ i }) => {
        const tap = LIGHT_TAPS.element(i).toVar()
        const ray = sampleBulbRay(basis, cosineLimit, tap).toVar()
        const blockerPoint = p.add(ray.mul(max(0, depth.sub(blocker)).div(max(ray.z, .0001))))
        const blockerClip = v.paperShadowMatrix.mul(vec4(blockerPoint, 1)).toVar()
        const offset = blockerClip.xy.div(blockerClip.w).mul(.5).add(.5).sub(uv).toVar()
        If(length(offset).lessThan(1 / 1024), () => { offset.assign(tap.div(1024)) })
        const sampleDepth = paperDepth(v, uv.add(offset)).toVar()
        visible.addAssign(float(1).sub(sampleDepth.y.mul(float(1).sub(step(depth.add(dot(gradient, offset)).sub(.6), sampleDepth.x)))))
      })
      result.assign(visible.div(64))
    })
  })
  return result
}

function clamp2(value: Vec2): Vec2 {
  return value.clamp(vec2(-4096), vec2(4096))
}
