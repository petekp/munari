// TypeGPU surface finish geometry, relief, crackle, and thin-film helpers
// matching Three.js finishNodes.ts / finishRelief*.ts / finishFilm.ts / finishCrackle.ts.
// Zero implicit i32->f32 conversions: every scalar constant is an explicit f32.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'

const RIM_SLOPE_FLOOR = d.f32(0.08)
const FILTER_SIGMA2 = d.f32(0.25)
const FILTER_KAPPA = d.f32(0.18)
const CRACKLE_LINE_PX = d.f32(0.9)
const TWO_PI = d.f32(Math.PI * 2)

export const finishLatticeHash = tgpu.fn([d.vec2f], d.f32)((cell) => {
  'use gpu'
  return std.fract(std.sin(std.dot(cell, d.vec2f(127.1, 311.7))) * 43758.5453)
})

/** Value noise in -1..1 with analytic gradient: (value, d/dx, d/dy). */
export const finishValueNoise = tgpu.fn([d.vec2f], d.vec3f)((p) => {
  'use gpu'
  const cell = std.floor(p)
  const f = std.fract(p)
  const u = f.mul(f).mul(d.vec2f(3.0).sub(f.mul(2.0)))
  const du = f.mul(d.vec2f(1.0).sub(f)).mul(6.0)
  const a = finishLatticeHash(cell)
  const b = finishLatticeHash(cell.add(d.vec2f(1.0, 0.0)))
  const c = finishLatticeHash(cell.add(d.vec2f(0.0, 1.0)))
  const k = a - b - c + finishLatticeHash(cell.add(d.vec2f(1.0, 1.0)))
  const value = a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y
  const dx = du.x * (b - a + k * u.y)
  const dy = du.y * (c - a + k * u.x)
  return d.vec3f(value * 2.0 - 1.0, dx * 2.0, dy * 2.0)
})

/** Quarter-round edge profile matching finishNodes.ts: returns (slopeX, slopeY, towardRim). */
export const surfaceEdgeProfile = tgpu.fn([d.vec2f, d.vec2f, d.vec4f, d.f32], d.vec3f)((p, halfSize, radii, width) => {
  'use gpu'
  const left = p.x < 0.0
  const top = p.y < 0.0
  const tl = std.select(radii.w, radii.x, top)
  const tr = std.select(radii.z, radii.y, top)
  const rad = std.max(std.select(tr, tl, left), width)
  const q = std.abs(p).sub(halfSize).add(rad)
  const outside = std.max(q, d.vec2f(0.0))
  const outLen = std.length(outside)
  const dist = outLen + std.min(std.max(q.x, q.y), d.f32(0.0)) - rad
  const inCorner = q.x > 0.0 && q.y > 0.0
  const axis = std.select(d.vec2f(0.0, 1.0), d.vec2f(1.0, 0.0), q.x > q.y)
  const away = std.select(axis, outside.div(std.max(outLen, d.f32(1e-4))), inCorner)
  const outward = away.mul(std.sign(p))
  const towardRim = 1.0 - std.clamp(-dist / std.max(width, d.f32(1e-3)), d.f32(0.0), d.f32(1.0))
  const slopeMag = towardRim / std.sqrt(std.max(1.0 - towardRim * towardRim, RIM_SLOPE_FLOOR))
  const hasEdge = width > 0.5
  const slope = outward.mul(std.select(d.f32(0.0), slopeMag, hasEdge))
  return d.vec3f(slope.x, slope.y, std.select(d.f32(0.0), towardRim, hasEdge))
})

/** Specular AA roughness widening (Kaplanyan et al., HPG 2016). */
export const finishFilteredRoughness = tgpu.fn([d.f32, d.vec3f], d.f32)((roughness, normal) => {
  'use gpu'
  const dx = std.dpdx(normal)
  const dy = std.dpdy(normal)
  const variance = (std.dot(dx, dx) + std.dot(dy, dy)) * FILTER_SIGMA2
  const a = roughness * roughness
  const a2 = std.clamp(a * a + std.min(variance * 2.0, FILTER_KAPPA), d.f32(1e-4), d.f32(1.0))
  return std.sqrt(std.sqrt(a2))
})

/** Primary relief slope kinds: 1=orange-peel, 2=brushed, 3=pile, 4=glaze, 7=dots, 8=honeycomb. */
export const finishBaseReliefSlope = tgpu.fn([d.vec2f, d.f32, d.f32, d.f32], d.vec2f)((p, kind, scale, depth) => {
  'use gpu'
  const sc = std.max(scale, d.f32(0.25))
  if (kind > 0.5 && kind < 1.5) {
    const coarse = finishValueNoise(p.div(sc))
    const turned = d.vec2f(p.x * 0.8 - p.y * 0.6, p.x * 0.6 + p.y * 0.8)
    const fine = finishValueNoise(turned.div(sc * 0.43).add(17.3))
    return coarse.yz.add(fine.yz.mul(0.6)).mul(depth)
  }
  if (kind > 1.5 && kind < 2.5) {
    const groove = finishValueNoise(d.vec2f(p.x / (sc * 180.0), p.y / sc))
    const hair = finishValueNoise(d.vec2f(p.x / (sc * 50.0) + 31.7, p.y / (sc * 0.55)))
    return d.vec2f(0.0, (groove.z + hair.z * 0.5) * depth)
  }
  if (kind > 2.5 && kind < 3.5) {
    const patch = finishValueNoise(p.div(sc))
    const fiber = finishValueNoise(p.div(1.4).add(9.1))
    return patch.yz.add(fiber.yz.mul(0.25)).mul(depth)
  }
  if (kind > 3.5 && kind < 4.5) {
    return finishValueNoise(p.div(sc)).yz.mul(depth)
  }
  if (kind > 6.5 && kind < 7.5) {
    const offset = std.fract(p.div(sc)).sub(0.5)
    const onCap = std.dot(offset, offset) < 0.0625
    return std.select(d.vec2f(0.0), offset.div(-0.25), onCap).mul(depth)
  }
  if (kind > 7.5) {
    const q = p.div(sc)
    const period = d.vec2f(1.0, 1.7320508)
    const half = period.mul(0.5)
    const fromA = q.sub(std.floor(q.div(period)).mul(period)).sub(half)
    const shifted = q.sub(half)
    const fromB = shifted.sub(std.floor(shifted.div(period)).mul(period)).sub(half)
    const offset = std.select(fromB, fromA, std.dot(fromA, fromA) < std.dot(fromB, fromB))
    return offset.mul(2.0 * depth)
  }
  return d.vec2f(0.0)
})

/** Voronoi crumple slope (kind 5) and 3-way fiber relief (kind 6: density, slopeX, slopeY). */
export const finishLayeredRelief = tgpu.fn([d.vec2f, d.f32, d.f32, d.f32], d.vec3f)((p, kind, scale, depth) => {
  'use gpu'
  const sc = std.max(scale, d.f32(0.25))
  if (kind > 4.5 && kind < 5.5) {
    const q = p.div(sc)
    const cell = std.floor(q)
    let nearest = d.f32(8.0)
    let slope = d.vec2f(0.0)
    for (let iy = -1; iy <= 1; iy++) {
      for (let ix = -1; ix <= 1; ix++) {
        const nb = cell.add(d.vec2f(d.f32(ix), d.f32(iy)))
        const pt = nb.add(d.vec2f(finishLatticeHash(nb), finishLatticeHash(nb.add(19.19))))
        const dist = std.length(pt.sub(q))
        const tilt = d.vec2f(finishLatticeHash(nb.add(41.3)), finishLatticeHash(nb.add(73.9))).mul(2.0).sub(1.0)
        slope = std.select(slope, tilt, dist < nearest)
        nearest = std.min(nearest, dist)
      }
    }
    return d.vec3f(0.0, slope.x * depth, slope.y * depth)
  }
  if (kind > 5.5 && kind < 6.5) {
    let fVal = d.f32(0.0)
    let fSlope = d.vec2f(0.0)
    for (let idx = 0; idx < 3; idx++) {
      const fi = d.f32(idx)
      const ang = d.f32(0.35) + fi * 1.125
      const ca = std.cos(ang)
      const sa = std.sin(ang)
      const along = d.vec2f(ca, sa)
      const across = d.vec2f(-sa, ca)
      const coord = d.vec2f(std.dot(p, along) / (sc * 4.0), std.dot(p, across) / sc).add(d.f32(11.7) * (fi + 1.0))
      const n = finishValueNoise(coord)
      fVal += n.x
      fSlope = fSlope.add(across.mul(n.z))
    }
    const tooth = finishValueNoise(p.div(sc).add(3.7))
    const form = finishValueNoise(p.div(sc * 14.0).add(21.4)).x
    const density = (fVal / 3.0) * 0.4 + form * 0.6
    const totalSlope = fSlope.mul(0.35).add(tooth.yz).mul(depth)
    return d.vec3f(density, totalSlope.x, totalSlope.y)
  }
  const s = finishBaseReliefSlope(p, kind, scale, depth)
  return d.vec3f(0.0, s.x, s.y)
})

/** Voronoi crackle line coverage 0..1 (finishCrackle.ts). */
export const finishCrackleLines = tgpu.fn([d.vec2f, d.f32], d.f32)((p, scale) => {
  'use gpu'
  const sc = std.max(scale, d.f32(1.0))
  const q = p.div(sc)
  const cell = std.floor(q)
  let nearest = d.f32(8.0)
  let second = d.f32(8.0)
  for (let iy = -1; iy <= 1; iy++) {
    for (let ix = -1; ix <= 1; ix++) {
      const nb = cell.add(d.vec2f(d.f32(ix), d.f32(iy)))
      const pt = nb.add(d.vec2f(finishLatticeHash(nb), finishLatticeHash(nb.add(19.19))))
      const dist = std.length(pt.sub(q))
      second = std.min(std.max(nearest, dist), second)
      nearest = std.min(nearest, dist)
    }
  }
  const gap = second - nearest
  const line = CRACKLE_LINE_PX / sc
  return 1.0 - std.smoothstep(line, line * 2.5, gap)
})

const evalFilmSens = tgpu.fn([d.f32, d.vec3f], d.vec3f)((opd, shift) => {
  'use gpu'
  const phase = opd * d.f32(TWO_PI * 1e-9)
  const val = d.vec3f(5.4856e-13, 4.4201e-13, 5.2481e-13)
  const pos = d.vec3f(1.681e6, 1.7953e6, 2.2084e6)
  const vr = d.vec3f(4.3278e9, 9.3046e9, 6.6121e9)
  const x = d.f32(9.747e-14 * Math.sqrt(TWO_PI * 4.5282e9)) * std.cos(phase * 2.2399e6 + shift.x) * std.exp(phase * phase * -4.5282e9)
  const xyz = val.mul(std.sqrt(vr.mul(TWO_PI))).mul(std.cos(pos.mul(phase).add(shift))).mul(std.exp(vr.mul(-phase * phase)))
  const m = d.mat3x3f(d.vec3f(3.2404542, -0.969266, 0.0556434), d.vec3f(-1.5371385, 1.8760108, -0.2040259), d.vec3f(-0.4985314, 0.041556, 1.0572252))
  return m.mul(d.vec3f(xyz.x + x, xyz.y, xyz.z).div(1.0685e-7))
})

const schlickVec3 = tgpu.fn([d.vec3f, d.f32], d.vec3f)((f0, c) => {
  'use gpu'
  const x = std.clamp(1.0 - c, d.f32(0.0), d.f32(1.0))
  const x2 = x * x
  return f0.add(d.vec3f(1.0).sub(f0).mul(x2 * x2 * x))
})

/** Thin-film F0 adjustment via Belcour & Barla 2017 + Schlick_to_F0 (finishFilm.ts). */
export const finishApplyThinFilm = tgpu.fn([d.vec2f, d.f32, d.vec3f, d.f32, d.f32, d.f32, d.f32, d.f32], d.vec3f)(
  (p, ndotv, baseCol, amt, filmIor, thickNm, variation, scale) => {
    'use gpu'
    if (amt <= 0.001) return d.vec3f(baseCol)
    const q = p.div(std.max(scale, d.f32(1.0)))
    const bend = finishValueNoise(q.mul(0.5).add(3.1)).x
    const bands = std.sin((q.x + q.y) * d.f32(0.7 * TWO_PI) + bend * 2.5) * 0.5 + 0.5
    const drift = finishValueNoise(q.add(8.3)).x * 0.5 + 0.5
    const thickness = thickNm * (1.0 - variation * std.mix(bands, drift, 0.4))
    const eta = std.mix(d.f32(1.0), filmIor, std.smoothstep(d.f32(0.0), d.f32(0.03), thickness))
    const sin2 = (1.0 / (eta * eta)) * (1.0 - ndotv * ndotv)
    const cos2Sq = 1.0 - sin2
    const cos2 = std.sqrt(std.max(cos2Sq, d.f32(0.0)))
    const r0 = ((eta - 1.0) / (eta + 1.0)) * ((eta - 1.0) / (eta + 1.0))
    const r12 = schlickVec3(d.vec3f(r0), ndotv)
    const t121 = d.vec3f(1.0).sub(r12)
    const rootB = std.sqrt(std.clamp(baseCol, d.vec3f(0.0), d.vec3f(0.9999)))
    const baseIor = d.vec3f(1.0).add(rootB).div(d.vec3f(1.0).sub(rootB))
    const r1 = baseIor.sub(eta).div(baseIor.add(eta))
    const r23 = schlickVec3(r1.mul(r1), cos2)
    const phi21 = std.select(d.f32(0.0), d.f32(Math.PI), eta >= 1.0)
    const phi23 = d.vec3f(
      std.select(d.f32(0.0), d.f32(Math.PI), baseIor.x < eta),
      std.select(d.f32(0.0), d.f32(Math.PI), baseIor.y < eta),
      std.select(d.f32(0.0), d.f32(Math.PI), baseIor.z < eta),
    )
    const opd = eta * thickness * cos2 * 2.0
    const phi = phi23.add(phi21)
    const r123 = std.clamp(r12.mul(r23), d.vec3f(1e-5), d.vec3f(0.9999))
    const rRoot = std.sqrt(r123)
    const rs = t121.mul(t121).mul(r23).div(d.vec3f(1.0).sub(r123))
    const c1 = rs.sub(t121).mul(rRoot)
    const c2 = c1.mul(rRoot)
    const refl = std.max(
      r12.add(rs).add(c1.mul(evalFilmSens(opd, phi).mul(2.0))).add(c2.mul(evalFilmSens(opd * 2.0, phi.mul(2.0)).mul(2.0))),
      d.vec3f(0.0),
    )
    const tirOrRefl = std.select(refl, d.vec3f(1.0), cos2Sq < 0.0)
    const x5 = std.clamp(std.pow(std.clamp(1.0 - ndotv, d.f32(0.0), d.f32(1.0)), d.f32(5.0)), d.f32(0.0), d.f32(0.9999))
    const filmF0 = std.clamp(tirOrRefl.sub(x5).div(1.0 - x5), d.vec3f(0.0), d.vec3f(1.0))
    return std.mix(baseCol, filmF0, amt)
  },
)
