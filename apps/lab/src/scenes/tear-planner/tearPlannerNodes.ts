// Planner sheet material — one double-sided paper shader for both live
// pages: the capture on the front, plain stock with the print showing
// through on the back, lambert shading around the roll, the perforation
// along the top edge, ragged fibres where it has torn, and the shadow the
// other sheet's roll casts on this one.
//
// The fold uniforms mirror tearPlannerFoldLaw's Fold, so the shading and
// the deformed vertices agree on where the crease is.
import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  Discard,
  Fn,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  frontFacing,
  max,
  min,
  mix,
  mod,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput, type SurfaceNodes } from '@petepetrash/munari'

/** Centre-to-centre pitch of the perforation holes, in page px (1.5 mm at 4 px/mm). */
export const HOLE_PITCH_PX = 6
const HOLE_RADIUS_PX = 1.35

/** Key light from the upper left, in page coordinates (+y down, +z to the viewer). */
const LIGHT = new THREE.Vector3(-0.35, -0.5, 0.79).normalize()

export function createSheetUniforms() {
  return {
    size: uniform(new THREE.Vector2(420, 594)),
    /** This sheet's fold: nx, ny, crease s0, radius r. */
    fold: uniform(new THREE.Vector4(0, 1, 0, 1)),
    foldOn: uniform(0),
    /** x of the leftmost torn perforation point; the sheet width when untorn. */
    tearFront: uniform(420),
    /** The fold of the sheet lying on top of this one, for its shadow. */
    over: uniform(new THREE.Vector4(0, 1, 0, 1)),
    overOn: uniform(0),
  }
}

export type SheetUniforms = ReturnType<typeof createSheetUniforms>

/**
 * The soft shadow a falling sheet throws on the pad and the wall: a
 * rectangle the sheet's size whose edge blurs over `blur` px. Black, so
 * premultiplied and straight alpha blend the same.
 */
export function createDropShadow() {
  const u = { size: uniform(new THREE.Vector2(420, 594)), blur: uniform(24), strength: uniform(0) }
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  material.outputNode = Fn(() => {
    const st = uv()
    const px = vec2(st.x.mul(u.size.x), st.y.mul(u.size.y))
    const edge = min(min(px.x, u.size.x.sub(px.x)), min(px.y, u.size.y.sub(px.y)))
    const alpha = smoothstep(float(0), u.blur, edge).mul(u.strength)
    return vec4(0, 0, 0, alpha)
  })()
  return { material, uniforms: u }
}

export function createSheetMaterial(surface: SurfaceNodes, u: SheetUniforms): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ side: THREE.DoubleSide, depthTest: true, depthWrite: true })
  material.outputNode = Fn(() => {
    const st = uv()
    const px = vec2(st.x.mul(u.size.x), float(1).sub(st.y).mul(u.size.y))

    // ── perforation and torn edge ─────
    const hx = mod(px.x, HOLE_PITCH_PX).sub(HOLE_PITCH_PX / 2)
    const inHole = hx.mul(hx).add(px.y.mul(px.y)).lessThan(HOLE_RADIUS_PX * HOLE_RADIUS_PX)
    const fibre = fract(sin(floor(px.x.mul(0.9)).mul(12.9898)).mul(43758.5453))
    const torn = px.x.greaterThan(u.tearFront)
    const ragged = torn.and(px.y.lessThan(fibre.mul(2.6).add(0.6)))
    Discard(inHole.or(ragged))

    // ── this sheet's roll ─────
    const r = max(u.fold.w, float(0.5))
    const d = px.x.mul(u.fold.x).add(px.y.mul(u.fold.y)).sub(u.fold.z)
    const a = clamp(d.div(r), float(0), float(Math.PI)).mul(u.foldOn)
    const lightAlongFold = u.fold.x.mul(LIGHT.x).add(u.fold.y.mul(LIGHT.y))
    const facing = sin(a).negate().mul(lightAlongFold).add(cos(a).mul(LIGHT.z))
    // 1 where the paper faces the light as squarely as the flat page does.
    const lit = frontFacing.select(facing, facing.negate()).div(LIGHT.z)
    const frontShade = clamp(float(1).add(lit.sub(1).mul(0.5)), float(0.55), float(1.05))
    // The back is the same stock, seen through the roll's own shade.
    const backShade = clamp(float(0.86).add(lit.mul(0.16)), float(0.74), float(1))
    const rollShade = frontFacing.select(frontShade, backShade)
    // A thin contact shade where the flat page meets the roll.
    const creaseShadow = smoothstep(float(-8), float(0), d)
      .mul(d.lessThanEqual(0).select(float(1), float(0)))
      .mul(0.07)
      .mul(u.foldOn)

    // ── shadow of the sheet on top ─────
    const ro = max(u.over.w, float(0.5))
    const dOver = px.x.mul(u.over.x).add(px.y.mul(u.over.y)).sub(u.over.z)
    // The roll stands 2r off this page and the light comes from the upper
    // left, so its shadow falls past the roll's edge (d = r) on the side
    // away from the crease: a dark core at the roll, then a long soft edge.
    const lifted = dOver.greaterThan(0).select(float(1), float(0))
    const shadowCore = float(1).sub(smoothstep(ro.mul(0.9), ro.mul(1.5).add(6), dOver)).mul(0.14)
    const shadowSoft = float(1).sub(smoothstep(ro.mul(0.6), ro.mul(2.6).add(56), dOver)).mul(0.3)
    const overShadow = shadowCore.add(shadowSoft).mul(lifted).mul(u.overOn)

    // ── paper ─────
    const sample = surface.map.sample(st)
    const edge = min(min(px.x, u.size.x.sub(px.x)), u.size.y.sub(px.y))
    const edgeShade = float(1).sub(float(1).sub(smoothstep(float(0), float(1.5), edge)).mul(0.12))
    const ink = dot(sample.rgb, vec3(0.3, 0.59, 0.11))
    const back = vec3(0.93, 0.915, 0.875).mul(mix(float(1), ink, 0.14))
    const paper = frontFacing.select(sample.rgb, back)
    const flatShade = float(1).sub(creaseShadow).sub(overShadow)
    const shade = d.greaterThan(0).and(u.foldOn.greaterThan(0.5)).select(rollShade, flatShade)
    return premultipliedOutput(vec4(clamp(paper.mul(shade).mul(edgeShade), vec3(0), vec3(1)), 1))
  })()
  return material
}
