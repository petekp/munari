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
    const lit = frontFacing.select(facing, facing.negate()).div(LIGHT.z)
    const rollShade = clamp(float(0.6).add(lit.mul(0.42)), float(0.5), float(1.08))
    const creaseShadow = smoothstep(r.mul(-3).sub(28), float(0), d)
      .mul(d.lessThanEqual(0).select(float(1), float(0)))
      .mul(0.16)
      .mul(u.foldOn)

    // ── shadow of the sheet on top ─────
    const ro = max(u.over.w, float(0.5))
    const dOver = px.x.mul(u.over.x).add(px.y.mul(u.over.y)).sub(u.over.z)
    const overShadow = float(1)
      .sub(smoothstep(ro.mul(0.15), ro.mul(1.3).add(26), dOver))
      .mul(dOver.greaterThan(0).select(float(1), float(0)))
      .mul(0.26)
      .mul(u.overOn)

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
