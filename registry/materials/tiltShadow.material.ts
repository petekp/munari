// Directional card tilt bevel and warm/cool elevation shading in linear color.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  SurfaceFragmentIn,
  createMaterialUniformLayout,
  defineGpuMaterial,
} from '@petepetrash/munari-cli/author'

export const TiltShadowUniforms = d.struct({
  tilt: d.vec2f,
  depth: d.f32,
  warmth: d.f32,
})

const customLayout = createMaterialUniformLayout(TiltShadowUniforms)

const shade = tgpu.fn([SurfaceFragmentIn], d.vec4f)((ctx) => {
  'use gpu'
  const u = customLayout.$.u
  const centered = ctx.uv.sub(0.5)
  const grad = std.dot(centered, u.tilt)
  const shadeGain = 1.0 + grad * u.depth
  const tint = d.vec3f(1.0 + u.warmth * 0.08, 1.0, 1.0 - u.warmth * 0.06)
  return d.vec4f(ctx.color.mul(shadeGain).mul(tint), ctx.alpha)
})

export default defineGpuMaterial({
  name: 'tilt-shadow',
  uniforms: {
    schema: TiltShadowUniforms,
    layout: customLayout,
    initial: {
      tilt: [0.4, -0.5],
      depth: 0.22,
      warmth: 0.35,
    },
  },
  shade,
})
