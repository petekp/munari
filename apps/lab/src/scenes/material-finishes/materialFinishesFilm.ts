// Material finishes thin film — the reflectance of a metal under a thin
// dielectric film, as TSL nodes.
//
// Ported from three r186's evalIridescence (PhysicalLightingModel.js, MIT),
// which three applies to point, directional and environment light but not
// to a RectAreaLight (directRectArea reads the plain specular color). The
// film here becomes the metal's reflectance itself, so every light, the
// softbox key included, reflects it. three evaluates the film at the view
// angle for every light too, so the two agree wherever three applies it.
// After Belcour and Barla 2017, "A Practical Extension to Microfacet Theory
// for the Modeling of Varying Iridescence".
//
// Ownership: this module computes the film's reflectance and thickness.
// materialFinishesNodes turns the reflectance into the metal's F0.

import { type Node } from 'three/webgpu'
import {
  clamp,
  cos,
  exp,
  float,
  mat3,
  max,
  mix,
  select,
  sin,
  smoothstep,
  sqrt,
  vec3,
} from 'three/tsl'

import { valueNoise } from './materialFinishesRelief'

const XYZ_TO_REC709 = mat3(3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259, 1.0572252)

const fresnel0ToIor = (f0: Node<'vec3'>) => {
  const root = sqrt(f0)
  return vec3(1).add(root).div(vec3(1).sub(root))
}

/** Schlick's Fresnel toward 1 at grazing, as three's F_Schlick. */
const schlick = (f0: Node<'vec3'>, cosTheta: Node<'float'>) => {
  const x = clamp(float(1).sub(cosTheta), float(0), float(1))
  const x2 = x.mul(x)
  return f0.add(vec3(1).sub(f0).mul(x2.mul(x2).mul(x)))
}

const iorToFresnel0 = (transmitted: Node<'vec3'>, incident: Node<'vec3'>) => {
  const ratio = transmitted.sub(incident).div(transmitted.add(incident))
  return ratio.mul(ratio)
}

/** The XYZ sensitivity curves in Fourier space, as linear sRGB. */
function evalSensitivity(opd: Node<'float'>, shift: Node<'vec3'>): Node<'vec3'> {
  const phase = opd.mul(2 * Math.PI * 1e-9)
  const val = vec3(5.4856e-13, 4.4201e-13, 5.2481e-13)
  const pos = vec3(1.681e6, 1.7953e6, 2.2084e6)
  const variance = vec3(4.3278e9, 9.3046e9, 6.6121e9)
  const x = float(9.747e-14 * Math.sqrt(2 * Math.PI * 4.5282e9))
    .mul(cos(phase.mul(2.2399e6).add(shift.x)))
    .mul(exp(phase.mul(phase).mul(-4.5282e9)))
  const xyz = val
    .mul(sqrt(variance.mul(2 * Math.PI)))
    .mul(cos(pos.mul(phase).add(shift)))
    .mul(exp(phase.mul(phase).negate().mul(variance)))
  // SAFETY: a mat3 times a vec3 is a vec3; three's types return a bare Node.
  return XYZ_TO_REC709.mul(vec3(xyz.x.add(x), xyz.y, xyz.z).div(1.0685e-7)) as Node<'vec3'>
}

/** Reflectance of a film `thickness` nm thick, of IOR `filmIor`, over a base of reflectance `baseF0`, seen at `cosTheta`. */
export function filmReflectance(cosTheta: Node<'float'>, thickness: Node<'float'>, filmIor: Node<'float'>, baseF0: Node<'vec3'>): Node<'vec3'> {
  // A film thinning to nothing fades to the bare base.
  const eta = mix(float(1), filmIor, smoothstep(0, 0.03, thickness))
  const sinTheta2Sq = float(1).div(eta).pow(2).mul(float(1).sub(cosTheta.mul(cosTheta)))
  const cosTheta2Sq = float(1).sub(sinTheta2Sq)
  const cosTheta2 = sqrt(max(cosTheta2Sq, float(0)))
  const r12 = schlick(iorToFresnel0(vec3(eta), vec3(1)), cosTheta)
  const t121 = vec3(1).sub(r12)
  const phi12 = select(eta.lessThan(1), float(Math.PI), float(0))
  const phi21 = float(Math.PI).sub(phi12)
  const baseIor = fresnel0ToIor(clamp(baseF0, vec3(0), vec3(0.9999)))
  const r23 = schlick(iorToFresnel0(baseIor, vec3(eta)), cosTheta2)
  const phi23 = vec3(
    select(baseIor.x.lessThan(eta), float(Math.PI), float(0)),
    select(baseIor.y.lessThan(eta), float(Math.PI), float(0)),
    select(baseIor.z.lessThan(eta), float(Math.PI), float(0)),
  )
  const opd = eta.mul(thickness).mul(cosTheta2).mul(2)
  const phi = vec3(phi21).add(phi23)
  const r123 = clamp(r12.mul(r23), vec3(1e-5), vec3(0.9999))
  const rootR123 = sqrt(r123)
  const rs = t121.mul(t121).mul(r23).div(vec3(1).sub(r123))
  const c1 = rs.sub(t121).mul(rootR123)
  const c2 = c1.mul(rootR123)
  const reflectance = r12
    .add(rs)
    .add(c1.mul(evalSensitivity(opd, phi).mul(2)))
    .add(c2.mul(evalSensitivity(opd.mul(2), phi.mul(2)).mul(2)))
  // Total internal reflection reflects everything.
  return select(cosTheta2Sq.lessThan(0), vec3(1), max(reflectance, vec3(0)))
}

/**
 * The film's thickness at content point `p`: bands `scale` px apart, bent
 * by a slower noise, thinning the film by up to `variation` of `thickness`.
 */
export function filmThickness(p: Node<'vec2'>, thickness: Node<'float'>, variation: Node<'float'>, scale: Node<'float'>): Node<'float'> {
  const q = p.div(scale)
  const bend = valueNoise(q.mul(0.5).add(3.1)).x
  const bands = sin(q.x.add(q.y).mul(0.7 * 2 * Math.PI).add(bend.mul(2.5))).mul(0.5).add(0.5)
  const drift = valueNoise(q.add(8.3)).x.mul(0.5).add(0.5)
  return thickness.mul(float(1).sub(variation.mul(mix(bands, drift, 0.4))))
}
