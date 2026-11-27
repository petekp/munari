// Radial spotlight and edge vignette over DOM capture in linear color.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  SurfaceFragmentIn,
  createMaterialUniformLayout,
  defineGpuMaterial,
} from '@petepetrash/munari-cli/author'

export const VignetteUniforms = d.struct({
  focus: d.vec2f,
  radius: d.f32,
  softness: d.f32,
  strength: d.f32,
})

const customLayout = createMaterialUniformLayout(VignetteUniforms)

const shade = tgpu.fn([SurfaceFragmentIn], d.vec4f)((ctx) => {
  'use gpu'
  const u = customLayout.$.u
  const dist = std.length(ctx.uv.sub(u.focus))
  const edge = std.smoothstep(u.radius, u.radius + std.max(u.softness, 0.05), dist)
  const factor = 1.0 - edge * std.clamp(u.strength, 0.0, 0.95)
  return d.vec4f(ctx.color.mul(factor), ctx.alpha)
})

export default defineGpuMaterial({
  name: 'vignette',
  uniforms: {
    schema: VignetteUniforms,
    layout: customLayout,
    initial: {
      focus: [0.5, 0.5],
      radius: 0.28,
      softness: 0.42,
      strength: 0.38,
    },
  },
  shade,
})
