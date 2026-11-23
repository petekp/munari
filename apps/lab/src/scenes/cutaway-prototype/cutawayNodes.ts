// Cutaway materials — the section cut, its cap, the ghost of what it removed,
// glass that shows the sheet through it, and the sheet's projected light.
//
// The law: everything the cut removes is decided per fragment against one
// plane, the sheet's own. The casing discards on the viewer's side of it and
// paints its back faces as the cut face, so a hollow shell reads as solid
// wall; the ghost lines keep only what the casing lost. Parts are never cut.
//
// Ownership: these builders own shading only. The scene writes the plane's
// depth and the lens projection into the uniforms each time the sheet scrolls.

import * as THREE from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial, MeshStandardNodeMaterial, type Node } from 'three/webgpu'
import {
  Discard,
  Fn,
  abs,
  cameraPosition,
  clamp,
  dot,
  float,
  floor,
  fract,
  fwidth,
  frontFacing,
  length,
  max,
  mix,
  mx_noise_float,
  normalWorld,
  output,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  refract,
  sign,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput, type SurfaceNodes } from '@petepetrash/munari'
import {
  FILTER,
  OPTICAL_AXIS,
  SENSOR_BOARD,
  SENSOR_SIZE,
  SENSOR_Z,
  SHEET,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  STUDIO_WINDOW,
  TOP_PLATE_Y,
} from './cutawayModel'

function blankTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

export function createCutawayUniforms() {
  const blank = blankTexture()
  return {
    blank,
    sectionZ: uniform(15),
    lensDistance: uniform(26),
    blurRadius: uniform(0),
    irradiance: uniform(1),
    /** Zero once the sensor board stands between the lens and the sheet. */
    projectedTint: uniform(new THREE.Color(1, 1, 1)),
    sheetCapture: texture(blank),
    captureReady: uniform(0),
  }
}
export type CutawayUniforms = ReturnType<typeof createCutawayUniforms>

/** The image circle's radius over the lens distance: 16 mm at focus, a little past the sensor's 14.1 mm half-diagonal. */
const IMAGE_CIRCLE_PER_FOCAL = 0.72
/** Uncoated paper reflects about three quarters of the light; the CSS colour is its look under the page's own light. */
const PAPER_ALBEDO = 0.74
// Linear colours of the view through the window: overcast sky, brick and slate roofs.
const SKY = vec3(0.86, 0.97, 1.12)
const ROOFS = vec3(0.3, 0.2, 0.15)

const CUT_LINE = vec3(0.42, 0.05, 0.025)
const CUT_GROUND = vec3(0.11, 0.028, 0.02)
const CUT_EDGE = vec3(0.012, 0.01, 0.01)

/** 45° section hatching, 1 mm pitch in world millimetres, antialiased to its on-screen width. */
function hatch() {
  const s = positionWorld.x.add(positionWorld.y)
  const fromLine = abs(fract(s).sub(0.5))
  const aa = fwidth(s)
  return float(1).sub(smoothstep(float(0.08).sub(aa), float(0.08).add(aa), fromLine))
}

export type CasingFinish = 'body' | 'interior' | 'metal'

/**
 * Casing: cut on the viewer's side of the sheet, back faces painted as the cut.
 * An interior shell is built with its winding reversed, so its front faces
 * face the cavity and the same rule caps it.
 */
export function createCasingMaterial(u: CutawayUniforms, finish: CasingFinish): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ side: THREE.DoubleSide })
  const grain = mx_noise_float(positionWorld.mul(1.7)).mul(0.5).add(0.5)
  const leather = vec3(0.022, 0.021, 0.02).mul(grain.mul(0.5).add(0.75))
  const silver = vec3(0.62, 0.6, 0.57)
  const inside = vec3(0.012, 0.012, 0.013)
  const isTop = positionWorld.y.greaterThan(TOP_PLATE_Y)
  const outer = finish === 'interior' ? inside : finish === 'metal' ? silver : isTop.select(silver, leather)
  const outerMetal = finish === 'interior' ? float(0) : finish === 'metal' ? float(1) : isTop.select(float(1), float(0))
  const outerRough = finish === 'interior' ? float(0.95) : finish === 'metal' ? float(0.34) : isTop.select(float(0.36), grain.mul(0.2).add(0.72))
  m.colorNode = frontFacing.select(outer, vec3(0))
  m.metalnessNode = frontFacing.select(outerMetal, float(0))
  m.roughnessNode = frontFacing.select(outerRough, float(1))
  // The cut's own edge, the last 0.3 mm before the plane, draws as a dark line.
  const edge = step(u.sectionZ.sub(0.3), positionWorld.z)
  const cut = mix(mix(CUT_GROUND, CUT_LINE, hatch()), CUT_EDGE, edge)
  m.emissiveNode = frontFacing.select(vec3(0), cut)
  m.outputNode = Fn(() => {
    Discard(positionWorld.z.greaterThan(u.sectionZ))
    return output
  })()
  return m
}

/** Outline of what the cut removed: only the part on the viewer's side survives. */
export function createGhostMaterial(u: CutawayUniforms): LineBasicNodeMaterial {
  const m = new LineBasicNodeMaterial({ transparent: true, depthWrite: false })
  m.outputNode = Fn(() => {
    Discard(positionWorld.z.lessThan(u.sectionZ))
    const a = float(0.34).mul(float(1).sub(smoothstep(2, 26, positionWorld.z.sub(u.sectionZ)).mul(0.7)))
    return premultipliedOutput(vec4(vec3(0.82, 0.84, 0.86).mul(a), a))
  })()
  return m
}

export interface GlassOptions {
  readonly tint: THREE.Color
  /** Radius of a lathe element whose edge is painted black; omit for flat filters. */
  readonly rimRadius?: number
  readonly ior: number
  /** A lens element on the optical axis; omit for flat glass. */
  readonly element?: { readonly z: number; readonly focalLength: number }
}

/** Lateral colour: how much further red lands than blue, per unit of the element's radius. */
const LATERAL_COLOR = 0.018
/** Pincushion growth of magnification toward an element's rim, per unit radius squared. */
const RIM_DISTORTION = 0.3
/** The smallest |f − d| used, as a fraction of |f|, so magnification tops out at 5×. */
const NEAR_FOCUS_GUARD = 0.2
/** The IR-cut filter's absorption, shared with its own material. */
export const FILTER_TINT_RGB = [0.5, 0.82, 0.94] as const
const FILTER_TINT = vec3(...FILTER_TINT_RGB)
// Linear colours of the sensor stack as seen through glass, matching the meshes' materials under the key light.
const BOARD_GREEN = vec3(0.004, 0.03, 0.016)
const CERAMIC = vec3(0.5, 0.46, 0.38)
const BOND_GOLD = vec3(0.42, 0.29, 0.06)
const DIE = vec3(0.025, 0.02, 0.035)

/**
 * Optical glass: what the eye sees through one element. A lens element shows
 * the virtual image of whatever lies behind it, magnified by f / (f − d)
 * about the point seen through its centre; flat glass refracts once. Behind
 * the glass, the sensor board hides the sheet once the sheet passes behind
 * it, and the IR-cut filter tints whatever lies beyond it. Real lens edges
 * are blackened to cut flare, and so are these.
 */
export function createGlassMaterial(u: CutawayUniforms, options: GlassOptions): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial()
  const tint = vec3(options.tint.r, options.tint.g, options.tint.b)
  const rimRadius = options.rimRadius
  const element = options.element
  m.outputNode = Fn(() => {
    const view = positionWorld.sub(cameraPosition).normalize()
    const normal = normalWorld.normalize()
    const axis = vec2(OPTICAL_AXIS.x, OPTICAL_AXIS.y)
    const toPlane = (point: Node<'vec3'>, ray: Node<'vec3'>, planeZ: Node<'float'>) =>
      point.add(ray.mul(planeZ.sub(point.z).div(ray.z.min(-0.001)))).xy
    const radial = length(positionWorld.xy.sub(axis)).div(rimRadius ?? 10)
    let seenAt: (planeZ: Node<'float'>, spread: number) => Node<'vec2'>
    if (element) {
      const f = float(element.focalLength)
      const centre = vec3(OPTICAL_AXIS.x, OPTICAL_AXIS.y, element.z)
      const centreRay = centre.sub(cameraPosition).normalize()
      const distortion = radial.mul(radial).mul(RIM_DISTORTION).add(1)
      seenAt = (planeZ, spread) => {
        const gap = float(element.z).sub(planeZ).max(0.01)
        const away = f.sub(gap)
        // Kept off zero: at d = f the virtual image is at infinity.
        const safe = sign(away).mul(abs(away).max(Math.abs(element.focalLength) * NEAR_FOCUS_GUARD))
        const magnification = f.div(safe)
        const middle = toPlane(centre, centreRay, planeZ)
        const straight = toPlane(positionWorld, view, planeZ)
        return middle.add(straight.sub(middle).div(magnification.mul(distortion)).mul(radial.mul(spread).add(1)))
      }
    } else {
      const bent = refract(view, normal, float(1 / options.ior))
      seenAt = (planeZ) => toPlane(positionWorld, bent, planeZ)
    }
    const sheetUv = (p: Node<'vec2'>) => vec2(p.x.sub(SHEET.minX).div(SHEET_WIDTH), p.y.sub(SHEET.minY).div(SHEET_HEIGHT))
    const within = (p: Node<'vec2'>, halfWidth: number, halfHeight: number) => {
      const d = abs(p.sub(axis))
      return step(d.x, halfWidth).mul(step(d.y, halfHeight))
    }
    const sheetAt = seenAt(u.sectionZ, 0)
    const st = sheetUv(sheetAt)
    const onSheet = step(0, st.x).mul(step(st.x, 1)).mul(step(0, st.y)).mul(step(st.y, 1))
    const red = u.sheetCapture.sample(sheetUv(seenAt(u.sectionZ, -LATERAL_COLOR))).r
    const green = u.sheetCapture.sample(st).g
    const blue = u.sheetCapture.sample(sheetUv(seenAt(u.sectionZ, LATERAL_COLOR))).b
    const paper = vec3(red, green, blue).mul(u.captureReady).mul(PAPER_ALBEDO)
    const sheetLit = paper.mul(projectedLight(u, sheetAt).add(0.95))
    let beyond = mix(vec3(0.01, 0.01, 0.012), sheetLit, onSheet)
    if (element) {
      const filterAt = seenAt(float(FILTER.z), 0)
      const throughFilter = within(filterAt, FILTER.width / 2, FILTER.height / 2).mul(step(u.sectionZ, FILTER.z - FILTER.thickness))
      beyond = beyond.mul(mix(vec3(1), FILTER_TINT, throughFilter))
    }
    // The sensor board stack, seen once the sheet has passed behind it.
    const [sw, sh] = SENSOR_SIZE
    const boardAt = seenAt(float(SENSOR_Z), 0)
    const behindBoard = step(u.sectionZ, SENSOR_Z - 0.2)
    let stack: Node<'vec3'> = BOARD_GREEN
    stack = mix(stack, CERAMIC, within(boardAt, (sw + 8.5) / 2, (sh + 10.4) / 2))
    stack = mix(stack, BOND_GOLD, within(boardAt, (sw + 3) / 2, (sh + 3) / 2))
    stack = mix(stack, DIE, within(boardAt, sw / 2, sh / 2))
    const onBoard = within(boardAt, SENSOR_BOARD.width / 2, SENSOR_BOARD.height / 2).mul(behindBoard)
    const seen = mix(beyond, stack, onBoard).mul(tint)
    const facing = clamp(dot(view.negate(), normal), 0, 1)
    const fresnel = float(0.04).add(float(0.96).mul(pow(float(1).sub(facing), 5)))
    const mirror = reflect(view, normal)
    const sky = mix(vec3(0.02, 0.022, 0.026), vec3(0.5, 0.52, 0.55), smoothstep(-0.2, 0.9, mirror.y))
    const glint = pow(max(dot(mirror, vec3(-0.42, 0.55, 0.72).normalize()), 0), 90).mul(3)
    const lit = mix(seen, sky, fresnel).add(glint)
    const rim = rimRadius === undefined
      ? float(0)
      : smoothstep(rimRadius * 0.9, rimRadius * 0.965, length(positionLocal.xz))
    const color = mix(lit, vec3(0.006, 0.006, 0.007), rim)
    return premultipliedOutput(vec4(color, 1))
  })()
  return m
}

/**
 * The light the lens throws onto the sheet at a point on it, in model
 * millimetres. The lens draws the view opposite the camera upside down
 * around the optical axis: a four-pane window, sky above a row of rooftops.
 * Every edge in it blurs by the defocus the scene writes into the uniforms.
 */
function projectedLight(u: CutawayUniforms, point: Node<'vec2'>): Node<'vec3'> {
  const q = point.sub(vec2(OPTICAL_AXIS.x, OPTICAL_AXIS.y))
  const angle = q.negate().div(u.lensDistance)
  const blur = u.blurRadius.div(u.lensDistance).max(0.0016)
  const [cx, cy] = STUDIO_WINDOW.center
  const [hx, hy] = STUDIO_WINDOW.half
  const offset = abs(angle.sub(vec2(cx, cy)))
  const box = clamp(vec2(hx, hy).sub(offset).div(blur.mul(2)).add(0.5), 0, 1)
  const barWidth = float(STUDIO_WINDOW.mullion)
  const spread = max(blur, barWidth.mul(0.5))
  const cover = clamp(barWidth.div(spread.mul(2)), 0, 1)
  const bar = (distance: Node<'float'>) => clamp(float(1).sub(distance.div(spread)), 0, 1).mul(cover)
  const mullions = max(bar(abs(angle.x.sub(cx))), bar(abs(angle.y.sub(cy))))
  // Rooftops: blocks of seeded height along the horizon.
  const block = floor(angle.x.mul(STUDIO_WINDOW.roofsPerRadian))
  const roofHeight = fract(sin(block.mul(91.3)).mul(43758.5)).mul(STUDIO_WINDOW.roofSpread)
  const skyline = float(STUDIO_WINDOW.horizon).add(roofHeight)
  const sky = smoothstep(blur.negate(), blur, angle.y.sub(skyline))
  const view = mix(ROOFS, SKY.mul(float(1).add(angle.y.sub(skyline).mul(1.5))), sky)
  const pane = box.x.mul(box.y).mul(float(1).sub(mullions))
  const imageCircle = u.lensDistance.mul(IMAGE_CIRCLE_PER_FOCAL).add(u.blurRadius)
  const circle = float(1).sub(smoothstep(imageCircle.sub(1.5), imageCircle.add(0.5), length(q)))
  const light = view.mul(pane).mul(1.1).add(0.05)
  return light.mul(circle).mul(u.irradiance).mul(u.projectedTint)
}

/** The sheet: live capture lit by the scene, plus the light the lens throws onto it. */
export function createSheetMaterial(surface: SurfaceNodes, u: CutawayUniforms): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: 0.88, metalness: 0 })
  const paper = surface.map.sample(uv())
  m.colorNode = vec4(paper.rgb.mul(PAPER_ALBEDO), 1)
  m.emissiveNode = paper.rgb.mul(projectedLight(u, positionWorld.xy))
  return m
}
