// Radial spotlight and edge vignette over DOM capture in premultiplied sRGB.

import tgpu from 'typegpu'
import * as d from 'typegpu/data'
import * as std from 'typegpu/std'
import {
  createMaterialUniformLayout,
  defineManifestMaterial,
  sampleSurface,
  surfaceLayout,
  surfaceRadiusMask,
} from '@petepetrash/munari-cli/author'

export const VignetteUniforms = d.struct({
  focus: d.vec2f,
  radius: d.f32,
  softness: d.f32,
  strength: d.f32,
})

const customLayout = createMaterialUniformLayout(VignetteUniforms)

const vertex = tgpu.vertexFn({
  in: {
    position: d.location(0, d.vec3f),
    uv: d.location(1, d.vec2f),
  },
  out: {
    pos: d.builtin.position,
    uv: d.vec2f,
  },
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  return {
    pos: frame.mvp.mul(d.vec4f(input.position, 1.0)),
    uv: input.uv,
  }
})

const fragment = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  'use gpu'
  const frame = surfaceLayout.$.frame
  const u = customLayout.$.u
  const c = sampleSurface(input.uv)
  const dist = std.length(input.uv.sub(u.focus))
  const edge = std.smoothstep(u.radius, u.radius + std.max(u.softness, 0.05), dist)
  const factor = 1.0 - edge * std.clamp(u.strength, 0.0, 0.95)
  const mask = surfaceRadiusMask(input.uv, frame.size, frame.radii)
  const outCol = d.vec4f(c.rgb.mul(factor * mask), c.a * mask)
  if (outCol.a < 0.004) std.discard()
  return outCol
})

export default defineManifestMaterial({
  name: 'vignette',
  sampleViewFormat: 'rgba8unorm',
  doubleSided: false,
  depthTest: true,
  depthWrite: false,
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
  vertex,
  fragment,
})
