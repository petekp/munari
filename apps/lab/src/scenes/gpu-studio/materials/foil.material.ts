// Iridescent thin-film holographic foil overlay driven by pointer tilt and phase shift.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  SurfaceFragmentIn,
  createMaterialUniformLayout,
  defineGpuMaterial,
} from '@petepetrash/munari-cli/author'

export const FoilUniforms = d.struct({
  tilt: d.vec2f,
  intensity: d.f32,
  phase: d.f32,
})

const customLayout = createMaterialUniformLayout(FoilUniforms)

const shade = tgpu.fn([SurfaceFragmentIn], d.vec4f)((ctx) => {
  'use gpu'
  const u = customLayout.$.u
  const centered = ctx.uv.sub(0.5)
  const sweep = std.dot(centered, u.tilt) * 4.2 + ctx.uv.x * 2.1 + u.phase
  const spectrum = std.max(
    d.vec3f(0.0),
    std.cos(d.vec3f(0.0, 2.094, 4.188).add(sweep * 6.28318)).mul(0.5).add(0.5),
  )
  const diag = std.exp(-std.pow((centered.x * 0.7 - centered.y * 0.9 - u.tilt.x * 0.45) * 4.2, 2.0))
  const shimmer = spectrum.mul((0.18 + diag * 0.55) * u.intensity)
  return d.vec4f(ctx.color.add(shimmer), ctx.alpha)
})

export default defineGpuMaterial({
  name: 'foil',
  uniforms: {
    schema: FoilUniforms,
    layout: customLayout,
    initial: {
      tilt: [0.35, -0.25],
      intensity: 0.45,
      phase: 0.2,
    },
    sampleValue: {
      tilt: [-0.4, 0.3],
      intensity: 0.65,
      phase: 0.75,
    },
  },
  shade,
})
