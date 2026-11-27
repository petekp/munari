// Finish transmission — light through a glass body: what the canvas drew
// behind the Surface, bent by the body's front face, frosted by its
// roughness, split by its dispersion, and colored by its thickness.
//
// The law: the backdrop is the canvas as drawn before the glass, copied once
// per render and shared by every glass on the canvas. The canvas holds
// premultiplied sRGB (decisions.md #72), so each sample divides out its
// alpha and decodes before it is used. Stock transmission read the canvas
// without decoding and drew sRGB (40, 101, 180) as (110, 169, 219), which
// is that one missing decode: 40/255 encodes to 110/255. Without the
// decode, a glass set to pass the backdrop unchanged drew it up to 72/255
// too bright on every pixel (m2, 2026-11-26). The copy's alpha
// says how much of the page behind the canvas is there; where it is 0 the
// page shows through the glass unbent, since only the canvas can be bent.
//
// The refraction follows registry/glass (glassSdfNodes.ts): refract the eye
// ray through the face normal, follow it through the slab, and sample where
// it lands; one loop of taps walks a spectral ramp of IORs for dispersion
// and a golden-angle spiral for frost, weighted so that no dispersion
// averages to a plain blur. Here the slab's back face lies on the backdrop,
// so the offset is the refracted path through the slab less the straight
// one, and a flat face seen head-on bends nothing. The tint is
// Beer–Lambert: `tint` is what the flat face passes across `thickness`,
// and a longer path through the slab deepens it.
//
// The copy is three's framebuffer copy without mipmaps. A mipmapped copy
// has the canvas's format (bgra8unorm on macOS), and three builds the
// mipmap pass for a format with the blocking createRenderPipeline at first
// use (surfaceMipmapPrebuild.ts). A blur drawn in its own render runs
// before the canvas copy it reads, because three submits a nested render's
// commands first. So frost is taps on the full-resolution copy.
//
// A glass sees only what drew before it in the same render: the first glass
// to draw takes the copy, so a glass behind another glass is not in it.
// The page share passes through the blend, which also lets through the
// canvas directly under the glass, unbent. That is exact where the copy is
// empty or opaque at both points. Where a bent ray lands on empty canvas
// over a drawn pixel, that pixel shows unbent, and partly covered pixels
// pass the page about (1 − coverage)² instead of (1 − coverage).
// Ownership: this module builds the transmitted light; finishNodes.ts
// composites it with the lit body and the capture.

import { type Node } from 'three/webgpu'
import {
  abs,
  clamp,
  dFdx,
  dFdy,
  cos,
  dot,
  float,
  Fn,
  If,
  length,
  max,
  min,
  sin,
  fract,
  pow,
  refract,
  screenCoordinate,
  screenUV,
  smoothstep,
  sRGBTransferEOTF,
  vec2,
  vec3,
  vec4,
  viewportTexture,
} from 'three/tsl'

// One copy for every glass material. Its texture is cached per render
// target and per canvas, so each canvas copies its own drawing buffer once
// per render, however many glass materials sample it.
const backdrop = viewportTexture()

// Taps for frost and dispersion. registry/glass tuned 8 for the same loop.
const TAPS = 8
// The refracted path is capped at this many slab thicknesses, so a ray
// grazing the rim samples near the glass, not across the canvas.
const MAX_PATH = 3
// A ray more than about 78° from the face would leave through the side of
// a real slab; its path through the slab stops growing here.
const MIN_COS = 0.2
// Frost: a GGX lobe of width α spreads a ray by about α per unit of path,
// and the path to the backdrop is about the slab's thickness. The factor
// widens it to the blur frosted glass shows at a hand's distance. By eye,
// unmeasured.
const FROST_SPREAD = 4
// Below this blur radius, in CSS px, and with no dispersion, the finish
// draws one tap instead of eight; at DPR 2 the eight would land within
// 0.7 device px. Set by eye, unmeasured. A roughness that crosses it
// switches between the two in one step.
const ONE_TAP_BLUR_PX = 0.35

// Spectral response of one tap, as in registry/glass.
function spectralWeight(f: number): Node<'vec3'> {
  return max(vec3(float(1).sub(smoothstep(0, 0.62, f)), float(1).sub(abs(float(f).sub(0.5)).mul(2)), smoothstep(0.38, 1, f)), vec3(0))
}

/** The card's axes in view space: x right, y up and z out of its face. */
export interface CardAxes {
  readonly right: Node<'vec3'>
  readonly up: Node<'vec3'>
  readonly out: Node<'vec3'>
}

export interface TransmissionInputs {
  /** The front face's shading normal, in view space. */
  readonly normal: Node<'vec3'>
  readonly axes: CardAxes
  /** CSS px from the card's center, y down: the frame offsets are measured in. */
  readonly content: Node<'vec2'>
  /** Linear transmittance across `thickness` through the flat face. */
  readonly tint: Node<'vec3'>
  /** Share of the body's light that passes through, 0 to 1. */
  readonly amount: Node<'float'>
  /** The slab's thickness, CSS px. */
  readonly thickness: Node<'float'>
  /** 20 / Abbe number (KHR_materials_dispersion). */
  readonly dispersion: Node<'float'>
  /** Perceptual roughness of the face, before any filtering. */
  readonly roughness: Node<'float'>
  readonly ior: Node<'float'>
  /** Unit vector from the fragment toward the eye, view space. */
  readonly toEye: Node<'vec3'>
}

export interface Transmitted {
  /** Light through the glass from the canvas behind it: linear, premultiplied. */
  readonly light: Node<'vec3'>
  /** Share of the page behind the canvas that shows through, where the canvas behind the glass is empty. */
  readonly seeThrough: Node<'float'>
}

/** One backdrop sample in linear light, premultiplied, with its coverage. */
interface BackdropSample {
  readonly premultiplied: Node<'vec3'>
  readonly alpha: Node<'float'>
}

function decoded(at: Node<'vec2'>): BackdropSample {
  // SAFETY: a texture sample is a vec4; three's types return a bare Node.
  const sample = backdrop.sample(clamp(at, vec2(0), vec2(1))).level(float(0)) as Node<'vec4'>
  const alpha = sample.a
  // SAFETY: three declares this TSL function's layout as vec3 to vec3; its
  // published types leave the result untyped.
  const straight = sRGBTransferEOTF(sample.rgb.div(max(alpha, float(1e-4)))) as Node<'vec3'>
  return { premultiplied: straight.mul(alpha), alpha }
}

export function transmittedLight(inputs: TransmissionInputs): Transmitted {
  const { normal, axes, content, tint, amount, thickness, dispersion, roughness, ior, toEye } = inputs
  const incident = toEye.negate()

  // Content px to screen uv, from the derivatives of both: right for any
  // pose of the card and either framebuffer y direction.
  const cdx = dFdx(content).toVar()
  const cdy = dFdy(content).toVar()
  const udx = dFdx(screenUV).toVar()
  const udy = dFdy(screenUV).toVar()
  const det = cdx.x.mul(cdy.y).sub(cdy.x.mul(cdx.y)).toVar()
  const safeDet = abs(det).greaterThan(1e-8).select(det, float(1e-8))
  const toUv = (delta: Node<'vec2'>): Node<'vec2'> => {
    const px = vec2(cdy.y.mul(delta.x).sub(cdy.x.mul(delta.y)), cdx.x.mul(delta.y).sub(cdx.y.mul(delta.x))).div(safeDet)
    return udx.mul(px.x).add(udy.mul(px.y))
  }

  const pathLength = (direction: Node<'vec3'>) => thickness.div(max(dot(direction, axes.out).negate(), float(MIN_COS)))
  const straightPath = incident.mul(pathLength(incident))
  /** Where a ray bent at `index` lands, as an offset in content px. */
  const landing = (index: Node<'float'>): Node<'vec2'> => {
    const refracted = refract(incident, normal, float(1).div(max(index, float(1.0001))))
    const path = refracted.mul(pathLength(refracted)).sub(straightPath)
    const card = vec2(dot(path, axes.right), dot(path, axes.up).negate())
    const reach = max(thickness.mul(MAX_PATH), float(1e-3))
    return card.mul(min(float(1), reach.div(max(length(card), float(1e-4)))))
  }

  // KHR_materials_dispersion: the IOR spreads by (ior − 1) · 0.025 · dispersion on each side.
  const halfSpread = ior.sub(1).mul(0.025).mul(dispersion)
  const alpha = roughness.mul(roughness)
  const blur = alpha.mul(thickness).mul(FROST_SPREAD)
  const sampled = Fn(() => {
    const light = vec3(0).toVar()
    const coverage = float(0).toVar()
    const oneTap = blur.lessThan(ONE_TAP_BLUR_PX).and(dispersion.lessThanEqual(0))
    If(oneTap, () => {
      const one = decoded(screenUV.add(toUv(landing(ior))))
      light.assign(one.premultiplied)
      coverage.assign(one.alpha)
    }).Else(() => {
      // Each pixel turns the spiral by its own angle (interleaved gradient
      // noise, Jimenez 2014), so eight taps read as the grain of frosted
      // glass instead of eight sharp copies of the backdrop.
      const turn = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189)).mul(Math.PI * 2)
      const turnCos = cos(turn)
      const turnSin = sin(turn)
      const sum = vec3(0).toVar()
      const weights = vec3(0).toVar()
      const alphaSum = float(0).toVar()
      for (let i = 0; i < TAPS; i++) {
        const f = (i + 0.5) / TAPS
        const angle = i * 2.39996323
        const [x, y] = [Math.cos(angle) * Math.sqrt(f), Math.sin(angle) * Math.sqrt(f)]
        const spiral = vec2(turnCos.mul(x).sub(turnSin.mul(y)), turnSin.mul(x).add(turnCos.mul(y)))
        const tap = decoded(screenUV.add(toUv(landing(ior.add(halfSpread.mul((f - 0.5) * 2))).add(spiral.mul(blur)))))
        // Without dispersion every tap sees every wavelength, or the jitter
      // would tint each pixel at random.
      const weight = dispersion.greaterThan(0).select(spectralWeight(f), vec3(1))
        sum.addAssign(tap.premultiplied.mul(weight))
        weights.addAssign(weight)
        alphaSum.addAssign(tap.alpha)
      }
      light.assign(sum.div(max(weights, vec3(1e-4))))
      coverage.assign(alphaSum.div(TAPS))
    })
    return vec4(light, coverage)
  })()
  const light = sampled.rgb
  const coverage = sampled.a

  // Beer–Lambert through the slab, deeper where the bent ray runs longer.
  const center = refract(incident, normal, float(1).div(max(ior, float(1.0001))))
  const depth = clamp(float(1).div(max(dot(center, axes.out).negate(), float(MIN_COS))), float(1), float(MAX_PATH))
  // SAFETY: pow of two vec3 nodes is a vec3; three's types leave it untyped.
  const absorbed = pow(max(tint, vec3(1e-4)), vec3(depth)) as Node<'vec3'>
  // Fresnel at the front face (Schlick) and at the flat back face (head-on).
  const f0 = pow(ior.sub(1).div(ior.add(1)), 2)
  const cosine = clamp(dot(normal, toEye), float(0), float(1))
  const front = f0.add(float(1).sub(f0).mul(pow(float(1).sub(cosine), 5)))
  const passed = amount.mul(float(1).sub(front)).mul(float(1).sub(f0))
  const gray = dot(absorbed, vec3(0.2126, 0.7152, 0.0722))
  return {
    light: light.mul(absorbed).mul(passed),
    seeThrough: passed.mul(gray).mul(float(1).sub(coverage)),
  }
}

/** The camera's axes, for a card that shares its rotation. */
export const CAMERA_AXES: CardAxes = { right: vec3(1, 0, 0), up: vec3(0, 1, 0), out: vec3(0, 0, 1) }
