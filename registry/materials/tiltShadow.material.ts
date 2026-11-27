// Directional card tilt bevel and warm/cool elevation shading.

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

export const TiltShadowUniforms = d.struct({
  tilt: d.vec2f,
  depth: d.f32,
  warmth: d.f32,
})

const customLayout = createMaterialUniformLayout(TiltShadowUniforms)

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
  const centered = input.uv.sub(0.5)
  const grad = std.dot(centered, u.tilt)
  const shade = 1.0 + grad * u.depth
  const tint = d.vec3f(1.0 + u.warmth * 0.08, 1.0, 1.0 - u.warmth * 0.06)
  const mask = surfaceRadiusMask(input.uv, frame.size, frame.radii)
  const outCol = d.vec4f(c.rgb.mul(shade).mul(tint).mul(mask), c.a * mask)
  if (outCol.a < 0.004) std.discard()
  return outCol
})

export default defineManifestMaterial({
  name: 'tilt-shadow',
  sampleViewFormat: 'rgba8unorm',
  doubleSided: false,
  depthTest: true,
  depthWrite: false,
  uniforms: {
    schema: TiltShadowUniforms,
    layout: customLayout,
    initial: {
      tilt: [0.4, -0.5],
      depth: 0.22,
      warmth: 0.35,
    },
  },
  vertex,
  fragment,
})
