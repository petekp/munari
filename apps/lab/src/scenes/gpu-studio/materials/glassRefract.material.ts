// Optical rounded-bevel glass refraction with convex interior lens bend,
// subtle RGB chromatic dispersion, and mip-blurred linear backdrop sampling (`@group(2)`).

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  SurfaceFragmentIn,
  backdropLayout,
  createMaterialUniformLayout,
  defineGpuMaterial,
  sampleBackdropLinearLod,
  surfaceLayout,
} from '@petepetrash/munari-cli/author'

export const GlassRefractUniforms = d.struct({
  tint: d.vec3f,
  amount: d.f32,
  shift: d.vec2f,
  highlight: d.f32,
})

const customLayout = createMaterialUniformLayout(GlassRefractUniforms)

const shade = tgpu.fn([SurfaceFragmentIn], d.vec4f)((ctx) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  const u = customLayout.$.u
  const dims = std.max(d.vec2f(std.textureDimensions(backdropLayout.$.tex)), d.vec2f(1.0))

  const point = ctx.uv.sub(0.5).mul(frame.size)
  const halfSize = frame.size.mul(0.5)
  const leftR = std.select(frame.radii.w, frame.radii.x, point.y > 0.0)
  const rightR = std.select(frame.radii.z, frame.radii.y, point.y > 0.0)
  const rad = std.select(rightR, leftR, point.x < 0.0)
  const dBox = std.abs(point).sub(halfSize).add(d.vec2f(rad))
  const dist = std.min(std.max(dBox.x, dBox.y), 0.0) + std.length(std.max(dBox, d.vec2f(0.0))) - rad

  const outCorner = std.max(dBox, d.vec2f(0.0))
  const sideX = std.select(d.f32(0.0), std.sign(point.x), dBox.x >= dBox.y)
  const sideY = std.select(d.f32(0.0), std.sign(point.y), dBox.y > dBox.x)
  const rawGrad = std.select(
    d.vec2f(sideX, sideY),
    outCorner.mul(std.sign(point)),
    outCorner.x > 0.0 && outCorner.y > 0.0,
  )
  const bevelGrad = std.normalize(rawGrad.add(d.vec2f(1e-5, 0.0)))
  const bevelScreen = d.vec2f(bevelGrad.x, -bevelGrad.y)

  const bevelT = std.smoothstep(d.f32(-26.0), d.f32(0.0), dist)
  const rimT = std.smoothstep(d.f32(-4.0), d.f32(0.0), dist)
  const centered = ctx.uv.sub(0.5)
  const lensShift = d.vec2f(-centered.x, centered.y).mul(0.036)
  const bevelBend = bevelScreen.mul(bevelT * 0.052)
  const totalBend = u.shift.add(lensShift).add(bevelBend)
  const lod = std.mix(d.f32(1.15), d.f32(0.35), bevelT)

  const baseUv = ctx.screenPos.xy.div(dims)
  const sR = sampleBackdropLinearLod(baseUv.add(totalBend.mul(1.18)), lod)
  const sG = sampleBackdropLinearLod(baseUv.add(totalBend), lod)
  const sB = sampleBackdropLinearLod(baseUv.add(totalBend.mul(0.82)), lod)
  const bgRgb = d.vec3f(sR.x, sG.y, sB.z)

  const tinted = bgRgb.mul(u.tint)
  const domeRim = std.pow(std.clamp(std.length(centered) * 1.9, 0.0, 1.0), 2.4)
  const rimGlint = (domeRim * u.highlight) + (bevelT * 0.16) + (rimT * 0.12)
  const glassLinear = std.mix(bgRgb, tinted, u.amount).add(d.vec3f(rimGlint))
  const glassAlpha = std.max(sG.w * 0.96, 0.24)
  const alpha = ctx.alpha + glassAlpha * (1.0 - ctx.alpha)
  const straightOut = ctx.color
    .mul(ctx.alpha)
    .add(glassLinear.mul(glassAlpha * (1.0 - ctx.alpha)))
    .div(std.max(alpha, d.f32(1e-4)))
  return d.vec4f(straightOut, alpha)
})

export default defineGpuMaterial({
  name: 'glass-refract',
  doubleSided: true,
  needsBackdrop: true,
  uniforms: {
    schema: GlassRefractUniforms,
    layout: customLayout,
    initial: {
      tint: [0.85, 0.94, 1.0],
      amount: 0.72,
      shift: [0.008, -0.004],
      highlight: 0.14,
    },
    sampleValue: {
      tint: [0.65, 0.86, 1.0],
      amount: 0.85,
      shift: [0.014, 0.005],
      highlight: 0.18,
    },
  },
  shade,
})
