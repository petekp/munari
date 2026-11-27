// TypeGPU Heitz 2016 + Hill LTC softbox lighting helpers for *.material.ts files.
// Zero implicit integer conversions: all constants and accumulators use f32.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'

const LUT_SCALE = d.f32(63.0 / 64.0)
const LUT_BIAS = d.f32(0.5 / 64.0)

/** Parameterizes 64x64 LTC lookup UVs from surface normal `N`, view dir `V`, and roughness. */
export const ltcUv = tgpu.fn([d.vec3f, d.vec3f, d.f32], d.vec2f)((N, V, roughness) => {
  'use gpu'
  const ndotv = std.clamp(std.dot(N, V), d.f32(0.0), d.f32(1.0))
  const raw = d.vec2f(std.clamp(roughness, d.f32(0.0), d.f32(1.0)), std.sqrt(d.f32(1.0) - ndotv))
  return raw.mul(LUT_SCALE).add(LUT_BIAS)
})

/** Decodes a sampled rgba16float texel from LTC table 1 into the 3x3 inverse transform matrix. */
export const ltcMatrixFromSample = tgpu.fn([d.vec4f], d.mat3x3f)((t1) => {
  'use gpu'
  return d.mat3x3f(
    d.vec3f(t1.x, 0.0, t1.y),
    d.vec3f(0.0, 1.0, 0.0),
    d.vec3f(t1.z, 0.0, t1.w),
  )
})

/** Edge vector form factor (Heitz et al. 2016, rational theta / sin(theta) / 2pi approximation). */
export const ltcEdgeVectorFormFactor = tgpu.fn([d.vec3f, d.vec3f], d.vec3f)((v1, v2) => {
  'use gpu'
  const x = std.dot(v1, v2)
  const y = std.abs(x)
  const a = (y * 0.0145206 + 0.4965155) * y + 0.8543985
  const b = (y + 4.1616724) * y + 3.4175940
  const v = a / b
  const neg = std.inverseSqrt(std.max(d.f32(1.0) - x * x, d.f32(1e-7))) * 0.5 - v
  const thetaSinth = std.select(neg, v, x > 0.0)
  return std.cross(v1, v2).mul(thetaSinth)
})

/** Horizon-clipped sphere form factor approximation from Real-Time Area Lighting. */
export const ltcClippedSphereFormFactor = tgpu.fn([d.vec3f], d.f32)((f) => {
  'use gpu'
  const l = std.length(f)
  return std.max((l * l + f.z) / (l + 1.0), d.f32(0.0))
})

/**
 * Evaluates a rectangular area light `(p0, p1, p2, p3)` in world space using LTC matrix `mInv`.
 * Corner winding assumes `cross(p1 - p0, p3 - p0)` points from the light toward lit surfaces.
 */
export const ltcEvaluate = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f, d.mat3x3f, d.vec3f, d.vec3f, d.vec3f, d.vec3f],
  d.f32,
)((N, V, P, mInv, p0, p1, p2, p3) => {
  'use gpu'
  const lightNormal = std.cross(p1.sub(p0), p3.sub(p0))
  if (std.dot(lightNormal, P.sub(p0)) < 0.0) return d.f32(0.0)

  const t1Raw = V.sub(N.mul(std.dot(N, V)))
  const t1Len = std.length(t1Raw)
  const fallback = std.normalize(std.cross(d.vec3f(0.0, 1.0, 0.0), N))
  const T1 = std.select(fallback, t1Raw.div(std.max(t1Len, d.f32(1e-5))), t1Len > 1e-5)
  const T2 = std.cross(T1, N)

  const d0 = p0.sub(P)
  const d1 = p1.sub(P)
  const d2 = p2.sub(P)
  const d3 = p3.sub(P)

  const c0 = std.normalize(mInv.mul(d.vec3f(std.dot(T1, d0), std.dot(T2, d0), std.dot(N, d0))))
  const c1 = std.normalize(mInv.mul(d.vec3f(std.dot(T1, d1), std.dot(T2, d1), std.dot(N, d1))))
  const c2 = std.normalize(mInv.mul(d.vec3f(std.dot(T1, d2), std.dot(T2, d2), std.dot(N, d2))))
  const c3 = std.normalize(mInv.mul(d.vec3f(std.dot(T1, d3), std.dot(T2, d3), std.dot(N, d3))))

  const vf = ltcEdgeVectorFormFactor(c0, c1)
    .add(ltcEdgeVectorFormFactor(c1, c2))
    .add(ltcEdgeVectorFormFactor(c2, c3))
    .add(ltcEdgeVectorFormFactor(c3, c0))

  return ltcClippedSphereFormFactor(vf)
})
