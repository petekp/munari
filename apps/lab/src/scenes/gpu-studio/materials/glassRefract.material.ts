// Refractive frosted glass sampling the two-pass @group(2) canvas backdrop in linear color.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  SurfaceFragmentIn,
  backdropLayout,
  createMaterialUniformLayout,
  defineGpuMaterial,
  sampleBackdropLinear,
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
  const u = customLayout.$.u
  const dims = d.vec2f(std.textureDimensions(backdropLayout.$.tex))
  const edgeBias = ctx.uv.sub(0.5).mul(0.03)
  const screenUv = ctx.screenPos.xy.div(std.max(dims, d.vec2f(1.0))).add(u.shift).sub(edgeBias)
  const bg = sampleBackdropLinear(screenUv)
  const tinted = bg.rgb.mul(u.tint)
  const fresnel = std.pow(std.clamp(std.length(ctx.uv.sub(0.5)) * 1.9, 0.0, 1.0), 2.5) * u.highlight
  const glassLinear = std.mix(bg.rgb, tinted, u.amount).add(d.vec3f(fresnel))
  const glassAlpha = std.max(bg.a * 0.92, 0.18)
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
